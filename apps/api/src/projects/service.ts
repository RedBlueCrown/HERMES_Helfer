// Commands on projects. Each command: load the current state under the
// project lock, check permission and state with the engine, validate the
// input, append events. Nothing else changes project data.

import {
  DEFAULT_PROFILE,
  MODEL_VERSION,
  PROJECT_ROLES,
  canCreateProject,
  canViewProject,
  CR_DAY_RATE_CHF,
  CR_FLAGS,
  CR_RECHECK_ROLES,
  STATUS_CRITERIA,
  changeImpact,
  checkAcknowledgeStatusReport,
  checkAssessRisk,
  checkAssignRole,
  checkCompleteCondition,
  checkConfirmChecklistItem,
  checkConfirmRecheck,
  checkDecideChangeRequest,
  checkDecideGate,
  checkDecideSkill,
  checkEditOutput,
  checkMarkNotApplicable,
  checkReactivate,
  checkRecordParticipation,
  checkRecordRisk,
  checkRelease,
  checkRemoveRole,
  checkPublishStatusReport,
  checkReviewRisks,
  checkSetChangeReserve,
  checkStartSkill,
  checkSubmitChangeRequest,
  checkUpdateProfile,
  checkWithdrawChangeRequest,
  contentVersion as currentContentVersion,
  findChecklist,
  fingerprint,
  gateRisks,
  nextCrNumber,
  impactContext,
  mandatoryProgress,
  nextRiskNumber,
  nextStatusReportNumber,
  openChecklistItems,
  recheckResults,
  reportEntry,
  reportRisks,
  reserveStatus,
  suggestStatus,
  suggestionVersion,
  rolesOf,
  validateChangeRequest,
  validateDecision,
  validateNotApplicableReason,
  validateRecheck,
  validateRisk,
  validateRiskAssessment,
  validateStatusReport,
  validateWithdrawal,
  type Actor,
  type Channel,
  type ConditionSpec,
  type CrFlags,
  type DecisionInput,
  type DraftContent,
  type Level,
  type PhaseId,
  type AgentRiskBasis,
  type ReassessmentProposal,
  type RiskProposal,
  type ProjectEvent,
  type ProjectProfile,
  type ProjectRole,
  type ProjectState,
  type RecheckOutcome,
  type RecheckRole,
  type RiskStatus,
  type StatusCriterion,
  type StatusEntry,
  type StatusEntryInput,
  type StatusFigures,
  type StatusReportTexts,
  type Viewer,
} from "@hermes-helfer/core";
import { randomUUID } from "node:crypto";
import type { ChangeRequestProposalContent } from "../agents/change-request-agent";
import type { RiskReviewContent } from "../agents/risk-agent";
import {
  checkChangeRequest,
  checkClearedFlags,
  checkDraftStructure,
  mergeFindings,
} from "../agents/kritiker";
import { acceptedProducer, sameContent, type StoredProposal } from "../agents/proposals";
import { HttpError, assertCheck, notFound, unprocessable } from "../errors";
import { projectIdForCode, type ProjectRepository } from "./repository";

