// Demo data for local development (todo-later P04). All projects and people
// are fictional. Seeding appends normal events, so the Verlauf shows them.

import {
  CR_FLAGS,
  CR_FLAG_LABELS,
  CR_SECTIONS,
  DUE_OPTIONS,
  MODEL_VERSION,
  NO_FLAGS,
  nextCrNumber,
  gateStatus,
  openParticipation,
  rolesOf,
  type Actor,
  type ConditionSpec,
  type CrFlags,
  type Decision,
  type PhaseId,
  type ProjectEvent,
  type ProjectProfile,
  type ProjectRole,
} from "@hermes-helfer/core";
import { randomUUID } from "node:crypto";
import { checkChangeRequest, checkDraftStructure, mergeFindings } from "../agents/kritiker";
import { mockChangeRequest, mockDraft, mockFindings } from "../agents/mock-provider";
import { agentActor, projectContext } from "../agents/runner";
import { projectIdForCode, type ProjectRepository } from "../projects/repository";
import { DEV_USERS } from "./dev-users";

const PROFILE: ProjectProfile = {
  schutzbedarf: "mittel",
  personendaten: false,
  cloud: false,
  schnittstellen: 0,
  lieferant: false,
  verfuegbarkeit: "mittel",
  neueTechnologie: false,
  externeNutzende: false,
};

interface Person {
  id: string;
  displayName: string;
  globalRoles: string[];
}

const dev = (id: string): Person => {
  const u = DEV_USERS.find((x) => x.id === id);
  if (!u) throw new Error(`Unknown dev user ${id}`);
  return { id: u.id, displayName: u.displayName, globalRoles: u.globalRoles };
};

class Seeder {
  private clock: number;

  constructor(
    private readonly repo: ProjectRepository,
    start: Date,
  ) {
    this.clock = start.getTime();
  }

  /** Minutes between two seeded events. */
  step = 37;

  setClock(at: Date): void {
    this.clock = at.getTime();
  }

  private tick(): string {
    this.clock += this.step * 60_000;
    return new Date(this.clock).toISOString();
  }

  private async actor(projectId: string, p: Person): Promise<Actor> {
    const s = await this.repo.get(projectId);
    return {
      userId: p.id,
      displayName: p.displayName,
      roles: [...(s ? rolesOf(s, p.id) : []), ...p.globalRoles],
      channel: "web",
    };
  }

  private async append(projectId: string, events: ProjectEvent[], actor: Actor) {
    const s = await this.repo.get(projectId);
    await this.repo.append(projectId, s?.lastSeq ?? 0, events, actor, `seed-${randomUUID()}`, this.tick());
  }

  async project(
    code: string,
    name: string,
    description: string,
    phase: PhaseId,
    profile: ProjectProfile,
    members: [Person, ...ProjectRole[]][],
    by: Person,
  ): Promise<string> {
    const projectId = projectIdForCode(code);
    const events: ProjectEvent[] = [
      {
        type: "ProjectCreated",
        data: { code, name, description, phase, profile, modelVersion: MODEL_VERSION },
      },
      ...members.flatMap(([p, ...roles]) =>
        roles.map((role) => ({
          type: "MemberRoleAssigned" as const,
          data: { userId: p.id, displayName: p.displayName, role },
        })),
      ),
    ];
    await this.repo.append(
      projectId,
      0,
      events,
      { userId: by.id, displayName: by.displayName, roles: by.globalRoles, channel: "system" },
      `seed-${randomUUID()}`,
      this.tick(),
    );
    return projectId;
  }

