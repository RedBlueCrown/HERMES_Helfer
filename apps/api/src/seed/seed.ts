// Demo data for local development (todo-later P04). All projects and people
// are fictional. Seeding appends normal events, so the Verlauf shows them.

import {
  MODEL_VERSION,
  rolesOf,
  type Actor,
  type Decision,
  type PhaseId,
  type ProjectEvent,
  type ProjectProfile,
  type ProjectRole,
} from "@hermes-helfer/core";
import { randomUUID } from "node:crypto";
import { checkDraftStructure, mergeFindings } from "../agents/kritiker";
import { mockDraft, mockFindings } from "../agents/mock-provider";
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
            findings: mergeFindings(checkDraftStructure(skill, draft), mockFindings(skillId)),
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
            findings: checkDraftStructure(skill, draft),
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
  ) {
    const konsent = this.repo.model.skill(skillId).approvers.find((a) => a.role === role)?.konsent ?? false;
    await this.append(
      projectId,
      [{ type: "SkillDecisionRecorded", data: { skillId, role, decision, reason, konsent, conditions: [] } }],
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

/** Fictional projects to test lists and paging with 300+ projects. Visible to PMO and Portfolio. */
export async function seedSynthetic(repo: ProjectRepository, count: number, now = new Date()): Promise<void> {
  const rnd = prng(42);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rnd() * list.length)]!;
  const start = now.getTime() - 60 * 24 * 3600_000;
  const slot = (59 * 24 * 3600_000) / Math.max(count, 1);
  const seed = new Seeder(repo, new Date(start));
  seed.step = 1;
  const peter = dev("u-peter");
  for (let i = 1; i <= count; i++) {
    // Each project gets its own time slot in the past 60 days.
    seed.setClock(new Date(start + (i - 1) * slot));
    const code = `P-${String(i).padStart(4, "0")}`;
    if (await repo.findByCode(code)) continue;
    let r = rnd();
    const phase = PHASE_WEIGHTS.find(([, w]) => (r -= w) < 0)?.[0] ?? "init";
    const pl = { id: `x-pl-${i}`, displayName: `${pick(FIRST)} ${pick(LAST)}`, globalRoles: [] };
    const pa = { id: `x-pa-${i}`, displayName: `${pick(FIRST)} ${pick(LAST)}`, globalRoles: [] };
    const projectId = await seed.project(
      code,
      `${pick(KINDS)} ${pick(TOPICS)}`,
      "Synthetisches Vorhaben für Last- und Darstellungstests.",
      phase,
      { ...PROFILE, schnittstellen: Math.floor(rnd() * 3), personendaten: rnd() > 0.5 },
      [
        [pl, "PL", "BC", "FACH", "TEST", "ARCH", "APM", "INFRA"],
        [pa, "PA", "ISM", "DS"],
      ],
      peter,
    );
    // Some progress, so the list shows varied states.
    const mandatory = repo.model
      .phase(phase)
      .deliverables.filter((d) => d.requirement === "pflicht" && !d.preExisting);
    const done = Math.floor(rnd() * mandatory.length);
    for (const d of mandatory.slice(0, done)) {
      for (const sid of d.skills) {
        const st = (await repo.get(projectId))!;
        if (st.skills[sid]?.output) continue;
        const skill = repo.model.skill(sid);
        if (skill.requiresApproved?.length || skill.checklist) continue;
        if (skill.mode === "manual") await seed.manual(projectId, sid, pl, "Erfasst (synthetisch).");
        else await seed.run(projectId, sid, pl);
        for (const a of skill.approvers) {
          const by = a.role === "PA" || a.role === "ISM" || a.role === "DS" ? pa : pl;
          await seed.decide(projectId, sid, a.role, by, "Geprüft (synthetische Daten).");
        }
      }
      if ((await repo.get(projectId))!.unreleased[d.id]) await seed.release(projectId, d.id, pl);
    }
  }
}
