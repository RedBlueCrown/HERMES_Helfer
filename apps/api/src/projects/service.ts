// Commands on projects. Each command: load the current state under the
// project lock, check permission and state with the engine, validate the
// input, append events. Nothing else changes project data.

import {
  DEFAULT_PROFILE,
  MODEL_VERSION,
  PROJECT_ROLES,
  canCreateProject,
  canViewProject,
  checkCompleteCondition,
  checkConfirmChecklistItem,
  checkDecideGate,
  checkDecideSkill,
  checkEditOutput,
  checkManageMembers,
  checkMarkNotApplicable,
  checkReactivate,
  checkRecordParticipation,
  checkRelease,
  checkStartSkill,
  checkUpdateProfile,
  contentVersion as currentContentVersion,
  findChecklist,
  openChecklistItems,
  rolesOf,
  validateDecision,
  validateNotApplicableReason,
  type Actor,
  type Channel,
  type ConditionSpec,
  type DecisionInput,
  type DraftContent,
  type PhaseId,
  type ProjectEvent,
  type ProjectProfile,
  type ProjectRole,
  type ProjectState,
  type Viewer,
} from "@hermes-helfer/core";
import { randomUUID } from "node:crypto";
import { checkDraftStructure } from "../agents/kritiker";
import { HttpError, assertCheck, notFound, unprocessable } from "../errors";
import { projectIdForCode, type ProjectRepository } from "./repository";

export interface RequestContext {
  viewer: Viewer;
  channel: Channel;
  correlationId: string;
}

export interface CommandResult {
  lastSeq: number;
}

export function actorFor(s: ProjectState | undefined, ctx: RequestContext): Actor {
  return {
    userId: ctx.viewer.userId,
    displayName: ctx.viewer.displayName,
    roles: [...(s ? rolesOf(s, ctx.viewer.userId) : []), ...ctx.viewer.globalRoles],
    channel: ctx.channel,
  };
}

export const PROJECT_NOT_FOUND = "Vorhaben nicht gefunden oder kein Zugriff.";

export const STALE_VERSION =
  "Das Ergebnis wurde inzwischen geändert. Bitte die aktuelle Fassung prüfen und erneut entscheiden.";

/** Optimistic concurrency per document: refuse when the content changed since the person looked at it. */
function assertSameVersion<T>(current: T | undefined, seen: T): void {
  if (current !== seen) throw new HttpError(409, "stale", STALE_VERSION);
}

export interface CreateProjectInput {
  code: string;
  name: string;
  description?: string;
  phase?: PhaseId;
  profile?: ProjectProfile;
  projectLead?: { userId: string; displayName: string };
}

export class ProjectService {
  constructor(
    private readonly repo: ProjectRepository,
    private readonly newId: () => string = randomUUID,
  ) {}

  get model() {
    return this.repo.model;
  }

  /** The project if the viewer may see it. Unknown and forbidden look the same (todo-later E04). */
  async requireProject(code: string, viewer: Viewer): Promise<ProjectState> {
    const s = await this.repo.findByCode(code);
    if (!s || !canViewProject(s, viewer)) throw notFound(PROJECT_NOT_FOUND);
    return s;
  }

  /** Run `build` on the fresh state under the project lock and append its events. */
  async command(
    code: string,
    ctx: RequestContext,
    build: (s: ProjectState) => ProjectEvent[],
  ): Promise<CommandResult> {
    const { projectId } = await this.requireProject(code, ctx.viewer);
    return this.repo.withLock(projectId, async () => {
      const s = await this.repo.get(projectId);
      if (!s) throw notFound(PROJECT_NOT_FOUND);
      const events = build(s);
      const stored = await this.repo.append(
        projectId,
        s.lastSeq,
        events,
        actorFor(s, ctx),
        ctx.correlationId,
      );
      return { lastSeq: stored.at(-1)?.seq ?? s.lastSeq };
    });
  }

