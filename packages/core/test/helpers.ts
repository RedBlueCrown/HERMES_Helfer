import {
  MODEL,
  MODEL_VERSION,
  foldEvents,
  type Actor,
  type PhaseId,
  type ProjectEvent,
  type ProjectProfile,
  type ProjectRole,
  type StoredEvent,
  type Viewer,
} from "../src";

export const PROFILE: ProjectProfile = {
  schutzbedarf: "mittel",
  personendaten: false,
  cloud: false,
  schnittstellen: 0,
  lieferant: false,
  verfuegbarkeit: "mittel",
  neueTechnologie: false,
  externeNutzende: false,
};

export const SYSTEM: Actor = { userId: "system", displayName: "System", roles: [], channel: "system" };

export const viewer = (userId: string, ...globalRoles: Viewer["globalRoles"][number][]): Viewer => ({
  userId,
  displayName: userId,
  globalRoles: ["HH.User", ...globalRoles],
});

/** Builds a project stream in memory; envelopes are filled with plausible values. */
export class Stream {
  readonly events: StoredEvent[] = [];
  private clock = Date.UTC(2026, 9, 1, 8, 0, 0);
  private ids = 0;

  constructor(phase: PhaseId = "init", profile: ProjectProfile = PROFILE) {
    this.add({
      type: "ProjectCreated",
      data: {
        code: "TST",
        name: "Testvorhaben",
        description: "",
        phase,
        profile,
        modelVersion: MODEL_VERSION,
      },
    });
  }

  add(event: ProjectEvent, actor: Actor = SYSTEM): this {
    this.clock += 60_000;
    const seq = this.events.length + 1;
    this.events.push({
      ...event,
      projectId: "p-test",
      seq,
      id: `e${seq}`,
      at: new Date(this.clock).toISOString(),
      actor,
      correlationId: "c-test",
      prevHash: "",
      hash: "",
    } as StoredEvent);
    return this;
  }

  member(userId: string, ...roles: ProjectRole[]): this {
    for (const role of roles)
      this.add({ type: "MemberRoleAssigned", data: { userId, displayName: userId, role } });
    return this;
  }

  /** A completed AI run for a skill. */
  run(skillId: string, actor: Actor = SYSTEM): this {
    const runId = `r${++this.ids}`;
    const skill = MODEL.skill(skillId);
    this.add({ type: "SkillRunRequested", data: { runId, skillId } }, actor);
    return this.add(
      {
        type: "SkillRunCompleted",
        data: {
          runId,
          skillId,
          draft: {
            summary: `Entwurf ${skill.outputDoc}`,
            sections: skill.sections.map((heading) => ({ heading, body: `Inhalt zu ${heading}` })),
            openPoints: [],
          },
          findings: [],
          producer: { kind: "ai", agent: skill.agent ?? "A2", provider: "mock", model: "mock" },
        },
      },
      { ...SYSTEM, channel: "agent" },
    );
  }

  requested(skillId: string): this {
    return this.add({ type: "SkillRunRequested", data: { runId: `r${++this.ids}`, skillId } });
  }

  decide(
    skillId: string,
    role: ProjectRole,
    decision: "freigegeben" | "mit Auflagen" | "zurückgewiesen" = "freigegeben",
  ) {
    return this.add({
      type: "SkillDecisionRecorded",
      data: { skillId, role, decision, reason: "Begründung", konsent: true, conditions: [] },
    });
  }

  release(deliverableId: string): this {
    return this.add({ type: "DeliverableReleased", data: { deliverableId } });
  }

  involve(phase: PhaseId, participantId: string): this {
    return this.add({ type: "ParticipationRecorded", data: { phase, participantId, how: "Workshop" } });
  }

  confirm(ownerId: string, itemId: string): this {
    return this.add({
      type: "ChecklistItemConfirmed",
      data: { checklistOwnerId: ownerId, itemId, note: "" },
    });
  }

  state() {
    return foldEvents(this.events, MODEL);
  }
}

/** Completes every mandatory deliverable of the current phase (runs, decisions, releases, checklists). */
export function completeMandatory(stream: Stream, phase: PhaseId): Stream {
  const ph = MODEL.phase(phase);
  for (const d of ph.deliverables.filter((x) => x.requirement === "pflicht" && !x.preExisting)) {
    for (const sid of d.skills) {
      const st = stream.state();
      if (!st.skills[sid]?.output) {
        const skill = MODEL.skill(sid);
        for (const pre of skill.requiresApproved ?? []) {
          if (!stream.state().skills[pre]?.output) stream.run(pre);
          for (const a of MODEL.skill(pre).approvers) {
            if (!stream.state().skills[pre]?.approvals[a.role]) {
              for (const it of MODEL.skill(pre).checklist?.items ?? []) {
                if (!stream.state().checklist[`${pre}:${it.id}`]) stream.confirm(pre, it.id);
              }
              stream.decide(pre, a.role);
            }
          }
        }
        stream.run(sid);
      }
      const skill = MODEL.skill(sid);
      for (const it of skill.checklist?.items ?? []) {
        if (!stream.state().checklist[`${sid}:${it.id}`]) stream.confirm(sid, it.id);
      }
      for (const a of skill.approvers) {
        if (!stream.state().skills[sid]?.approvals[a.role]) stream.decide(sid, a.role);
      }
    }
    for (const it of d.checklist?.items ?? []) {
      if (!stream.state().checklist[`${d.id}:${it.id}`]) stream.confirm(d.id, it.id);
    }
  }
  for (const d of ph.deliverables) if (stream.state().unreleased[d.id]) stream.release(d.id);
  return stream;
}
