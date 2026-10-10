// Agent A1 "Delivery-Assistent". The model understands the question, the
// engine supplies the facts (architecture §5.4). Without a chat-capable model
// a deterministic German intent router answers the common questions.
// It can request drafts (same checks as the UI) but never decides anything.

import {
  PROJECT_ROLE_LABELS,
  changeRequestRegister,
  deliverableDetailView,
  formatChf,
  projectView,
  riskRegister,
  rolesOf,
  type DeliverableRowView,
  type HermesModel,
  type ProjectState,
  type ProjectView,
  type SkillDef,
} from "@hermes-helfer/core";
import { z } from "zod";
import { HttpError } from "../errors";
import type { ProjectService, RequestContext } from "../projects/service";
import { chatSystemPrompt } from "./prompts";
import type { AiProvider, ChatMessage, ToolSpec } from "./provider";
import type { Logger, RunService } from "./runner";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export type ChatAction =
  | { kind: "run_started"; skillId: string; runId: string; label: string }
  | { kind: "start_skill"; skillId: string; label: string }
  | { kind: "open_deliverable"; deliverableId: string; label: string };

export interface ChatReply {
  text: string;
  mode: "ki" | "regeln";
  actions: ChatAction[];
  suggestions: string[];
}

export const DEFAULT_SUGGESTIONS = [
  "Was ist als Nächstes?",
  "Meine Aufgaben",
  "Wie steht das Gate?",
  "Welche Ergebnisse fehlen?",
];

/** Lower-case, umlauts and accents removed, "ß" → "ss". */
export const normalize = (s: string) =>
  s.toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

const bullets = (lines: string[]) => lines.map((l) => `- ${l}`).join("\n");

/** Skill of the current phase named in the text (longest match on name, document or deliverable). */
export function findSkillInText(
  model: HermesModel,
  s: ProjectState,
  text: string,
  anyPhase = false,
): SkillDef | undefined {
  const n = normalize(text);
  const phases = anyPhase ? model.phases : [model.phase(s.phase)];
  let best: { skill: SkillDef; len: number } | undefined;
  for (const ph of phases) {
    for (const sk of ph.skills) {
      const names = [sk.name, sk.outputDoc, ...model.deliverablesOfSkill(sk.id).map((d) => d.name)];
      for (const name of names) {
        const key = normalize(name);
        if (key.length >= 4 && n.includes(key) && (!best || key.length > best.len))
          best = { skill: sk, len: key.length };
      }
    }
  }
  return best?.skill;
}

export class Orchestrator {
  constructor(
    private readonly projects: ProjectService,
    private readonly runs: RunService,
    private readonly provider: AiProvider,
    private readonly log: Logger,
  ) {}

  private get model() {
    return this.projects.model;
  }

  async respond(code: string, ctx: RequestContext, message: string, history: ChatTurn[]): Promise<ChatReply> {
    const s = await this.projects.requireProject(code, ctx.viewer);
    const used: string[] = [];
    let reply: ChatReply;
    if (this.provider.chat) {
      try {
        reply = await this.withModel(code, s, ctx, message, history, used);
      } catch (err) {
        this.log.warn({ err, correlationId: ctx.correlationId }, "chat model failed, using rules");
        reply = await this.withRules(code, ctx, message, used);
        reply.text = `${reply.text}\n\n(Das KI-Modell ist gerade nicht erreichbar; diese Antwort kommt aus den festen Regeln.)`;
      }
    } else {
      reply = await this.withRules(code, ctx, message, used);
    }
    // Audit: metadata only, no message content (architecture §9.6).
    this.log.info(
      {
        type: "chat",
        projectId: s.projectId,
        userId: ctx.viewer.userId,
        mode: reply.mode,
        tools: used,
        actions: reply.actions.map((a) => a.kind),
        correlationId: ctx.correlationId,
      },
      "chat",
    );
    return reply;
  }

  // ---------- Tools (shared by both modes) ----------

  private async view(code: string, ctx: RequestContext): Promise<ProjectView> {
    return projectView(await this.projects.requireProject(code, ctx.viewer), this.model, ctx.viewer);
  }

