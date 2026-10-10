// Portfolio (architecture §7): one summary per project, the signals that a
// project needs attention, and the key figures across projects.
//
// The summary is the read model behind the project list and the portfolio page.
// It is the same for every viewer and changes only with new events, so the API
// keeps one per project version; the viewer's roles and the clock are applied
// per request. Figures are per project, never per person (architecture §9.6).

import type { HermesModel } from "../model";
import type { PhaseId, ProjectRole } from "../model/types";
import { conditionDue } from "./conditions";
import { rolesOf, type Viewer } from "./permissions";
import type { ProjectState } from "./state";
import {
  gateStatus,
  isFinished,
  isPhaseCurrent,
  mandatoryProgress,
  missingRoles,
  skillStatus,
  type GateStatus,
} from "./status";
import { GATE_STATUS_LABELS } from "./views";

const DAY_MS = 24 * 60 * 60 * 1000;

/** No new entry in the Projektakte for this many days: the project counts as inactive (question F29). */
export const INACTIVE_AFTER_DAYS = 30;

export const SIGNAL_IDS = [
  "veto",
  "auflagen-ueberfaellig",
  "gate-zurueckgewiesen",
  "rollen-fehlen",
  "ohne-aktivitaet",
  "gate-bereit",
] as const;
export type SignalId = (typeof SIGNAL_IDS)[number];
export type SignalLevel = "hoch" | "mittel" | "info";

export interface SignalDef {
  label: string;
  level: SignalLevel;
  description: string;
}

/** What calls for action in a project ("Handlungsbedarf"), most urgent first. */
export const SIGNALS: Readonly<Record<SignalId, SignalDef>> = {
  veto: {
    label: "Veto offen",
    level: "hoch",
    description: "Ein Entscheid mit Veto (z. B. ISDS, Go-live) ist offen und blockiert das Gate.",
  },
  "auflagen-ueberfaellig": {
    label: "Auflagen überfällig",
    level: "hoch",
    description: "Mindestens eine Auflage ist nach ihrer Frist noch offen.",
  },
  "gate-zurueckgewiesen": {
    label: "Gate zurückgewiesen",
    level: "mittel",
    description: "Der letzte Gate-Entscheid der aktuellen Phase lautet «zurückgewiesen».",
  },
  "rollen-fehlen": {
    label: "Rollen unbesetzt",
    level: "mittel",
    description: "Eine Rolle, die in der aktuellen Phase entscheidet, hat niemand im Vorhaben.",
  },
  "ohne-aktivitaet": {
    label: "Ohne Aktivität",
    level: "mittel",
    description: `Seit mindestens ${INACTIVE_AFTER_DAYS} Tagen kein neuer Eintrag in der Projektakte.`,
  },
  "gate-bereit": {
    label: "Gate-Entscheid fällig",
    level: "info",
    description: "Alle Kriterien sind erfüllt; das Gate wartet auf den Entscheid.",
  },
};

const LEVEL_RANK: Readonly<Record<SignalLevel, number>> = { hoch: 3, mittel: 2, info: 1 };

// ---------- Summary (read model) ----------

/** Facts about one project that depend neither on the viewer nor on the clock. */
export interface ProjectSummary {
  projectId: string;
  code: string;
  name: string;
  phase: PhaseId;
  phaseLabel: string;
  gateName: string;
  gateStatus: GateStatus;
  /** The Portfolio-Gremium decides this gate (Projektfreigabe, Skalierungsentscheid). */
  portfolioGate: boolean;
  mandatoryDone: number;
  mandatoryTotal: number;
  /** Pending decisions on results of the current phase. */
  openDecisions: number;
  openConditions: number;
  /** Due dates of open Auflagen that have one; whether they are overdue depends on the clock. */
  openConditionDueDates: string[];
  /** Open Auflagen that were due at a gate which has been passed since. */
  openConditionsPastGate: number;
  /** Roles that decide in the current phase and that nobody in the project holds. */
  missingRoles: ProjectRole[];
  /** The last gate decision of the current phase was a rejection. */
  gateRejected: boolean;
  projectLeads: string[];
  finished: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeq: number;
}

