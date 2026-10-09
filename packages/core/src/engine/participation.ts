// Required participants per phase: base list plus rules on the project profile
// (prototype: partsFor / partOpen).

import type { HermesModel } from "../model";
import { PARTICIPANT_CATALOG, PARTICIPATION_RULES, PHASE_PARTICIPANTS } from "../model/participation";
import type { ParticipantDef, PhaseId, ProjectProfile } from "../model/types";
import { participationKey, type ProjectState } from "./state";

export interface ParticipantRequirement extends ParticipantDef {
  required: boolean;
  /** Labels of the rules that made this party mandatory. */
  triggers: string[];
}

export function participantsFor(
  _model: HermesModel,
  profile: ProjectProfile,
  phase: PhaseId,
): ParticipantRequirement[] {
  const list: ParticipantRequirement[] = PHASE_PARTICIPANTS[phase].map((x) => ({ ...x, triggers: [] }));
  for (const rule of PARTICIPATION_RULES) {
    if (!rule.when(profile)) continue;
    for (const id of rule.add[phase] ?? []) {
      let entry = list.find((x) => x.id === id);
      if (!entry) {
        const def = PARTICIPANT_CATALOG[id];
        if (!def) throw new Error(`Unknown participant ${id} in rule ${rule.id}`);
        entry = { ...def, required: true, triggers: [] };
        list.push(entry);
      }
      entry.required = true;
      if (!entry.triggers.includes(rule.label)) entry.triggers.push(rule.label);
    }
  }
  return list;
}

export function isInvolved(
  s: ProjectState,
  model: HermesModel,
  phase: PhaseId,
  participantId: string,
): boolean {
  const closed = s.passed.includes(phase) || model.phaseIndex(phase) < model.phaseIndex(s.phase);
  return closed || !!s.participation[participationKey(phase, participantId)];
}

export function openParticipation(
  s: ProjectState,
  model: HermesModel,
  phase: PhaseId,
): ParticipantRequirement[] {
  return participantsFor(model, s.profile, phase).filter(
    (x) => x.required && !isInvolved(s, model, phase, x.id),
  );
}