  private currentPhase(v: ProjectView) {
    return v.phases.find((p) => p.id === v.phase)!;
  }

  private async startDraft(code: string, ctx: RequestContext, skill: SkillDef) {
    try {
      const { runId } = await this.runs.start(code, { ...ctx, channel: "chat" }, skill.id);
      return { ok: true as const, runId };
    } catch (err) {
      if (err instanceof HttpError) return { ok: false as const, reason: err.message };
      throw err;
    }
  }

  private toolSpecs(): ToolSpec[] {
    const none = { type: "object", properties: {}, additionalProperties: false };
    return [
      {
        name: "projekt_ueberblick",
        description: "Stand des Vorhabens: Phase, Pflichtergebnisse, Gate, nächster Schritt.",
        parameters: none,
      },
      {
        name: "naechster_schritt",
        description: "Der nächste Schritt im Vorhaben und ob die Person ihn selbst ausführen kann.",
        parameters: none,
      },
      {
        name: "meine_aufgaben",
        description: "Offene Aufgaben der fragenden Person (Entscheide, Freigaben, Auflagen …).",
        parameters: none,
      },
      {
        name: "gate_status",
        description: "Kriterien und Status des Gates der aktuellen Phase.",
        parameters: none,
      },
      {
        name: "lieferergebnisse",
        description: "Lieferergebnisse der aktuellen Phase mit Status.",
        parameters: none,
      },
      {
        name: "ergebnis_details",
        description: "Details zu einem Lieferergebnis (Status, Hinweise des Kritikers, Zusammenfassung).",
        parameters: {
          type: "object",
          properties: { ergebnis_id: { type: "string", description: "ID aus lieferergebnisse" } },
          required: ["ergebnis_id"],
          additionalProperties: false,
        },
      },
      {
        name: "change_requests",
        description:
          "Change Requests des Vorhabens: Status, Aufwand, Kosten, Auswirkungen und offene Neuprüfungen.",
        parameters: none,
      },
      {
        name: "risiken",
        description:
          "Risikoregister des Vorhabens: offene Risiken mit Eintritt, Auswirkung, Bewertung, Massnahme und Verantwortung, die höchsten zuerst.",
        parameters: none,
      },
      {
        name: "entwurf_anstossen",
        description:
          "Stösst den Entwurf eines Schritts der aktuellen Phase an. Nur auf ausdrücklichen Wunsch der Person.",
        parameters: {
          type: "object",
          properties: { schritt: { type: "string", description: "Name des Schritts oder des Ergebnisses" } },
          required: ["schritt"],
          additionalProperties: false,
        },
      },
    ];
  }

