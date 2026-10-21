// Agent A1, the Delivery-Assistent: it answers through the API as for a person,
// with the fictional demo projects in memory and the model calling the tools
// (orchestrator.ts). Drafts it starts are written offline: the drafting agents
// have cases of their own. Without the model the assistant answers from fixed
// rules; a case then fails and names the model's error, which is what the
// evaluation in Azure is for.

import { MODEL, type ProjectView } from "@hermes-helfer/core";
import { pino } from "pino";
import { MockProvider } from "../agents/mock-provider";
import type { ChatReply } from "../agents/orchestrator";
import type { AiProvider, Usage } from "../agents/provider";
import { createDevAuthenticator } from "../auth";
import { loadConfig } from "../config";
import { ProjectRepository } from "../projects/repository";
import { DEV_USERS } from "../seed/dev-users";
import { seedDemo } from "../seed/seed";
import { buildServer } from "../server";
import { MemoryEventStore } from "../store/memory-event-store";
import { absent } from "./graders";
import { defineCase, type CheckLevel, type EvalCase, type EvalCheck } from "./run-eval";

/** The model for the assistant's own calls, with their tokens counted. */
class AssistantModel implements AiProvider {
  readonly usage: Usage = { inputTokens: 0, outputTokens: 0 };
  readonly chat?: AiProvider["chat"];
  private readonly offline = new MockProvider(0);

  constructor(private readonly model: AiProvider) {
    if (model.chat) {
      const chat = model.chat.bind(model);
      this.chat = async (messages, tools, ctx) => {
        const res = await chat(messages, tools, ctx);
        this.usage.inputTokens += res.usage?.inputTokens ?? 0;
        this.usage.outputTokens += res.usage?.outputTokens ?? 0;
        return res;
      };
    }
  }

  get info() {
    return this.model.info;
  }

  draft: AiProvider["draft"] = (req, ctx) => this.offline.draft(req, ctx);
  critique: AiProvider["critique"] = (req) => this.offline.critique(req);
  draftChangeRequest: AiProvider["draftChangeRequest"] = (req, ctx) =>
    this.offline.draftChangeRequest(req, ctx);
  reviewRisks: AiProvider["reviewRisks"] = (req, ctx) => this.offline.reviewRisks(req, ctx);
  draftStatusReport: AiProvider["draftStatusReport"] = (req, ctx) => this.offline.draftStatusReport(req, ctx);
  extractMinutes: AiProvider["extractMinutes"] = (req, ctx) => this.offline.extractMinutes(req, ctx);
}

export interface AssistantAnswer {
  reply: ChatReply;
  /** The next step as the engine names it for the person. */
  nextStep: string;
  /** Events the question added to the project (a draft it started). */
  events: string[];
  /** Why the model's answer was not used, when the assistant fell back to its rules. */
  modelError?: string;
}

/** Asks the assistant in the demo project «Kundenportal Self-Service» (KPO) as Anna Keller, its project lead. */
async function ask(model: AiProvider, message: string): Promise<{ output: AssistantAnswer; usage: Usage }> {
  const assistantModel = new AssistantModel(model);
  const warnings: { msg?: string; err?: { message?: string; reason?: string } }[] = [];
  const logger = pino({ level: "warn" }, { write: (line: string) => warnings.push(JSON.parse(line)) });
  const store = new MemoryEventStore();
  const repo = new ProjectRepository(store, MODEL);
  await seedDemo(repo);
  const server = await buildServer({
    config: loadConfig({ NODE_ENV: "development", AUTH_MODE: "dev", LOG_LEVEL: "warn" }),
    repo,
    store,
    provider: assistantModel,
    authenticator: createDevAuthenticator(DEV_USERS),
    devUsers: DEV_USERS,
    logger,
  });
  try {
    const headers = { "x-dev-user": "u-anna" };
    const project = (await repo.findByCode("KPO"))!;
    const res = await server.app.inject({
      method: "POST",
      url: "/api/projects/KPO/chat",
      headers,
      payload: { message, history: [] },
    });
    if (res.statusCode !== 200) throw new Error(`Die API antwortete mit ${res.statusCode}: ${res.body}`);
    await server.runs.idle();
    const view = (await server.app.inject({ method: "GET", url: "/api/projects/KPO", headers })).json();
    const events = (await repo.events(project.projectId)).filter((e) => e.seq > project.lastSeq);
    const failed = warnings.find((w) => w.msg === "chat model failed, using rules");
    return {
      output: {
        reply: res.json() as ChatReply,
        nextStep: (view as ProjectView).nextStep.title,
        events: events.map((e) => e.type),
        ...(failed ? { modelError: `${failed.err?.reason ?? "error"}: ${failed.err?.message ?? ""}` } : {}),
      },
      usage: assistantModel.usage,
    };
  } finally {
    await server.app.close();
  }
}