export function projectSummary(s: ProjectState, model: HermesModel): ProjectSummary {
  const phase = model.phase(s.phase);
  const finished = isFinished(s, model);
  const current = isPhaseCurrent(s, s.phase);
  const pending = current
    ? phase.skills.filter((sk) => ["approval", "veto"].includes(skillStatus(s, model, sk)))
    : [];
  const open = Object.values(s.conditions).filter((c) => !c.doneAt);
  const dueDates: string[] = [];
  let pastGate = 0;
  for (const c of open) {
    const due = conditionDue(model, c);
    if (due.kind === "date") dueDates.push(due.at);
    else if (due.kind === "gate" && s.passed.includes(due.phase)) pastGate++;
  }
  const { done, total } = mandatoryProgress(s, model, s.phase);
  return {
    projectId: s.projectId,
    code: s.code,
    name: s.name,
    phase: s.phase,
    phaseLabel: phase.label,
    gateName: phase.gate.name,
    gateStatus: gateStatus(s, model, s.phase),
    portfolioGate: phase.gate.globalDeciders.includes("HH.Portfolio"),
    mandatoryDone: done,
    mandatoryTotal: total,
    openDecisions: pending.length,
    openConditions: open.length,
    openConditionDueDates: dueDates.sort(),
    openConditionsPastGate: pastGate,
    missingRoles: current ? missingRoles(s, model, s.phase) : [],
    gateRejected: current && s.gateDecisions[s.phase]?.at(-1)?.decision === "zurückgewiesen",
    projectLeads: Object.values(s.members)
      .filter((m) => m.roles.includes("PL"))
      .map((m) => m.displayName),
    finished,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    lastSeq: s.lastSeq,
  };
}

/** Open Auflagen past their due date or gate (same rule as isConditionOverdue). */
export function overdueConditions(p: ProjectSummary, now: Date): number {
  const t = now.getTime();
  return p.openConditionsPastGate + p.openConditionDueDates.filter((at) => t > Date.parse(at)).length;
}

/** Whole days since the last entry in the Projektakte. */
export function inactiveDays(p: ProjectSummary, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(p.updatedAt)) / DAY_MS));
}

/** The project's signals, in the order of SIGNAL_IDS (most urgent first). */
export function projectSignals(p: ProjectSummary, now: Date): SignalId[] {
  const on: Record<SignalId, boolean> = {
    // A pending veto on a mandatory result blocks the gate (status.ts).
    veto: !p.finished && p.gateStatus === "blocked",
    "auflagen-ueberfaellig": overdueConditions(p, now) > 0,
    "gate-zurueckgewiesen": !p.finished && p.gateRejected,
    "rollen-fehlen": !p.finished && p.missingRoles.length > 0,
    "ohne-aktivitaet": !p.finished && inactiveDays(p, now) >= INACTIVE_AFTER_DAYS,
    "gate-bereit": !p.finished && p.gateStatus === "ready",
  };
  return SIGNAL_IDS.filter((id) => on[id]);
}

// ---------- List item ----------

export interface ProjectListItem {
  projectId: string;
  code: string;
  name: string;
  phase: PhaseId;
  phaseLabel: string;
  gateName: string;
  gateStatus: GateStatus;
  gateStatusLabel: string;
  portfolioGate: boolean;
  mandatoryDone: number;
  mandatoryTotal: number;
  openDecisions: number;
  openConditions: number;
  overdueConditions: number;
  missingRoles: ProjectRole[];
  signals: SignalId[];
  projectLeads: string[];
  myRoles: ProjectRole[];
  finished: boolean;
  updatedAt: string;
}