export interface RequestContext {
  viewer: Viewer;
  channel: Channel;
  correlationId: string;
  /** Aborted when the person closes the request; stops model calls made for it. */
  signal?: AbortSignal;
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

export interface ChangeRequestInput {
  title: string;
  requestedBy: string;
  effortDays: number;
  flags: CrFlags;
  content: DraftContent;
  /** The agent's draft the requester started from (proposals.ts); absent: written by the person. */
  proposal?: StoredProposal<ChangeRequestProposalContent>;
}

/** An item of a risk review the project lead accepts, with the review it belongs to (proposals.ts). */
export interface AcceptedRiskItem<T> {
  proposal: StoredProposal<RiskReviewContent>;
  item: T;
}

export interface RiskInput {
  title: string;
  description: string;
  probability: Level;
  impact: Level;
  ownerRole: ProjectRole;
  mitigation: string;
  /** A new risk the Risiko agent proposed. */
  accepted?: AcceptedRiskItem<RiskProposal>;
}

export interface RiskAssessmentInput {
  /** The version (number of entries in the history) the person assessed. */
  basedOn: number;
  probability: Level;
  impact: Level;
  status: RiskStatus;
  ownerRole: ProjectRole;
  mitigation: string;
  note: string;
  /** A new assessment the Risiko agent proposed. */
  accepted?: AcceptedRiskItem<ReassessmentProposal>;
}

/** The agent's reason for an accepted item and the fact it rested on, for the record. */
const agentBasis = (
  review: RiskReviewContent,
  item: { reason: string; trigger: string },
): AgentRiskBasis => ({
  reason: item.reason.trim(),
  trigger: item.trigger,
  fact: review.triggers.find((t) => t.id === item.trigger)?.text ?? "",
});

export interface StatusReportInput {
  criteria: Record<StatusCriterion, StatusEntryInput>;
  overview: string;
  outlook: string;
  figures: StatusFigures;
  /** The version of the suggestion the project lead saw (suggestionVersion). */
  basedOn: string;
  /** The agent's texts the project lead started from (proposals.ts). */
  proposal?: StoredProposal<StatusReportTexts>;
}

/** Every published text against the agent's: the record says whether the project lead changed any. */
function reportEdited(
  p: StatusReportTexts,
  published: Omit<StatusReportTexts, "criteria"> & {
    criteria: Record<StatusCriterion, StatusEntry>;
  },
): boolean {
  const same = (a: string | undefined, b: string) => (a ?? "").trim() === b.trim();
  return (
    !same(p.overview, published.overview) ||
    !same(p.outlook, published.outlook) ||
    STATUS_CRITERIA.some(
      (c) =>
        !same(p.criteria[c.id]?.problem, published.criteria[c.id].problem) ||
        !same(p.criteria[c.id]?.measure, published.criteria[c.id].measure),
    )
  );
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
    if (!PROJECT_ROLES.includes(role)) throw unprocessable("Unbekannte Rolle.");
    return this.command(code, ctx, (s) => {
      assertCheck(checkAssignRole(s, this.model, ctx.viewer, userId, role));
      return [{ type: "MemberRoleAssigned", data: { userId, displayName: displayName.trim(), role } }];
    });
  }