  private async runTool(
    name: string,
    rawArgs: string,
    code: string,
    ctx: RequestContext,
    actions: ChatAction[],
  ): Promise<unknown> {
    const v = await this.view(code, ctx);
    const phase = this.currentPhase(v);
    switch (name) {
      case "projekt_ueberblick":
        return {
          vorhaben: `${v.name} (${v.code})`,
          phase: v.phaseLabel,
          pflichtergebnisse: `${phase.mandatory.done} von ${phase.mandatory.total} freigegeben`,
          gate: { name: phase.gate.name, status: phase.gate.statusLabel },
          naechster_schritt: v.nextStep.title,
          meine_rollen: v.myRoles.map((r) => PROJECT_ROLE_LABELS[r]),
        };
      case "naechster_schritt":
        return v.nextStep;
      case "meine_aufgaben":
        return v.myTasks.map((t) => ({ aufgabe: t.title, detail: t.detail }));
      case "gate_status":
        return {
          gate: phase.gate.name,
          status: phase.gate.statusLabel,
          entscheid: phase.gate.deciderLabel,
          kriterien: phase.gate.criteria,
        };
      case "lieferergebnisse":
        return phase.deliverables.map((d) => ({
          id: d.id,
          name: d.name,
          art: d.requirement,
          status: d.statusLabel,
          wartet_auf: d.waitingFor,
        }));
      case "ergebnis_details": {
        const args = z.object({ ergebnis_id: z.string().max(40) }).safeParse(JSON.parse(rawArgs || "{}"));
        const d = args.success ? this.model.findDeliverable(args.data.ergebnis_id) : undefined;
        if (!d) return { fehler: "Unbekanntes Ergebnis." };
        const s = await this.projects.requireProject(code, ctx.viewer);
        const detail = deliverableDetailView(s, this.model, ctx.viewer, d);
        actions.push({ kind: "open_deliverable", deliverableId: d.id, label: `«${d.name}» öffnen` });
        return {
          name: detail.name,
          status: detail.statusLabel,
          inhalt_eingeschraenkt: !detail.contentVisible,
          schritte: detail.skills.map((sk) => ({
            schritt: sk.name,
            status: sk.statusLabel,
            hinweise_kritiker: sk.output?.findings.map((f) => f.text) ?? [],
            zusammenfassung_als_daten: sk.output?.draft?.summary ?? null,
          })),
        };
      }
      case "change_requests": {
        const s = await this.projects.requireProject(code, ctx.viewer);
        const r = changeRequestRegister(s, this.model, ctx.viewer);
        return {
          reserve:
            r.reserve.reserveChf === undefined
              ? "nicht erfasst"
              : `${formatChf(r.reserve.reserveChf)}, davon verbraucht ${formatChf(r.reserve.usedChf)}`,
          change_requests: r.items.map((c) => ({
            cr: c.label,
            titel_als_daten: c.title,
            status: c.statusLabel,
            aufwand_personentage: c.effortDays,
            kosten: formatChf(c.costChf),
            auswirkung: c.impactSummary,
            neupruefung: c.recheck ? (c.recheck.done ? "abgeschlossen" : "offen") : "nicht nötig",
          })),
        };
      }
      case "risiken": {
        const s = await this.projects.requireProject(code, ctx.viewer);
        const r = riskRegister(s, this.model, ctx.viewer);
        return {
          offen: r.counts.open,
          hoch: r.counts.high,
          geschlossen: r.counts.closed,
          risiken: r.items
            .filter((x) => x.open)
            .slice(0, 10)
            .map((x) => ({
              risiko: x.label,
              titel_als_daten: x.title,
              eintritt: x.probability,
              auswirkung: x.impact,
              bewertung: `${x.score} (${x.level})`,
              status: x.status,
              verantwortlich: x.ownerLabel,
              massnahme_als_daten: x.mitigation || "keine erfasst",
            })),
        };
      }
      case "entwurf_anstossen": {
        const args = z.object({ schritt: z.string().max(200) }).safeParse(JSON.parse(rawArgs || "{}"));
        const s = await this.projects.requireProject(code, ctx.viewer);
        const skill = args.success ? findSkillInText(this.model, s, args.data.schritt) : undefined;
        if (!skill) return { fehler: "Kein passender Schritt in der aktuellen Phase." };
        const res = await this.startDraft(code, ctx, skill);
        if (res.ok)
          actions.push({ kind: "run_started", skillId: skill.id, runId: res.runId, label: skill.outputDoc });
        return res.ok
          ? { gestartet: skill.name, dokument: skill.outputDoc }
          : { nicht_gestartet: res.reason };
      }
      default:
        return { fehler: `Unbekanntes Werkzeug ${name}` };
    }
  }

  // ---------- Mode 1: model with tools ----------