  async run(projectId: string, skillId: string, by: Person) {
    const runId = randomUUID();
    await this.append(
      projectId,
      [{ type: "SkillRunRequested", data: { runId, skillId } }],
      await this.actor(projectId, by),
    );
    const model = this.repo.model;
    const skill = model.skill(skillId);
    const s = (await this.repo.get(projectId))!;
    const agent = model.agent(skill.agent!);
    const draft = mockDraft({
      agent,
      skill,
      deliverables: model.deliverablesOfSkill(skillId),
      project: projectContext(s, model, { userId: by.id, displayName: by.displayName, globalRoles: [] }),
    });
    await this.append(
      projectId,
      [
        {
          type: "SkillRunCompleted",
          data: {
            runId,
            skillId,
            draft,
            findings: mergeFindings(checkDraftStructure(skill.sections, draft), mockFindings(skillId)),
            producer: { kind: "ai", agent: agent.id, provider: "mock", model: "mock (ohne KI-Modell)" },
          },
        },
      ],
      agentActor(agent),
    );
  }

  async manual(projectId: string, skillId: string, by: Person, summary: string) {
    const runId = randomUUID();
    const skill = this.repo.model.skill(skillId);
    const draft = {
      summary,
      sections: skill.sections.map((heading) => ({
        heading,
        body: `${heading}: erfasst durch ${by.displayName}.`,
      })),
      openPoints: [],
    };
    await this.append(
      projectId,
      [
        { type: "SkillRunRequested", data: { runId, skillId } },
        {
          type: "SkillRunCompleted",
          data: {
            runId,
            skillId,
            draft,
            findings: checkDraftStructure(skill.sections, draft),
            producer: { kind: "human" },
          },
        },
      ],
      await this.actor(projectId, by),
    );
  }

  async decide(
    projectId: string,
    skillId: string,
    role: ProjectRole,
    by: Person,
    reason = "",
    decision: Decision = "freigegeben",
    conditions: ConditionSpec[] = [],
  ) {
    const konsent = this.repo.model.skill(skillId).approvers.find((a) => a.role === role)?.konsent ?? false;
    await this.append(
      projectId,
      [{ type: "SkillDecisionRecorded", data: { skillId, role, decision, reason, konsent, conditions } }],
      await this.actor(projectId, by),
    );
  }

  async gate(projectId: string, phase: PhaseId, decision: Decision, reason: string, by: Person) {
    const konsent = this.repo.model.phase(phase).gate.requiresKonsent && decision !== "zurückgewiesen";
    await this.append(
      projectId,
      [{ type: "GateDecisionRecorded", data: { phase, decision, reason, konsent, conditions: [] } }],
      await this.actor(projectId, by),
    );
  }

  /** A change request; `ai`: drafted with the Change-Request agent (offline variant). */
  async changeRequest(
    projectId: string,
    by: Person,
    cr: {
      title: string;
      requestedBy: string;
      effortDays: number;
      flags: CrFlags;
      description: string;
      ai?: boolean;
    },
  ): Promise<string> {
    const model = this.repo.model;
    const s = (await this.repo.get(projectId))!;
    const agent = model.agent("A10");
    const content = cr.ai
      ? mockChangeRequest({
          agent,
          project: projectContext(s, model, { userId: by.id, displayName: by.displayName, globalRoles: [] }),
          idea: { title: cr.title, description: cr.description, requestedBy: cr.requestedBy },
          sections: CR_SECTIONS,
          flags: CR_FLAGS.map((id) => ({ id, ...CR_FLAG_LABELS[id] })),
        }).content
      : {
          summary: cr.description,
          sections: CR_SECTIONS.map((heading) => ({
            heading,
            body: `${heading}: erfasst durch ${by.displayName} (${cr.requestedBy}).`,
          })),
          openPoints: [],
        };
    const crId = randomUUID();
    await this.append(
      projectId,
      [
        {
          type: "ChangeRequestSubmitted",
          data: {
            crId,
            number: nextCrNumber(s),
            title: cr.title,
            requestedBy: cr.requestedBy,
            effortDays: cr.effortDays,
            flags: cr.flags,
            content,
            findings: checkChangeRequest(content, cr.flags),
            producer: cr.ai
              ? { kind: "ai", agent: agent.id, provider: "mock", model: "mock (ohne KI-Modell)" }
              : { kind: "human" },
          },
        },
      ],
      await this.actor(projectId, by),
    );
    return crId;
  }

