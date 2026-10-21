// What the agents propose, as the API returns it to the web app. The server
// keeps a proposal until a person accepts it; nothing of it is in the
// Projektakte before (architecture §3, principles 2 and 4).

import type { CrFlag } from "../model/change-requests";
import type { RiskStatus } from "../model/risks";
import type { StatusCriterion } from "../model/status-report";
import type { Level, ProjectRole } from "../model/types";
import type { DraftContent, Finding, Producer } from "./events";
import type { RiskTrigger } from "./risks";

/** A new risk the Risiko agent proposes. */
export interface ProposedRisk {
  title: string;
  description: string;
  probability: Level;
  impact: Level;
  ownerRole: ProjectRole;
  mitigation: string;
  /** Why: the fact from the project behind it. */
  reason: string;
  /** The id of the fact the proposal rests on (a trigger, or "ergebnisse" for released results). */
  trigger: string;
}

/** A new assessment of an open risk, named by its label (R-02). */
export interface ProposedReassessment {
  risk: string;
  probability: Level;
  impact: Level;
  /** A new or sharper measure; empty keeps the current one. */
  mitigation: string;
  reason: string;
  /** The id of the fact the proposal rests on (a trigger, or "ergebnisse" for released results). */
  trigger: string;
}

export interface RiskProposal extends ProposedRisk {
  /** Deterministic checks: a similar open risk, a high risk without a measure. */
  findings: Finding[];
}

export interface ReassessmentProposal extends ProposedReassessment {
  riskId: string;
  title: string;
  current: {
    probability: Level;
    impact: Level;
    status: RiskStatus;
    ownerRole: ProjectRole;
    mitigation: string;
    /** Version of the risk the proposal is based on; accepting it names this version. */
    version: number;
  };
}

export interface RiskReviewResult {
  /** Accepting an item names this id and the item's index. */
  proposalId: string;
  newRisks: RiskProposal[];
  reassessments: ReassessmentProposal[];
  /** The facts the agent reviewed. */
  triggers: RiskTrigger[];
  producer: Producer;
}

/** The texts of a status report: overview, outlook, and problem and measure per criterion. */
export interface StatusReportTexts {
  overview: string;
  outlook: string;
  criteria: Partial<Record<StatusCriterion, { problem: string; measure: string }>>;
}

export interface StatusReportProposal extends StatusReportTexts {
  /** Publishing with this id records the texts as drafted by the agent. */
  proposalId: string;
  /** Deterministic checks and the Kritiker's review; advice for the PL, not stored. */
  findings: Finding[];
  producer: Producer;
}

/** An item of meeting minutes as the Protokoll agent proposes it, with its passage of the text. */
export interface ProposedMinutesItem {
  text: string;
  quote: string;
}

export interface ProposedMinutesAction extends ProposedMinutesItem {
  /** The member the text names, if exactly one fits. */
  ownerId?: string;
  /** The name as the text gives it (or the member's name); empty when the text names no one. */
  ownerName: string;
  /** YYYY-MM-DD, only when the text names a day. */
  due?: string;
}

export interface MinutesProposal {
  /** Recording with this id records the items taken from it as proposed by the agent. */
  proposalId: string;
  title: string;
  heldOn: string;
  decisions: ProposedMinutesItem[];
  actions: ProposedMinutesAction[];
  questions: ProposedMinutesItem[];
  /** Items the agent proposed without a passage of the text: dropped. */
  dropped: number;
  findings: Finding[];
  producer: Producer;
}

export interface ChangeRequestProposal {
  /** Submitting with this id records the request as drafted by the agent. */
  proposalId: string;
  content: DraftContent;
  /** Per area: touched or not, and why. */
  flags: Record<CrFlag, { value: boolean; reason: string }>;
  findings: Finding[];
  producer: Producer;
}
