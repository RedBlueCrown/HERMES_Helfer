import {
  compareByAttention,
  projectSummary,
  rolesOf,
  summaryListItem,
  type GateStatus,
  type HermesModel,
  type PhaseId,
  type ProjectListItem,
  type ProjectState,
  type ProjectSummary,
  type SignalId,
  type Viewer,
} from "@hermes-helfer/core";

/**
 * Read model of the project list and the portfolio (architecture §4.1, §7):
 * one summary per project, rebuilt only when the project has new events.
 * Summaries are the same for every viewer; the viewer's roles and the clock
 * are applied per request. Holds one entry per project (streams are never deleted).
 */
export class ProjectSummaries {
  private readonly cache = new Map<string, ProjectSummary>();

  constructor(private readonly model: HermesModel) {}

  /** The summary of the project's current version. */
  of(s: ProjectState): ProjectSummary {
    const cached = this.cache.get(s.projectId);
    if (cached?.lastSeq === s.lastSeq) return cached;
    const fresh = projectSummary(s, this.model);
    this.cache.set(s.projectId, fresh);
    return fresh;
  }

  item(s: ProjectState, viewer: Viewer, now: Date): ProjectListItem {
    return summaryListItem(this.of(s), rolesOf(s, viewer.userId), now);
  }
}

export interface ProjectQuery {
  /** Part of the name or the code. */
  q?: string | undefined;
  /** Projects in this phase (finished projects are in no phase). */
  phase?: PhaseId | undefined;
  /** State of the current phase's gate; "passed": finished projects. */
  gate?: GateStatus | undefined;
  signal?: SignalId | undefined;
  sort: "updated" | "name" | "attention";
}

type Compare = (a: ProjectListItem, b: ProjectListItem) => number;
const byName: Compare = (a, b) => a.name.localeCompare(b.name, "de") || a.code.localeCompare(b.code);
const SORTS: Readonly<Record<ProjectQuery["sort"], Compare>> = {
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt) || byName(a, b),
  name: byName,
  attention: (a, b) => compareByAttention(a, b) || byName(a, b),
};

export function queryProjects(items: readonly ProjectListItem[], q: ProjectQuery): ProjectListItem[] {
  const term = q.q?.trim().toLowerCase();
  return items
    .filter(
      (p) =>
        (!q.phase || (p.phase === q.phase && !p.finished)) &&
        (!q.gate || p.gateStatus === q.gate) &&
        (!q.signal || p.signals.includes(q.signal)) &&
        (!term || p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term)),
    )
    .sort(SORTS[q.sort]);
}