  async decideChangeRequest(projectId: string, crId: string, by: Person, decision: Decision, reason: string) {
    await this.append(
      projectId,
      [
        {
          type: "ChangeRequestDecided",
          data: { crId, decision, reason, konsent: decision !== "zurückgewiesen", conditions: [] },
        },
      ],
      await this.actor(projectId, by),
    );
  }

  async reserve(projectId: string, amountChf: number, by: Person) {
    await this.append(
      projectId,
      [{ type: "ChangeReserveSet", data: { amountChf } }],
      await this.actor(projectId, by),
    );
  }

  async completeCondition(projectId: string, conditionId: string, by: Person, note = "") {
    const text = (await this.repo.get(projectId))!.conditions[conditionId]?.text ?? "";
    await this.append(
      projectId,
      [{ type: "ConditionCompleted", data: { conditionId, text, note } }],
      await this.actor(projectId, by),
    );
  }

  async release(projectId: string, deliverableId: string, by: Person) {
    await this.append(
      projectId,
      [{ type: "DeliverableReleased", data: { deliverableId } }],
      await this.actor(projectId, by),
    );
  }

  async involve(projectId: string, phase: PhaseId, participantId: string, how: string, by: Person) {
    await this.append(
      projectId,
      [{ type: "ParticipationRecorded", data: { phase, participantId, how } }],
      await this.actor(projectId, by),
    );
  }

  async confirm(projectId: string, ownerId: string, itemId: string, by: Person, note = "") {
    await this.append(
      projectId,
      [{ type: "ChecklistItemConfirmed", data: { checklistOwnerId: ownerId, itemId, note } }],
      await this.actor(projectId, by),
    );
  }
}