  private async withModel(
    code: string,
    s: ProjectState,
    ctx: RequestContext,
    message: string,
    history: ChatTurn[],
    used: string[],
  ): Promise<ChatReply> {
    const actions: ChatAction[] = [];
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: chatSystemPrompt({
          userName: ctx.viewer.displayName,
          roles: rolesOf(s, ctx.viewer.userId).map((r) => PROJECT_ROLE_LABELS[r]),
          projectName: s.name,
          projectCode: s.code,
          phaseLabel: this.model.phase(s.phase).label,
        }),
      },
      ...history.slice(-8).map((t) => ({ role: t.role, content: t.text })),
      { role: "user", content: message },
    ];
    const specs = this.toolSpecs();
    for (let round = 0; round < 4; round++) {
      const res = await this.provider.chat!(messages, specs);
      if (!res.toolCalls.length) {
        return {
          text: res.content?.trim() || "Dazu habe ich keine Antwort.",
          mode: "ki",
          actions,
          suggestions: DEFAULT_SUGGESTIONS,
        };
      }
      messages.push({ role: "assistant", content: res.content, toolCalls: res.toolCalls });
      for (const call of res.toolCalls) {
        used.push(call.name);
        let out: unknown;
        try {
          out = await this.runTool(call.name, call.arguments, code, ctx, actions);
        } catch (err) {
          if (err instanceof SyntaxError) out = { fehler: "Ungültige Argumente." };
          else throw err;
        }
        messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(out).slice(0, 12_000) });
      }
    }
    return {
      text: "Ich konnte die Frage nicht abschliessend beantworten.",
      mode: "ki",
      actions,
      suggestions: DEFAULT_SUGGESTIONS,
    };
  }

  // ---------- Mode 2: deterministic rules ----------

  private async withRules(
    code: string,
    ctx: RequestContext,
    message: string,
    used: string[],
  ): Promise<ChatReply> {
    const n = normalize(message).replace(/[?!.]+$/, "");
    const has = (re: RegExp) => re.test(n);
    const reply = (
      text: string,
      actions: ChatAction[] = [],
      suggestions = DEFAULT_SUGGESTIONS,
    ): ChatReply => ({
      text,
      mode: "regeln",
      actions,
      suggestions,
    });
    const s = await this.projects.requireProject(code, ctx.viewer);
    const v = await this.view(code, ctx);
    const phase = this.currentPhase(v);

    if (
      has(
        /^(hilfe|help|\?|hallo|hi|gruezi|gruessech|servus|guten (morgen|tag|abend))\b|was kannst du|wie funktionier|beispiel/,
      )
    ) {
      used.push("hilfe");
      return reply(
        [
          "Ich helfe dir, dein Vorhaben nach HERMES voranzubringen. Ich kann:",
          bullets([
            "den Stand und den nächsten Schritt zeigen",
            "deine Aufgaben auflisten (Entscheide, Freigaben, Auflagen)",
            "das Gate und die offenen Lieferergebnisse erklären",
            "Change Requests und ihre Auswirkungen zeigen",
            "die offenen Risiken zeigen",
            "Entwürfe anstossen, z. B. «Starte Kick-off»",
          ]),
          "Entscheide triffst du selbst; ich bereite nur vor.",
        ].join("\n"),
      );
    }

    // Change requests have their own register; the agent drafts them there, not in the chat.
    if (has(/change.?request|\bcrs?\b|\bcr-\d|anderungsantrag|anderungswunsch|\banderung(en)?\b/)) {
      used.push("change_requests");
      const r = changeRequestRegister(s, this.model, ctx.viewer);
      const open = r.items.filter((c) => c.status === "offen");
      const rechecks = r.items.filter((c) => c.recheck && !c.recheck.done);
      const lines = [
        ...open.map((c) => `${c.label} ${c.title}: wartet auf den Projektausschuss (${c.impactSummary})`),
        ...rechecks.map((c) => `${c.label} ${c.title}: Neuprüfung durch ISM und Datenschutz offen`),
      ];
      return reply(
        [
          lines.length
            ? `Offen bei den Change Requests:\n${bullets(lines)}`
            : `Keine offenen Change Requests (${r.items.length} im Register).`,
          "Einen neuen Change Request erfasst du im Register «Change Requests»; der Agent hilft beim Ausformulieren.",
        ].join("\n"),
      );
    }

    // Questions ("Was wird erstellt?") never start anything; commands do ("Starte Kick-off").
    const question = has(/^(was|wer|wie|wann|wo|warum|weshalb|welche\w*|gibt es)\b/);
    const startVerb =
      !question && has(/\b(start\w*|anstoss\w*|anstos\w*|stoss\w*|erstell\w*|ausfuhr\w*|lass\w* .*laufen)\b/);
    if (startVerb) {
      used.push("entwurf_anstossen");
      const skill = findSkillInText(this.model, s, message);
      if (!skill && has(/risik/)) {
        return reply(
          "Die Prüfung durch den Risiko-Agenten stösst die Projektleitung im Register «Risiken» an: «Risiken prüfen lassen». Dort übernimmt sie die passenden Vorschläge.",
        );
      }
      if (!skill) {
        const ready = phase.deliverables.filter((d) => d.action?.kind === "start" && d.action.enabled);
        return reply(
          ready.length
            ? `Welchen Entwurf soll ich anstossen? Bereit sind:\n${bullets(ready.map((d) => d.name))}`
            : "In der aktuellen Phase kann ich für dich gerade keinen Entwurf anstossen.",
        );
      }
      if (skill.mode === "manual") {
        const d = this.model.deliverablesOfSkill(skill.id)[0]!;
        return reply(`«${skill.outputDoc}» erfasst die zuständige Person selbst, ohne Agent.`, [
          { kind: "open_deliverable", deliverableId: d.id, label: `«${d.name}» öffnen` },
        ]);
      }
      const res = await this.startDraft(code, ctx, skill);
      if (!res.ok) return reply(`Ich kann «${skill.name}» nicht anstossen: ${res.reason}`);
      return reply(
        `Ich habe «${skill.name}» angestossen. Der Entwurf «${skill.outputDoc}» erscheint in den Lieferergebnissen, sobald er fertig ist. Prüfen und freigeben musst du (bzw. die zuständige Rolle) ihn selbst.`,
        [{ kind: "run_started", skillId: skill.id, runId: res.runId, label: skill.outputDoc }],
      );
    }

    // The register, unless the question names a result about risks («Beurteilung Einführungsrisiken»).
    const named = findSkillInText(this.model, s, message, true);
    const namesRiskResult =
      !!named &&
      [named.name, named.outputDoc, ...this.model.deliverablesOfSkill(named.id).map((d) => d.name)].some(
        (x) => normalize(x).includes("risik"),
      );
    if (has(/risik|\brisks?\b|\br-\d/) && !namesRiskResult) {
      used.push("risiken");
      const r = riskRegister(s, this.model, ctx.viewer);
      const top = r.items.filter((x) => x.open).slice(0, 5);
      return reply(
        [
          top.length
            ? `${r.counts.open} offene ${r.counts.open === 1 ? "Risiko" : "Risiken"}, davon ${r.counts.high} hoch. Die wichtigsten:\n${bullets(
                top.map(
                  (x) =>
                    `${x.label} ${x.title}: Eintritt ${x.probability}, Auswirkung ${x.impact}, ${x.status}${x.mitigation ? `. Massnahme: ${x.mitigation}` : ", noch ohne Massnahme"}`,
                ),
              )}`
            : "Im Risikoregister sind keine offenen Risiken erfasst.",
          "Risiken erfasst ihr im Register «Risiken»; der Risiko-Agent schlägt dort neue Risiken vor (Projektleitung).",
        ].join("\n"),
      );
    }

    if (has(/\bgate\b|phasenfreigabe|projektfreigabe/)) {
      used.push("gate_status");
      const g = phase.gate;
      return reply(
        `Gate «${g.name}»: ${g.statusLabel}. Entscheid: ${g.deciderLabel}.\n${bullets(
          g.criteria.map((c) => `${c.ok ? "✓" : "✗"} ${c.label}: ${c.detail}`),
        )}`,
      );
    }

    if (
      has(
        /als nachstes|nachste[nr]? schritt|was (ist|steht) (jetzt )?(an|zu tun)|was ist zu tun|was blockiert|wo hangt|was fehlt noch|naechst/,
      )
    ) {
      used.push("naechster_schritt");
      const ns = v.nextStep;
      const actions: ChatAction[] = [];
      if (ns.kind === "run" && ns.canAct && ns.skillId)
        actions.push({ kind: "start_skill", skillId: ns.skillId, label: ns.actionLabel ?? "Ausführen" });
      else if (ns.deliverableId)
        actions.push({
          kind: "open_deliverable",
          deliverableId: ns.deliverableId,
          label: ns.actionLabel ?? "Öffnen",
        });
      return reply(
        `**${ns.title}**\n${ns.detail}${ns.canAct ? "" : "\n(Diesen Schritt führt eine andere Rolle aus.)"}`,
        actions,
      );
    }

    if (has(/meine aufgaben|was muss ich|fur mich|von mir|meine pendenzen|to.?dos?|was soll ich/)) {
      used.push("meine_aufgaben");
      return reply(
        v.myTasks.length
          ? `Für dich offen:\n${bullets(v.myTasks.map((t) => t.title))}`
          : "Für dich ist gerade nichts offen.",
      );
    }

    if (has(/entscheid|freigab|genehmig|\bveto\b/)) {
      used.push("lieferergebnisse");
      const waiting = phase.deliverables.filter((d) => d.status === "approval" || d.status === "veto");
      const drafts = phase.deliverables.filter((d) => d.status === "draft");
      const lines = [
        ...waiting.map(
          (d) => `${d.name}: wartet auf ${d.waitingFor.join(", ")}${d.status === "veto" ? " (Veto)" : ""}`,
        ),
        ...drafts.map((d) => `${d.name}: Entwurf wartet auf Freigabe durch die Projektleitung`),
      ];
      return reply(
        lines.length
          ? `Offene Entscheide und Freigaben:\n${bullets(lines)}`
          : "In der aktuellen Phase ist kein Entscheid offen.",
      );
    }

    if (has(/beteilig|wer fehlt|einbezieh|einbind/)) {
      used.push("beteiligung");
      const open = phase.participants.filter((p) => p.required && !p.involved);
      return reply(
        open.length
          ? `Noch einzubeziehen (sonst bleibt das Gate zu):\n${bullets(open.map((p) => `${p.label}: ${p.why}`))}`
          : "Alle nötigen Beteiligten sind einbezogen.",
      );
    }

    if (has(/ergebnis|lieferergebnis|dokument|deliverable|was wird erstellt/)) {
      used.push("lieferergebnisse");
      const list = (rows: DeliverableRowView[]) => bullets(rows.map((d) => `${d.name}: ${d.statusLabel}`));
      const pflicht = phase.deliverables.filter((d) => d.requirement === "pflicht");
      return reply(
        `Pflichtergebnisse in «${phase.label}» (${phase.mandatory.done} von ${phase.mandatory.total} freigegeben):\n${list(pflicht)}`,
      );
    }

    if (has(/status|uberblick|ubersicht|\bstand\b|wie steht|wie lauft|zusammenfass|\blage\b|update/)) {
      used.push("projekt_ueberblick");
      return reply(
        `**${v.name}** (${v.code}) ist in der Phase **${v.phaseLabel}**. ${phase.mandatory.done} von ${phase.mandatory.total} Pflichtergebnissen sind freigegeben; Gate «${phase.gate.name}»: ${phase.gate.statusLabel}.\nAls Nächstes: ${v.nextStep.title}.`,
      );
    }

    const skill = findSkillInText(this.model, s, message, true);
    if (skill) {
      used.push("skill_erklaeren");
      const who = ["Projektleitung", ...skill.mayStart.map((r) => PROJECT_ROLE_LABELS[r])].join(", ");
      const decides = skill.approvers.length
        ? skill.approvers.map((a) => a.label).join(" und ")
        : "Projektleitung (Freigabe)";
      return reply(
        [
          `**${skill.name}** (${this.model.phase(skill.phase).label}): ${skill.description}`,
          bullets([
            `Ergebnis: ${skill.outputDoc}`,
            skill.agent
              ? `Agent: ${this.model.agent(skill.agent).name}`
              : "Erfasst von der zuständigen Person",
            `Anstossen: ${who}`,
            `Entscheid: ${decides}${skill.veto ? " (mit Vetorecht)" : ""}`,
          ]),
        ].join("\n"),
      );
    }

    used.push("unbekannt");
    return reply(
      `Dafür habe ich ohne KI-Modell keine feste Antwort. Frag zum Beispiel:\n${bullets(DEFAULT_SUGGESTIONS.map((x) => `«${x}»`))}`,
    );
  }
}
