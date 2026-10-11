// Separation of duties (Funktionentrennung, architecture §6.1). Controls only
// work when someone other than the person controlled holds them.

import type { ProjectRole } from "./types";

export interface GovernancePolicy {
  /**
   * The project lead holds no control role in their own project, the PMO
   * assigns the control roles, and nobody decides or rechecks their own change
   * request. Off only in a test environment, so that one person can try every
   * role (API setting SEPARATION_OF_DUTIES=false).
   */
  readonly separationOfDuties: boolean;
}

export const DEFAULT_POLICY: GovernancePolicy = { separationOfDuties: true };

/** Roles that decide, approve or recheck. Under separation of duties the PMO assigns and removes them. */
export const CONTROL_ROLES: readonly ProjectRole[] = ["PA", "ISM", "DS"];

/** Roles one person must not hold together in a project (open question F37). */
export const INCOMPATIBLE_ROLES: readonly (readonly [ProjectRole, ProjectRole])[] = [
  ["PL", "PA"],
  ["PL", "ISM"],
  ["PL", "DS"],
];

/** The role among `held` that `role` must be kept apart from, if any. */
export function roleConflict(held: readonly ProjectRole[], role: ProjectRole): ProjectRole | undefined {
  return held.find((h) =>
    INCOMPATIBLE_ROLES.some(([a, b]) => (a === h && b === role) || (a === role && b === h)),
  );
}