export async function seedDemo(repo: ProjectRepository, now = new Date()): Promise<void> {
  const seed = new Seeder(repo, new Date(now.getTime() - 21 * 24 * 3600_000));
  const [anna, jonas, thomas, nina, marco, sandra, david, laura, tim, peter] = [
    "u-anna",
    "u-jonas",
    "u-thomas",
    "u-nina",
    "u-marco",
    "u-sandra",
    "u-david",
    "u-laura",
    "u-tim",
    "u-peter",
  ].map(dev) as [Person, Person, Person, Person, Person, Person, Person, Person, Person, Person];

  const team = (pl: Person, bc: Person): [Person, ...ProjectRole[]][] => [
    [pl, "PL"],
    [bc, "BC"],
    [thomas, "PA"],
    [nina, "FACH"],
    [marco, "ISM"],
    [sandra, "DS"],
    [david, "ARCH"],
    [laura, "APM"],
    [tim, "TEST", "INFRA"],
  ];

  // 1. Fresh project in Initialisierung: the full flow can be tried from the start.
  await seed.project(
    "KPO",
    "Kundenportal Self-Service",
    "Kundinnen und Kunden erfassen Anliegen online und sehen den Bearbeitungsstand.",
    "init",
    {
      ...PROFILE,
      personendaten: true,
      cloud: true,
      schnittstellen: 2,
      lieferant: true,
      externeNutzende: true,
    },
    team(anna, jonas),
    peter,
  );

  // 2. Konzept with open decisions and an ISDS veto.
  const crm = await seed.project(
    "CRM",
    "CRM-Ablösung Vertrieb",
    "Ablösung des bisherigen CRM durch eine Standardlösung in der Cloud.",
    "konzept",
    {
      ...PROFILE,
      schutzbedarf: "hoch",
      personendaten: true,
      cloud: true,
      schnittstellen: 3,
      lieferant: true,
    },
    team(anna, jonas),
    peter,
  );
  await seed.involve(crm, "konzept", "sach", "Workshop", anna);
  await seed.involve(crm, "konzept", "ea", "Architekturforum", anna);
  await seed.run(crm, "konzept.business-analyse", jonas);
  await seed.release(crm, "sysanf", anna);
  await seed.run(crm, "konzept.test-engineer", tim);
  await seed.release(crm, "testk", anna);
  await seed.run(crm, "konzept.technische-koordination", tim);
  await seed.run(crm, "konzept.pattern-pilot", david);
  await seed.decide(
    crm,
    "konzept.pattern-pilot",
    "ARCH",
    david,
    "Zwei Abweichungen als Muss-Kriterien übernommen.",
  );
  await seed.run(crm, "konzept.architekt", david);
  await seed.run(crm, "konzept.security-engineering", marco);
  await seed.run(crm, "konzept.isds", marco);

  // 3. Realisierung with a partly confirmed readiness check.
  const erp = await seed.project(
    "ERP",
    "ERP-Upgrade Finanzen",
    "Upgrade der Finanzbuchhaltung auf die aktuelle Release-Linie des Herstellers.",
    "real",
    { ...PROFILE, schnittstellen: 4, lieferant: true, verfuegbarkeit: "hoch" },
    team(jonas, anna).filter(([p]) => p !== anna),
    peter,
  );
  await seed.run(erp, "real.sprint-planer", jonas);
  await seed.release(erp, "backlog", jonas);
  await seed.manual(
    erp,
    "real.executer",
    david,
    "Release-Kandidat 2.3 auf der Testumgebung, 14 von 18 Tickets umgesetzt.",
  );
  await seed.run(erp, "real.technische-koordination", tim);
  await seed.confirm(erp, "readiness", "apm", laura, "Zugang mit Testkonto geprüft");
  await seed.confirm(erp, "readiness", "entwicklung", david);
  // Change requests: one accepted within the reserve, one waiting for the Projektausschuss.
  await seed.reserve(erp, 40_000, jonas);
  const filter = await seed.changeRequest(erp, nina, {
    title: "Zusätzlicher Filter in der Kreditorensuche",
    requestedBy: "Fachstelle Finanzen",
    effortDays: 6,
    flags: { ...NO_FLAGS, oberflaeche: true },
    description: "Die Kreditorensuche soll nach Zahlungsbedingung filtern können.",
  });
  await seed.decideChangeRequest(
    erp,
    filter,
    thomas,
    "freigegeben",
    "Geringer Aufwand, hoher Nutzen für die Kreditorenbuchhaltung.",
  );
  await seed.changeRequest(erp, nina, {
    title: "Export der offenen Posten als CSV für die Revision",
    requestedBy: "Revision",
    effortDays: 9,
    flags: { ...NO_FLAGS, daten: true, oberflaeche: true, extern: true },
    description:
      "Die externe Revision möchte die offenen Posten mit Kreditorennamen und Adressen als CSV-Export erhalten.",
    ai: true,
  });

  // 4. Einführung: go-live check waiting for criteria and the veto roles.
  const dap = await seed.project(
    "DAP",
    "Datenplattform Reporting",
    "Zentrale Datenplattform für das Management-Reporting.",
    "einf",
    { ...PROFILE, cloud: true, schnittstellen: 3 },
    team(jonas, jonas).filter(([, role]) => role !== "BC"),
    peter,
  );
  await seed.run(dap, "einf.einfuehrung", jonas);
  await seed.release(dap, "massn", jonas);
  await seed.run(dap, "einf.go-live-check", tim);
  await seed.confirm(dap, "einf.go-live-check", "betr", laura);
  await seed.confirm(dap, "einf.go-live-check", "komm", jonas);
  await seed.confirm(dap, "einf.go-live-check", "rest", jonas);

  // 5. Skalierung with a draft value report.
  const intra = await seed.project(
    "INT",
    "Intranet-Relaunch",
    "Neues Intranet auf Basis von SharePoint Online.",
    "skal",
    { ...PROFILE },
    team(anna, jonas),
    peter,
  );
  await seed.run(intra, "skal.wertnachweis", anna);
}