  async createProject(
    ctx: RequestContext,
    input: CreateProjectInput,
  ): Promise<{ projectId: string; code: string }> {
    if (!canCreateProject(ctx.viewer)) throw new HttpError(403, "forbidden", "Nur das PMO legt Vorhaben an.");
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(code)) {
      throw unprocessable("Das Kürzel besteht aus 2 bis 20 Zeichen: Buchstaben, Ziffern, Bindestrich.");
    }
    const taken = () => new HttpError(409, "conflict", `Das Kürzel ${code} ist bereits vergeben.`);
    if (await this.repo.findByCode(code)) throw taken();
    const projectId = projectIdForCode(code);
    const events: ProjectEvent[] = [
      {
        type: "ProjectCreated",
        data: {
          code,
          name: input.name.trim(),
          description: input.description?.trim() ?? "",
          phase: input.phase ?? "init",
          profile: input.profile ?? DEFAULT_PROFILE,
          modelVersion: MODEL_VERSION,
        },
      },
    ];
    if (input.projectLead) {
      events.push({
        type: "MemberRoleAssigned",
        data: { userId: input.projectLead.userId, displayName: input.projectLead.displayName, role: "PL" },
      });
    }
    try {
      await this.repo.withLock(projectId, () =>
        this.repo.append(projectId, 0, events, actorFor(undefined, ctx), ctx.correlationId),
      );
    } catch (err) {
      // Someone created the same code at the same time, or a locked project uses it.
      if (err instanceof HttpError && (err.code === "conflict" || err.code === "locked")) throw taken();
      throw err;
    }
    return { projectId, code };
  }

  assignRole(code: string, ctx: RequestContext, userId: string, displayName: string, role: ProjectRole) {
    return this.command(code, ctx, (s) => {
      assertCheck(checkManageMembers(s, ctx.viewer));
      if (!PROJECT_ROLES.includes(role)) throw unprocessable("Unbekannte Rolle.");
      if (rolesOf(s, userId).includes(role))
        throw new HttpError(409, "invalid_state", "Die Person hat diese Rolle bereits.");
      return [{ type: "MemberRoleAssigned", data: { userId, displayName: displayName.trim(), role } }];
    });
  }

  removeRole(code: string, ctx: RequestContext, userId: string, role: ProjectRole) {
    return this.command(code, ctx, (s) => {
      assertCheck(checkManageMembers(s, ctx.viewer));
      const member = s.members[userId];
      if (!member?.roles.includes(role))
        throw new HttpError(409, "invalid_state", "Die Person hat diese Rolle nicht.");
      const leads = Object.values(s.members).filter((m) => m.roles.includes("PL")).length;
      if (role === "PL" && leads <= 1) {
        throw new HttpError(409, "invalid_state", "Mindestens eine Projektleitung muss im Vorhaben bleiben.");
      }
      return [{ type: "MemberRoleRemoved", data: { userId, displayName: member.displayName, role } }];
    });
  }

  updateProfile(code: string, ctx: RequestContext, profile: ProjectProfile) {
    return this.command(code, ctx, (s) => {
      assertCheck(checkUpdateProfile(s, this.model, ctx.viewer));
      return [{ type: "ProfileUpdated", data: { profile } }];
    });
  }

  /** Manual skills: the responsible person records the result directly. */
  recordManualResult(code: string, ctx: RequestContext, skillId: string, draft: DraftContent) {
    const skill = this.skillOrThrow(skillId);
    return this.command(code, ctx, (s) => {
      if (skill.mode !== "manual") {
        throw new HttpError(409, "invalid_state", `«${skill.name}» wird von einem Agenten entworfen.`);
      }
      assertCheck(checkStartSkill(s, this.model, ctx.viewer, skill));
      const runId = this.newId();
      return [
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
      ];
    });
  }

  /** `version`: the version the editor started from; a newer one means someone else saved meanwhile. */
  editDraft(code: string, ctx: RequestContext, skillId: string, draft: DraftContent, version: number) {
    const skill = this.skillOrThrow(skillId);
    return this.command(code, ctx, (s) => {
      assertCheck(checkEditOutput(s, this.model, ctx.viewer, skill));
      assertSameVersion(s.skills[skillId]?.output?.version, version);
      return [{ type: "DraftEdited", data: { skillId, draft } }];
    });
  }

  /** `contentVersion`: the content the PL reviewed (see contentVersion in the engine). */
  release(code: string, ctx: RequestContext, deliverableId: string, contentVersion: string) {
    const d = this.deliverableOrThrow(deliverableId);
    return this.command(code, ctx, (s) => {
      assertCheck(checkRelease(s, this.model, ctx.viewer, d));
      assertSameVersion(currentContentVersion(s, d), contentVersion);
      return [{ type: "DeliverableReleased", data: { deliverableId, contentVersion } }];
    });
  }

  /** `version`: the version of the result the approver reviewed. */
  decideSkill(
    code: string,
    ctx: RequestContext,
    skillId: string,
    role: ProjectRole,
    input: DecisionInput,
    version: number,
  ) {
    const skill = this.skillOrThrow(skillId);
    return this.command(code, ctx, (s) => {
      assertCheck(checkDecideSkill(s, this.model, ctx.viewer, skill, role));
      assertSameVersion(s.skills[skillId]?.output?.version, version);
      const approver = skill.approvers.find((a) => a.role === role)!;
      const cl = skill.checklist?.requiredFor === "approval" ? skill.checklist : undefined;
      const error = validateDecision(input, {
        veto: skill.veto,
        konsentRequired: approver.konsent,
        openChecklistItems: cl ? openChecklistItems(s, skill.id, cl).length : 0,
        ...(cl ? { checklistTitle: cl.title } : {}),
      });
      if (error) throw unprocessable(error);
      return [
        {
          type: "SkillDecisionRecorded",
          data: {
            skillId,
            role,
            decision: input.decision,
            reason: input.reason.trim(),
            konsent: approver.konsent && input.konsent,
            conditions: this.conditions(input),
            version,
          },
        },
      ];
    });
  }

  markNotApplicable(code: string, ctx: RequestContext, deliverableId: string, reason: string) {
    const d = this.deliverableOrThrow(deliverableId);
    return this.command(code, ctx, (s) => {
      assertCheck(checkMarkNotApplicable(s, this.model, ctx.viewer, d));
      const error = validateNotApplicableReason(reason);
      if (error) throw unprocessable(error);
      return [{ type: "DeliverableMarkedNotApplicable", data: { deliverableId, reason: reason.trim() } }];
    });
  }

  reactivate(code: string, ctx: RequestContext, deliverableId: string) {
    const d = this.deliverableOrThrow(deliverableId);
    return this.command(code, ctx, (s) => {
      assertCheck(checkReactivate(s, this.model, ctx.viewer, d));
      return [{ type: "DeliverableReactivated", data: { deliverableId } }];
    });
  }

  recordParticipation(code: string, ctx: RequestContext, phase: PhaseId, participantId: string, how: string) {
    return this.command(code, ctx, (s) => {
      assertCheck(checkRecordParticipation(s, this.model, ctx.viewer, phase, participantId));
      return [{ type: "ParticipationRecorded", data: { phase, participantId, how: how.trim() } }];
    });
  }

  confirmChecklistItem(code: string, ctx: RequestContext, ownerId: string, itemId: string, note: string) {
    if (!findChecklist(this.model, ownerId)) throw notFound("Diese Checkliste gibt es nicht.");
    return this.command(code, ctx, (s) => {
      assertCheck(checkConfirmChecklistItem(s, this.model, ctx.viewer, ownerId, itemId));
      return [
        { type: "ChecklistItemConfirmed", data: { checklistOwnerId: ownerId, itemId, note: note.trim() } },
      ];
    });
  }

  decideGate(code: string, ctx: RequestContext, phase: PhaseId, input: DecisionInput) {
    return this.command(code, ctx, (s) => {
      assertCheck(checkDecideGate(s, this.model, ctx.viewer, phase));
      const gate = this.model.phase(phase).gate;
      const error = validateDecision(input, {
        veto: false,
        konsentRequired: gate.requiresKonsent,
        openChecklistItems: 0,
      });
      if (error) throw unprocessable(error);
      return [
        {
          type: "GateDecisionRecorded",
          data: {
            phase,
            decision: input.decision,
            reason: input.reason.trim(),
            konsent: gate.requiresKonsent && input.konsent,
            conditions: this.conditions(input),
          },
        },
      ];
    });
  }

  completeCondition(code: string, ctx: RequestContext, conditionId: string, note: string) {
    return this.command(code, ctx, (s) => {
      assertCheck(checkCompleteCondition(s, ctx.viewer, conditionId));
      const text = s.conditions[conditionId]!.text;
      return [{ type: "ConditionCompleted", data: { conditionId, text, note: note.trim() } }];
    });
  }

  private conditions(input: DecisionInput): ConditionSpec[] {
    if (input.decision !== "mit Auflagen") return [];
    return input.conditions.map((c) => ({
      id: this.newId(),
      text: c.text.trim(),
      ownerRole: c.ownerRole,
      due: c.due.trim(),
    }));
  }

  private skillOrThrow(skillId: string) {
    const skill = this.model.findSkill(skillId);
    if (!skill) throw notFound("Diesen Schritt gibt es nicht.");
    return skill;
  }

  private deliverableOrThrow(deliverableId: string) {
    const d = this.model.findDeliverable(deliverableId);
    if (!d) throw notFound("Dieses Ergebnis gibt es nicht.");
    return d;
  }
}
