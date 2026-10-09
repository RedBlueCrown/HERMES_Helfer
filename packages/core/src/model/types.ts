// Types of the HERMES model (configuration). The engine interprets these;
// nothing here performs I/O.

export const PHASE_IDS = ["init", "konzept", "real", "einf", "skal"] as const;
export type PhaseId = (typeof PHASE_IDS)[number];

/** Roles a person holds within one project. Managed in the app (architecture §6). */
export const PROJECT_ROLES = ["PL", "BC", "PA", "FACH", "TEST", "ISM", "DS", "ARCH", "APM", "INFRA"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** Roles across all projects. Delivered as Entra ID app roles in the token. */
export const GLOBAL_ROLES = ["HH.User", "HH.PMO", "HH.Portfolio", "HH.Admin"] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

export const AGENT_IDS = [
  "A1",
  "A2",
  "A3",
  "A4",
  "A5",
  "A6",
  "A7",
  "A8",
  "A9",
  "A10",
  "A11",
  "A12",
  "A13",
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** Where a model element comes from: HERMES itself, an extension, or stakeholder interviews. */
export type Origin = "hermes" | "erweiterung" | "interviews";

export type Requirement = "pflicht" | "situativ";

export interface ApproverDef {
  role: ProjectRole;
  /** Label shown in the UI, e.g. "Architektur-Board" for the ARCH role. */
  label: string;
  /** The decision is taken by a committee and needs "Konsent festgestellt". */
  konsent: boolean;
}

export interface ChecklistItemDef {
  id: string;
  label: string;
  ownerRole: ProjectRole;
}

export interface ChecklistDef {
  title: string;
  /** Items can only be confirmed once this skill has produced a result. */
  availableAfterSkill: string;
  /** "release": the deliverable is not done before all items are confirmed.
   *  "approval": the skill cannot be approved before all items are confirmed. */
  requiredFor: "release" | "approval";
  items: readonly ChecklistItemDef[];
}

export interface SkillDef {
  /** Unique: `${phase}.${slug}` */
  id: string;
  phase: PhaseId;
  name: string;
  /** Agent that drafts the result; null for manual skills. */
  agent: AgentId | null;
  /** "ai-draft": an agent drafts. "manual": the responsible person records the result. */
  mode: "ai-draft" | "manual";
  /** Roles that may start the skill in addition to the PL. */
  mayStart: readonly ProjectRole[];
  /** Human decisions required before the result counts. Empty: a document the PL releases. */
  approvers: readonly ApproverDef[];
  /** Approvers can block the gate. */
  veto: boolean;
  description: string;
  outputDoc: string;
  /** Sections the output must contain (placeholders until the templates exist). */
  sections: readonly string[];
  isNew: boolean;
  origin: Origin;
  checklist?: ChecklistDef;
  /** Skills that must be fully approved before this one may start. */
  requiresApproved?: readonly string[];
}

export interface DeliverableDef {
  id: string;
  phase: PhaseId;
  name: string;
  requirement: Requirement;
  kind: string;
  skills: readonly string[];
  origin: Origin;
  /** Content readable only by roles with need-to-know (architecture §6). */
  restricted: boolean;
  /** Delivered before the project starts in the app, e.g. by the Auftraggeber. */
  preExisting?: { by: string };
  checklist?: ChecklistDef;
}

export interface GateDef {
  name: string;
  deciderLabel: string;
  deciders: readonly ProjectRole[];
  globalDeciders: readonly GlobalRole[];
  note: string;
  requiresKonsent: boolean;
}

export interface PhaseDef {
  id: PhaseId;
  label: string;
  description: string;
  /** Not part of HERMES (Skalierung). */
  extension: boolean;
  gate: GateDef;
  deliverables: readonly DeliverableDef[];
  skills: readonly SkillDef[];
}

export type Level = "niedrig" | "mittel" | "hoch";

/** Project profile: drives which roles must be involved per phase. */
export interface ProjectProfile {
  schutzbedarf: Level;
  personendaten: boolean;
  cloud: boolean;
  schnittstellen: number;
  lieferant: boolean;
  verfuegbarkeit: Level;
  neueTechnologie: boolean;
  externeNutzende: boolean;
}

export interface ParticipantDef {
  id: string;
  label: string;
  why: string;
  /** Role responsible for involving this party; for display. */
  ownerRole: ProjectRole;
}

export interface ParticipationRule {
  id: string;
  label: string;
  when: (profile: ProjectProfile) => boolean;
  add: Partial<Record<PhaseId, readonly string[]>>;
}

export interface AgentDef {
  id: AgentId;
  name: string;
  description: string;
  /** Active in the current increment. */
  active: boolean;
}