/** Deterministic pseudo-random numbers, so synthetic data is stable between runs. */
function prng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOPICS = [
  "Rechnungseingang",
  "Vertragsmanagement",
  "Personalportal",
  "Lagerverwaltung",
  "Kundenservice",
  "Zeiterfassung",
  "Dokumentenablage",
  "Reisekosten",
  "Lieferantenportal",
  "Qualitätsmanagement",
  "Wartungsplanung",
  "Schadenmeldung",
  "Onboarding",
  "Webshop",
  "Datenarchiv",
];
const KINDS = ["Digitalisierung", "Ablösung", "Einführung", "Modernisierung", "Ausbau", "Automatisierung"];
const FIRST = [
  "Laura",
  "Marc",
  "Sophie",
  "Lukas",
  "Mia",
  "Noah",
  "Elena",
  "David",
  "Lea",
  "Simon",
  "Nora",
  "Fabian",
];
const LAST = [
  "Frei",
  "Gerber",
  "Huber",
  "Keller",
  "Lang",
  "Meier",
  "Moser",
  "Roth",
  "Schmid",
  "Steiner",
  "Vogt",
  "Zimmermann",
];
const PHASE_WEIGHTS: [PhaseId, number][] = [
  ["init", 0.25],
  ["konzept", 0.3],
  ["real", 0.25],
  ["einf", 0.15],
  ["skal", 0.05],
];
const CONDITION_TEXTS = [
  "Restrisiken mit Verantwortlichen ergänzen",
  "Schnittstellenvereinbarung nachreichen",
  "Testabdeckung der Kernprozesse belegen",
  "Betriebsübergabe mit dem Applikationsmanagement terminieren",
];
const PL_ROLES: ProjectRole[] = ["PL", "BC", "FACH", "TEST", "ARCH", "APM", "INFRA"];
const DAY_MS = 24 * 3600_000;

/**
 * Fictional projects to test lists, paging and the portfolio with 300+ projects.
 * Visible to PMO and Portfolio. Their states vary: progress, Auflagen (some
 * overdue), open vetoes, a missing ISM, gates ready for a decision or rejected,
 * and a few projects without activity for over a month.
 */