  removeRole(code: string, ctx: RequestContext, userId: string, role: ProjectRole) {
    return this.command(code, ctx, (s) => {
      assertCheck(checkRemoveRole(s, this.model, ctx.viewer, userId, role));
      const { displayName } = s.members[userId]!;
      return [{ type: "MemberRoleRemoved", data: { userId, displayName, role } }];
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
            findings: checkDraftStructure(skill.sections, draft),
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
            ...(() => {
              const risks = gateRisks(s);
              return risks.length ? { highRisks: risks } : {};
            })(),
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

  // ---------- Change Requests ----------

  submitChangeRequest(code: string, ctx: RequestContext, input: ChangeRequestInput) {
    return this.command(code, ctx, (s) => {
      assertCheck(checkSubmitChangeRequest(s, this.model, ctx.viewer));
      const invalid = validateChangeRequest({ title: input.title, summary: input.content.summary });
      if (invalid) throw unprocessable(invalid);
      const p = input.proposal;
      const agentFlags = p
        ? (Object.fromEntries(CR_FLAGS.map((f) => [f, p.content.flags[f].value])) as CrFlags)
        : undefined;
      return [
        {
          type: "ChangeRequestSubmitted",
          data: {
            crId: this.newId(),
            number: nextCrNumber(s),
            title: input.title.trim(),
            requestedBy: input.requestedBy.trim(),
            effortDays: input.effortDays,
            dayRateChf: CR_DAY_RATE_CHF,
            flags: input.flags,
            content: input.content,
            // Checked again here: the requester may have changed the agent's text and areas.
            findings: mergeFindings(
              checkChangeRequest(input.content, input.flags),
              p ? checkClearedFlags(p.content.flags, input.flags) : [],
            ),
            producer: p
              ? acceptedProducer(
                  p,
                  !sameContent(p.content.content, input.content) || !sameContent(agentFlags, input.flags),
                )
              : { kind: "human" },
            ...(p
              ? {
                  agentAssessment: {
                    wish: p.content.wish,
                    flags: p.content.flags,
                    findings: p.content.findings,
                  },
                }
              : {}),
          },
        },
      ];
    });
  }

  withdrawChangeRequest(code: string, ctx: RequestContext, crId: string, reason: string) {
    return this.command(code, ctx, (s) => {
      assertCheck(checkWithdrawChangeRequest(s, this.model, ctx.viewer, crId));
      const invalid = validateWithdrawal(reason);
      if (invalid) throw unprocessable(invalid);
      return [{ type: "ChangeRequestWithdrawn", data: { crId, reason: reason.trim() } }];
    });
  }

  /**
   * The Projektausschuss decides with Konsent and always gives a reason. The
   * event keeps what the decision was based on: the impact, the reserve and
   * who rechecks (architecture §3, principle 5).
   */
  decideChangeRequest(
    code: string,
    ctx: RequestContext,
    crId: string,
    input: DecisionInput & { recheckRequired?: boolean; basedOn: string },
  ) {
    return this.command(code, ctx, (s) => {
      assertCheck(checkDecideChangeRequest(s, this.model, ctx.viewer, crId));
      const impact = changeImpact(s.changeRequests[crId]!, impactContext(s, crId), this.model);
      // The decision is taken on the impact the Projektausschuss saw (impactVersion).
      if (fingerprint(impact) !== input.basedOn) {
        throw new HttpError(
          409,
          "stale",
          "Die Auswirkungen haben sich inzwischen geändert, zum Beispiel die Reserve. Bitte prüfen und neu entscheiden.",
        );
      }
      const error = validateDecision(input, {
        veto: false,
        konsentRequired: true,
        openChecklistItems: 0,
        reasonRequired: true,
      });
      if (error) throw unprocessable(error);
      const cr = s.changeRequests[crId]!;
      const accepted = input.decision !== "zurückgewiesen";
      const recheck = accepted && (cr.flags.daten || !!input.recheckRequired);
      return [
        {
          type: "ChangeRequestDecided",
          data: {
            crId,
            decision: input.decision,
            reason: input.reason.trim(),
            konsent: accepted && input.konsent,
            conditions: this.conditions(input),
            impact,
            ...(() => {
              const remaining = reserveStatus(s, crId).remainingChf;
              return remaining === undefined ? {} : { reserveRemainingChf: remaining };
            })(),
            ...(accepted && input.recheckRequired && !cr.flags.daten ? { recheckRequired: true } : {}),
            ...(recheck
              ? {
                  recheckRoles: [...CR_RECHECK_ROLES],
                  recheckDeliverables: recheckResults(this.model, s.phase, impactContext(s).notApplicable),
                }
              : {}),
          },
        },
      ];
    });
  }

  confirmRecheck(
    code: string,
    ctx: RequestContext,
    crId: string,
    role: RecheckRole,
    outcome: RecheckOutcome,
    note: string,
  ) {
    return this.command(code, ctx, (s) => {
      assertCheck(checkConfirmRecheck(s, this.model, ctx.viewer, crId, role));
      const invalid = validateRecheck(outcome, note);
      if (invalid) throw unprocessable(invalid);
      return [{ type: "ChangeRecheckConfirmed", data: { crId, role, outcome, note: note.trim() } }];
    });
  }

  setChangeReserve(code: string, ctx: RequestContext, amountChf: number) {
    return this.command(code, ctx, (s) => {
      assertCheck(checkSetChangeReserve(s, this.model, ctx.viewer));
      return [{ type: "ChangeReserveSet", data: { amountChf } }];
    });
  }

  // ---------- Risks ----------

  recordRisk(code: string, ctx: RequestContext, input: RiskInput) {
    return this.command(code, ctx, (s) => {
      assertCheck(checkRecordRisk(s, this.model, ctx.viewer));
      const invalid = validateRisk(input);
      if (invalid) throw unprocessable(invalid);
      const a = input.accepted;
      // Accepting a proposal of the Risiko agent is the PL's decision (architecture §5).
      if (a) assertCheck(checkReviewRisks(s, this.model, ctx.viewer));
      const values = [
        input.title.trim(),
        input.description.trim(),
        input.probability,
        input.impact,
        input.ownerRole,
        input.mitigation.trim(),
      ] as const;
      const [title, description, probability, impact, ownerRole, mitigation] = values;
      const proposed = (p: RiskProposal) => [
        p.title.trim(),
        p.description.trim(),
        p.probability,
        p.impact,
        p.ownerRole,
        p.mitigation.trim(),
      ];
      return [
        {
          type: "RiskRecorded",
          data: {
            riskId: this.newId(),
            number: nextRiskNumber(s),
            title,
            description,
            probability,
            impact,
            ownerRole,
            mitigation,
            producer: a
              ? acceptedProducer(a.proposal, !sameContent(proposed(a.item), values))
              : { kind: "human" },
            ...(a ? { agentBasis: agentBasis(a.proposal.content, a.item) } : {}),
          },
        },
      ];
    });
  }

  /** A new assessment with all current values; closing and reopening need a reason. */
  assessRisk(code: string, ctx: RequestContext, riskId: string, input: RiskAssessmentInput) {
    return this.command(code, ctx, (s) => {
      assertCheck(checkAssessRisk(s, this.model, ctx.viewer, riskId));
      const a = input.accepted;
      if (a) {
        assertCheck(checkReviewRisks(s, this.model, ctx.viewer));
        // The agent proposed values for the risk as it was; status and responsibility stay.
        if (input.status !== a.item.current.status || input.ownerRole !== a.item.current.ownerRole) {
          throw unprocessable(
            "Beim Übernehmen eines Vorschlags bleiben Status und Verantwortung. Ändere sie danach in einer eigenen Beurteilung.",
          );
        }
      }
      const r = s.risks[riskId]!;
      // Optimistic concurrency: an assessment always names the version it was based on, and an
      // accepted proposal the version the agent saw.
      if (r.history.length !== input.basedOn || (a && a.item.current.version !== input.basedOn)) {
        throw new HttpError(
          409,
          "stale",
          "Das Risiko wurde inzwischen geändert. Bitte die aktuelle Fassung prüfen und neu beurteilen.",
        );
      }
      if (r.status === "geschlossen" && input.status === "geschlossen") {
        throw new HttpError(
          409,
          "invalid_state",
          "Das Risiko ist geschlossen. Zum Ändern zuerst wieder öffnen.",
        );
      }
      // The agent's reason is kept as its own (agentBasis), not as the person's note.
      const note = a ? "" : input.note.trim();
      const invalid = validateRiskAssessment(r, { ...input, note });
      if (invalid) throw unprocessable(invalid);
      const mitigation = input.mitigation.trim();
      const edited = (p: ReassessmentProposal) =>
        !sameContent(
          [p.probability, p.impact, (p.mitigation || p.current.mitigation).trim()],
          [input.probability, input.impact, mitigation],
        );
      return [
        {
          type: "RiskAssessed",
          data: {
            riskId,
            probability: input.probability,
            impact: input.impact,
            status: input.status,
            ownerRole: input.ownerRole,
            mitigation,
            note,
            producer: a ? acceptedProducer(a.proposal, edited(a.item)) : { kind: "human" },
            ...(a ? { agentBasis: agentBasis(a.proposal.content, a.item) } : {}),
          },
        },
      ];
    });
  }

  // ---------- Status reports ----------

  /**
   * The PL publishes a report. The engine's suggestion is recorded with it;
   * yellow and red need a problem and a measure, and a colour better than the
   * suggestion needs a reason.
   */
  publishStatusReport(code: string, ctx: RequestContext, input: StatusReportInput, now: Date) {
    return this.command(code, ctx, (s) => {
      assertCheck(checkPublishStatusReport(s, this.model, ctx.viewer));
      const suggestion = suggestStatus(s, this.model, now);
      // The colours are judged against the suggestion the project lead saw.
      if (suggestionVersion(suggestion) !== input.basedOn) {
        throw new HttpError(
          409,
          "stale",
          "Der Vorschlag hat sich inzwischen geändert, weil sich das Vorhaben geändert hat. Bitte die Ampel neu prüfen.",
        );
      }
      const invalid = validateStatusReport(input, suggestion);
      if (invalid) throw unprocessable(invalid);
      const criteria = {} as Record<StatusCriterion, StatusEntry>;
      for (const c of STATUS_CRITERIA) criteria[c.id] = reportEntry(input.criteria[c.id], suggestion[c.id]);
      const texts = { overview: input.overview.trim(), outlook: input.outlook.trim(), criteria };
      const p = input.proposal;
      return [
        {
          type: "StatusReportPublished",
          data: {
            reportId: this.newId(),
            number: nextStatusReportNumber(s),
            criteria,
            overview: texts.overview,
            outlook: texts.outlook,
            figures: input.figures,
            phase: s.phase,
            mandatory: mandatoryProgress(s, this.model, s.phase),
            risks: reportRisks(s),
            producer: p ? acceptedProducer(p, reportEdited(p.content, texts)) : { kind: "human" },
          },
        },
      ];
    });
  }

  acknowledgeStatusReport(code: string, ctx: RequestContext, reportId: string, note: string) {
    return this.command(code, ctx, (s) => {
      assertCheck(checkAcknowledgeStatusReport(s, this.model, ctx.viewer, reportId));
      return [{ type: "StatusReportAcknowledged", data: { reportId, note: note.trim() } }];
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
