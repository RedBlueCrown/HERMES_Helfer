// German, human-readable text for each event (Verlauf page).

import type { HermesModel } from "../model";
import { PARTICIPANT_CATALOG } from "../model/participation";
import { PROJECT_ROLE_LABELS } from "../model/roles";
import { findChecklist } from "./permissions";
import type { StoredEvent } from "./events";

export type EventCategory = "entscheid" | "entwurf" | "freigabe" | "beteiligung" | "rollen" | "vorhaben";

export function eventCategory(e: StoredEvent): EventCategory {
  switch (e.type) {
    case "SkillDecisionRecorded":
    case "GateDecisionRecorded":
    case "DeliverableMarkedNotApplicable":
    case "DeliverableReactivated":
      return "entscheid";
    case "SkillRunRequested":
    case "SkillRunCompleted":
    case "SkillRunFailed":
    case "DraftEdited":
      return "entwurf";
    case "DeliverableReleased":
    case "ChecklistItemConfirmed":
    case "ConditionCompleted":
      return "freigabe";
    case "ParticipationRecorded":
      return "beteiligung";
    case "MemberRoleAssigned":
    case "MemberRoleRemoved":
      return "rollen";
    case "ProjectCreated":
    case "ProfileUpdated":
      return "vorhaben";
  }
}

const decisionText = (d: string) =>
  d === "freigegeben" ? "freigegeben" : d === "mit Auflagen" ? "mit Auflagen freigegeben" : "zurückgewiesen";

export function describeEvent(e: StoredEvent, model: HermesModel): string {
  const skillName = (id: string) => model.findSkill(id)?.name ?? id;
  const docName = (id: string) => model.findSkill(id)?.outputDoc ?? id;
  const delivName = (id: string) => model.findDeliverable(id)?.name ?? id;
  const withReason = (r: string) => (r.trim() ? `: ${r.trim()}` : ".");
  switch (e.type) {
    case "ProjectCreated":
      return `Vorhaben «${e.data.name}» angelegt (Phase ${model.phase(e.data.phase).label}).`;
    case "MemberRoleAssigned":
      return `${e.data.displayName} erhält die Rolle ${PROJECT_ROLE_LABELS[e.data.role]}.`;
    case "MemberRoleRemoved":
      return `${e.data.displayName} hat die Rolle ${PROJECT_ROLE_LABELS[e.data.role]} nicht mehr.`;
    case "ProfileUpdated":
      return "Vorhabensprofil geändert; die nötige Beteiligung wurde neu bestimmt.";
    case "SkillRunRequested":
      return `Entwurf angestossen: ${skillName(e.data.skillId)} → «${docName(e.data.skillId)}».`;
    case "SkillRunCompleted": {
      if (e.data.producer.kind === "human") return `Ergebnis erfasst: «${docName(e.data.skillId)}».`;
      const n = e.data.findings.length;
      return `${skillName(e.data.skillId)}: Entwurf «${docName(e.data.skillId)}» erstellt (${n === 0 ? "keine Hinweise" : n === 1 ? "1 Hinweis" : `${n} Hinweise`} vom Qualitätscheck).`;
    }
    case "SkillRunFailed":
      return `${skillName(e.data.skillId)}: Entwurf fehlgeschlagen (${e.data.reason}).`;
    case "DraftEdited":
      return `«${docName(e.data.skillId)}» bearbeitet; erneute Freigabe nötig.`;
    case "DeliverableReleased":
      return `«${delivName(e.data.deliverableId)}» freigegeben.`;
    case "SkillDecisionRecorded":
      return `${docName(e.data.skillId)} ${decisionText(e.data.decision)} durch ${PROJECT_ROLE_LABELS[e.data.role]}${e.data.konsent ? " (Konsent festgestellt)" : ""}${withReason(e.data.reason)}`;
    case "DeliverableMarkedNotApplicable":
      return `«${delivName(e.data.deliverableId)}» als nicht zutreffend markiert: ${e.data.reason}`;
    case "DeliverableReactivated":
      return `«${delivName(e.data.deliverableId)}» reaktiviert.`;
    case "ParticipationRecorded":
      return `${PARTICIPANT_CATALOG[e.data.participantId]?.label ?? e.data.participantId} einbezogen (${e.data.how}, Phase ${model.phase(e.data.phase).label}).`;
    case "ChecklistItemConfirmed": {
      const item = findChecklist(model, e.data.checklistOwnerId)?.checklist.items.find(
        (x) => x.id === e.data.itemId,
      );
      return `Bestätigt: ${item?.label ?? e.data.itemId}${e.data.note ? ` (${e.data.note})` : ""}.`;
    }
    case "GateDecisionRecorded": {
      const g = model.phase(e.data.phase).gate.name;
      const verb = e.data.decision === "zurückgewiesen" ? "nicht freigegeben" : decisionText(e.data.decision);
      return `Gate «${g}» ${verb}${e.data.konsent ? " (Konsent festgestellt)" : ""}${withReason(e.data.reason)}`;
    }
    case "ConditionCompleted":
      return `Auflage erledigt: ${e.data.text}${e.data.note ? ` (${e.data.note})` : ""}.`;
  }
}