export async function seedSynthetic(repo: ProjectRepository, count: number, now = new Date()): Promise<void> {
  const rnd = prng(42);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rnd() * list.length)]!;
  const chance = (p: number) => rnd() < p;
  const model = repo.model;
  const seed = new Seeder(repo, now);
  seed.step = 1;
  const peter = dev("u-peter");
  for (let i = 1; i <= count; i++) {
    const code = `P-${String(i).padStart(4, "0")}`;
    if (await repo.findByCode(code)) continue;
    let r = rnd();
    const phase = PHASE_WEIGHTS.find(([, w]) => (r -= w) < 0)?.[0] ?? "init";
    const pl = { id: `x-pl-${i}`, displayName: `${pick(FIRST)} ${pick(LAST)}`, globalRoles: [] };
    const pa = { id: `x-pa-${i}`, displayName: `${pick(FIRST)} ${pick(LAST)}`, globalRoles: [] };
    const paRoles: ProjectRole[] = chance(0.08) ? ["PA", "DS"] : ["PA", "ISM", "DS"];
    const holder = (role: ProjectRole) =>
      PL_ROLES.includes(role) ? pl : paRoles.includes(role) ? pa : undefined;

    const mandatory = model
      .phase(phase)
      .deliverables.filter((d) => d.requirement === "pflicht" && !d.preExisting);
    // A few projects complete their phase, so their gate waits for a decision; some of those were rejected.
    const complete = chance(0.08);
    const done = complete ? mandatory.length : Math.floor(rnd() * mandatory.length);
    const vetoPending = chance(0.08);

    // Most projects changed in the last two weeks, some not for over a month. Projects
    // with progress started up to half a year ago; the others were just created.
    const lastActive = now.getTime() - (chance(0.1) ? 31 + rnd() * 30 : rnd() * 14) * DAY_MS;
    const started = now.getTime() - (20 + rnd() * 160) * DAY_MS;
    const progress = done > 0 || vetoPending;
    seed.setClock(new Date(progress ? Math.min(started, lastActive - DAY_MS) : lastActive));
    const projectId = await seed.project(
      code,
      `${pick(KINDS)} ${pick(TOPICS)}`,
      "Synthetisches Vorhaben für Last- und Darstellungstests.",
      phase,
      { ...PROFILE, schnittstellen: Math.floor(rnd() * 3), personendaten: rnd() > 0.5 },
      [
        [pl, ...PL_ROLES],
        [pa, ...paRoles],
      ],
      peter,
    );
    // The progress events end shortly before lastActive.
    seed.setClock(new Date(lastActive - 0.25 * DAY_MS));
    const state = async () => (await repo.get(projectId))!;

    /** Decides the open approvals of a skill; false if a role is held by nobody. */
    const approve = async (sid: string): Promise<boolean> => {
      for (const a of model.skill(sid).approvers) {
        if ((await state()).skills[sid]?.approvals[a.role]) continue;
        const by = holder(a.role);
        if (!by) return false;
        if (chance(0.12)) {
          const condition = {
            id: randomUUID(),
            text: pick(CONDITION_TEXTS),
            ownerRole: a.role,
            due: pick(DUE_OPTIONS),
          };
          const reason = "Freigabe mit Auflage (synthetische Daten).";
          await seed.decide(projectId, sid, a.role, by, reason, "mit Auflagen", [condition]);
          if (chance(0.5)) await seed.completeCondition(projectId, condition.id, by, "Erledigt.");
        } else {
          await seed.decide(projectId, sid, a.role, by, "Geprüft (synthetische Daten).");
        }
      }
      return true;
    };
    const produce = async (sid: string) => {
      if ((await state()).skills[sid]?.output) return;
      if (model.skill(sid).mode === "manual") await seed.manual(projectId, sid, pl, "Erfasst (synthetisch).");
      else await seed.run(projectId, sid, pl);
    };
    const confirmAll = async (ownerId: string, items: readonly { id: string; ownerRole: ProjectRole }[]) => {
      for (const it of items) {
        if (!(await state()).checklist[`${ownerId}:${it.id}`]) {
          await seed.confirm(projectId, ownerId, it.id, holder(it.ownerRole) ?? pl);
        }
      }
    };
    /** Produces and approves a skill, with the skills it requires first. */
    const settle = async (sid: string): Promise<boolean> => {
      const skill = model.skill(sid);
      for (const pre of skill.requiresApproved ?? []) if (!(await settle(pre))) return false;
      await produce(sid);
      if (skill.checklist) await confirmAll(sid, skill.checklist.items);
      return approve(sid);
    };

    for (const d of mandatory.slice(0, done)) {
      let ok = true;
      for (const sid of d.skills) {
        const skill = model.skill(sid);
        if (!complete && (skill.requiresApproved?.length || skill.checklist)) {
          ok = false;
          continue;
        }
        ok = (await settle(sid)) && ok;
      }
      if (ok && d.checklist) await confirmAll(d.id, d.checklist.items);
      if (ok && (await state()).unreleased[d.id]) await seed.release(projectId, d.id, pl);
    }
    if (complete) {
      for (const x of openParticipation(await state(), model, phase)) {
        await seed.involve(projectId, phase, x.id, "Workshop", pl);
      }
      if (gateStatus(await state(), model, phase) === "ready" && chance(0.3)) {
        await seed.gate(
          projectId,
          phase,
          "zurückgewiesen",
          "Variantenvergleich unvollständig (synthetisch).",
          pa,
        );
      }
    }
    // Some projects wait for an ISDS or go-live veto.
    if (vetoPending) {
      const veto = model.phase(phase).skills.find((sk) => sk.veto);
      if (veto && !(await state()).skills[veto.id]?.output) {
        let ready = true;
        for (const pre of veto.requiresApproved ?? []) ready = (await settle(pre)) && ready;
        if (ready) await produce(veto.id);
      }
    }
  }
}