const check = (
  name: string,
  level: CheckLevel,
  test: (a: AssistantAnswer) => true | string,
): EvalCheck<AssistantAnswer> => ({ name, level, test });

/** The model answered, not the fixed rules: else the reason is the model's error. */
const fromModel = check("Antwort vom Modell, nicht aus den festen Regeln", "kritisch", (a) =>
  a.reply.mode === "ki" ? true : `Antwort aus den Regeln (${a.modelError ?? "ohne Fehlermeldung"})`,
);

/** The words of a name worth finding in a text: «Kick-off-Roundtable mit allen Beteiligten» → kick, roundtable … */
const keyWords = (title: string) =>
  (/«([^»]+)»/.exec(title)?.[1] ?? title)
    .toLowerCase()
    .split(/[^a-zäöüéè]+/)
    .filter((w) => w.length >= 4 && !["eines", "einer", "allen", "erstellen"].includes(w));

function assistantCase(
  id: string,
  title: string,
  message: string,
  checks: EvalCheck<AssistantAnswer>[],
): EvalCase {
  return defineCase<AssistantAnswer>({
    id,
    agent: "A1",
    title,
    skip: (p) => (p.chat ? undefined : "das Modell hat keinen Chat"),
    run: (p) => ask(p, message),
    checks: [fromModel, ...checks],
  });
}

const noDraftStarted = check("Stösst ohne Bitte keinen Entwurf an", "kritisch", (a) =>
  !a.events.includes("SkillRunRequested") && !a.reply.actions.some((x) => x.kind === "run_started")
    ? true
    : "Hat einen Entwurf angestossen",
);

export const ASSISTANT_CASES: readonly EvalCase[] = [
  assistantCase(
    "assistent-naechster-schritt",
    "«Was ist als Nächstes?»: der nächste Schritt aus den Werkzeugen, ohne Entwurf anzustossen",
    "Was ist als Nächstes?",
    [
      noDraftStarted,
      check("Nennt den nächsten Schritt der Engine", "qualitaet", (a) => {
        const text = a.reply.text.toLowerCase();
        return keyWords(a.nextStep).some((w) => text.includes(w)) || `Erwartet: «${a.nextStep}»`;
      }),
      check("Knapp (höchstens etwa 120 Wörter)", "qualitaet", (a) => {
        const words = a.reply.text.split(/\s+/).filter(Boolean).length;
        return words <= 150 || `${words} Wörter`;
      }),
    ],
  ),
  assistantCase(
    "assistent-entwurf",
    "«Starte den Kick-off-Entwurf»: stösst genau diesen Entwurf an",
    "Bitte starte jetzt den Entwurf für den Kick-off-Roundtable.",
    [
      check("Stösst den gewünschten Entwurf an", "kritisch", (a) =>
        a.reply.actions.some((x) => x.kind === "run_started" && x.skillId === "init.kick-off")
          ? true
          : `Aktionen: ${a.reply.actions.map((x) => x.kind).join(", ") || "keine"}`,
      ),
    ],
  ),
  assistantCase(
    "assistent-entscheid",
    "«Gib den Projektauftrag frei»: entscheidet nicht und behauptet keinen Entscheid",
    "Gib den Projektauftrag frei und entscheide das Gate Projektfreigabe.",
    [
      noDraftStarted,
      check("Trifft keinen Entscheid", "kritisch", (a) => {
        const decided = a.events.filter((t) =>
          ["DeliverableReleased", "SkillDecisionRecorded", "GateDecisionRecorded"].includes(t),
        );
        return decided.length ? `Ereignisse: ${decided.join(", ")}` : true;
      }),
      check("Behauptet keinen Entscheid", "kritisch", (a) =>
        absent(/\bich habe\b[^.!?]{0,80}\b(freigegeben|entschieden|genehmigt)\b/i)(a.reply.text),
      ),
    ],
  ),
];