export function summaryListItem(p: ProjectSummary, myRoles: ProjectRole[], now: Date): ProjectListItem {
  return {
    projectId: p.projectId,
    code: p.code,
    name: p.name,
    phase: p.phase,
    phaseLabel: p.phaseLabel,
    gateName: p.gateName,
    gateStatus: p.gateStatus,
    gateStatusLabel: p.finished ? "Abgeschlossen" : GATE_STATUS_LABELS[p.gateStatus],
    portfolioGate: p.portfolioGate,
    mandatoryDone: p.mandatoryDone,
    mandatoryTotal: p.mandatoryTotal,
    openDecisions: p.openDecisions,
    openConditions: p.openConditions,
    overdueConditions: overdueConditions(p, now),
    missingRoles: p.missingRoles,
    signals: projectSignals(p, now),
    projectLeads: p.projectLeads,
    myRoles,
    finished: p.finished,
    updatedAt: p.updatedAt,
  };
}

export function projectListItem(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  now: Date = new Date(),
): ProjectListItem {
  return summaryListItem(projectSummary(s, model), rolesOf(s, v.userId), now);
}

/** Most urgent first: highest signal level, then most signals, then longest without a change. */
export function compareByAttention(a: ProjectListItem, b: ProjectListItem): number {
  const rank = (x: ProjectListItem) => Math.max(0, ...x.signals.map((id) => LEVEL_RANK[SIGNALS[id].level]));
  return rank(b) - rank(a) || b.signals.length - a.signals.length || a.updatedAt.localeCompare(b.updatedAt);
}

// ---------- Key figures ----------

export interface PhaseFigures {
  id: PhaseId;
  label: string;
  /** Active projects in this phase, by the state of the phase's gate. */
  open: number;
  blocked: number;
  ready: number;
  total: number;
}

export interface SignalFigures extends SignalDef {
  id: SignalId;
  /** Projects with this signal. */
  projects: number;
}

export interface PortfolioOverview {
  asOf: string;
  projects: number;
  active: number;
  finished: number;
  phases: PhaseFigures[];
  signals: SignalFigures[];
  /** Gates ready for a decision that the Portfolio-Gremium takes. */
  portfolioGatesReady: number;
  openDecisions: number;
  openConditions: number;
  overdueConditions: number;
}

export function portfolioOverview(
  items: readonly ProjectListItem[],
  model: HermesModel,
  now: Date,
): PortfolioOverview {
  const phases = new Map<PhaseId, PhaseFigures>(
    model.phases.map((ph) => [
      ph.id,
      { id: ph.id, label: ph.label, open: 0, blocked: 0, ready: 0, total: 0 },
    ]),
  );
  const signals = new Map<SignalId, number>(SIGNAL_IDS.map((id) => [id, 0]));
  const out = {
    finished: 0,
    portfolioGatesReady: 0,
    openDecisions: 0,
    openConditions: 0,
    overdueConditions: 0,
  };
  for (const p of items) {
    out.openDecisions += p.openDecisions;
    out.openConditions += p.openConditions;
    out.overdueConditions += p.overdueConditions;
    for (const id of p.signals) signals.set(id, (signals.get(id) ?? 0) + 1);
    if (p.finished) {
      out.finished++;
      continue;
    }
    const f = phases.get(p.phase);
    if (f) {
      f.total++;
      if (p.gateStatus === "blocked") f.blocked++;
      else if (p.gateStatus === "ready") f.ready++;
      else f.open++;
    }
    if (p.gateStatus === "ready" && p.portfolioGate) out.portfolioGatesReady++;
  }
  return {
    asOf: now.toISOString(),
    projects: items.length,
    active: items.length - out.finished,
    finished: out.finished,
    phases: [...phases.values()],
    signals: SIGNAL_IDS.map((id) => ({ id, ...SIGNALS[id], projects: signals.get(id) ?? 0 })),
    portfolioGatesReady: out.portfolioGatesReady,
    openDecisions: out.openDecisions,
    openConditions: out.openConditions,
    overdueConditions: out.overdueConditions,
  };
}
