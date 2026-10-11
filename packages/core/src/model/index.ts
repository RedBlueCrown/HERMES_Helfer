import { AGENTS } from "./agents";
import { PHASES } from "./hermes-model";
import { DEFAULT_POLICY, type GovernancePolicy } from "./policy";
import type { AgentDef, AgentId, DeliverableDef, PhaseDef, PhaseId, SkillDef } from "./types";

/**
 * Model version stored on every project. Only this version exists in code so
 * far; decisions keep their basis in the record, so a change of the model does
 * not change decided facts (todo-later H12).
 */
export const MODEL_VERSION = "2026.10-pilot";

export interface HermesModel {
  readonly version: string;
  readonly phases: readonly PhaseDef[];
  readonly agents: readonly AgentDef[];
  /** Rules of the organisation that the checks apply (separation of duties). */
  readonly policy: GovernancePolicy;
  phase(id: PhaseId): PhaseDef;
  phaseIndex(id: PhaseId): number;
  nextPhase(id: PhaseId): PhaseDef | undefined;
  skill(id: string): SkillDef;
  findSkill(id: string): SkillDef | undefined;
  deliverable(id: string): DeliverableDef;
  findDeliverable(id: string): DeliverableDef | undefined;
  /** Deliverables a skill contributes to. */
  deliverablesOfSkill(skillId: string): readonly DeliverableDef[];
  agent(id: AgentId): AgentDef;
}

export function buildModel(
  phases: readonly PhaseDef[],
  agents: readonly AgentDef[],
  version: string,
  policy: GovernancePolicy = DEFAULT_POLICY,
): HermesModel {
  const phaseById = new Map(phases.map((p) => [p.id, p]));
  const skills = new Map<string, SkillDef>();
  const deliverables = new Map<string, DeliverableDef>();
  const bySkill = new Map<string, DeliverableDef[]>();
  for (const ph of phases) {
    for (const s of ph.skills) {
      if (skills.has(s.id)) throw new Error(`Duplicate skill id ${s.id}`);
      skills.set(s.id, s);
    }
    for (const d of ph.deliverables) {
      if (deliverables.has(d.id)) throw new Error(`Duplicate deliverable id ${d.id}`);
      deliverables.set(d.id, d);
      for (const sid of d.skills) {
        const list = bySkill.get(sid) ?? [];
        list.push(d);
        bySkill.set(sid, list);
      }
    }
  }
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const must = <T>(v: T | undefined, what: string): T => {
    if (v === undefined) throw new Error(`Unknown ${what}`);
    return v;
  };
  return {
    version,
    phases,
    agents,
    policy,
    phase: (id) => must(phaseById.get(id), `phase ${id}`),
    phaseIndex: (id) => phases.findIndex((p) => p.id === id),
    nextPhase: (id) => phases[phases.findIndex((p) => p.id === id) + 1],
    skill: (id) => must(skills.get(id), `skill ${id}`),
    findSkill: (id) => skills.get(id),
    deliverable: (id) => must(deliverables.get(id), `deliverable ${id}`),
    findDeliverable: (id) => deliverables.get(id),
    deliverablesOfSkill: (sid) => bySkill.get(sid) ?? [],
    agent: (id) => must(agentById.get(id), `agent ${id}`),
  };
}

export const MODEL: HermesModel = buildModel(PHASES, AGENTS, MODEL_VERSION);

/** The same model under another policy (the API's SEPARATION_OF_DUTIES setting). */
export const withPolicy = (model: HermesModel, policy: GovernancePolicy): HermesModel => ({
  ...model,
  policy,
});

export { AGENTS } from "./agents";
export { PHASES } from "./hermes-model";
export * from "./change-requests";
export * from "./participation";
export * from "./policy";
export * from "./risks";
export * from "./status-report";
export * from "./roles";
export * from "./types";
