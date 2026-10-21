// Agent A9 "Protokoll": reads the notes or the transcript of a meeting and
// proposes its decisions, action items (Pendenzen) and open questions. Each item
// carries a passage of the text, word for word; the agent's items without one
// are dropped, so nothing reaches the person that the text does not say. The
// person checks, completes and accepts the items (minutes in the engine); the
// text itself is neither stored nor logged.

import {
  MINUTES_ITEMS_MAX,
  PROJECT_ROLE_LABELS,
  QUOTE_MAX,
  checkRecordMinutes,
  isIsoDay,
  memberByName,
  normalizeText,
  quoteInText,
  type Finding,
  type MinutesProposal,
  type Producer,
  type ProposedMinutesAction,
  type ProposedMinutesItem,
} from "@hermes-helfer/core";
import { randomUUID } from "node:crypto";
import { assertCheck } from "../errors";
import type { ProjectService, RequestContext } from "../projects/service";
import { cut } from "./output";
import type { ProposalStore } from "./proposals";
import { addUsage, failedUsage, type AiProvider, type Usage } from "./provider";
import {
  agentFailure,
  callFor,
  closedByPerson,
  projectContext,
  recordAiRun,
  type AiRunRecord,
  type Logger,
} from "./runner";

/** What the server keeps of the proposal until the person records the minutes. */
export interface MinutesProposalContent {
  title: string;
  heldOn: string;
  decisions: ProposedMinutesItem[];
  actions: ProposedMinutesAction[];
  questions: ProposedMinutesItem[];
}

export interface MinutesSource {
  title: string;
  heldOn: string;
  /** Notes or a transcript, up to MINUTES_TEXT_MAX characters. */
  text: string;
}

const hint = (text: string): Finding => ({ severity: "hinweis", source: "checkliste", text });

export class MinutesAgent {
  constructor(
    private readonly projects: ProjectService,
    private readonly provider: AiProvider,
    private readonly log: Logger,
    private readonly proposals: ProposalStore,
  ) {}

  async propose(code: string, ctx: RequestContext, source: MinutesSource): Promise<MinutesProposal> {
    const model = this.projects.model;
    const s = await this.projects.requireProject(code, ctx.viewer);
    assertCheck(checkRecordMinutes(s, model, ctx.viewer));
    const agent = model.agent("A9");
    const info = this.provider.info;
    const runId = randomUUID();
    const started = Date.now();
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const record = (outcome: AiRunRecord["outcome"], findings: number) =>
      recordAiRun(this.log, info, {
        runId,
        projectId: s.projectId,
        skillId: "protokoll.auswertung",
        agent: agent.id,
        outcome,
        findings,
        durationMs: Date.now() - started,
        usage,
        requestedBy: ctx.viewer.userId,
        channel: ctx.channel,
        correlationId: ctx.correlationId,
      });

    let result: MinutesProposal;
    try {
      const answer = await this.provider.extractMinutes(
        {
          agent,
          project: projectContext(s, model, ctx.viewer),
          meeting: { title: source.title, heldOn: source.heldOn },
          text: source.text,
          members: Object.values(s.members).map((m) => ({
            name: m.displayName,
            roles: m.roles.map((r) => PROJECT_ROLE_LABELS[r]),
          })),
          max: MINUTES_ITEMS_MAX,
        },
        callFor(ctx),
      );
      if (answer.usage) usage = answer.usage;

      // Evidence: an item stays only with a passage of the text; repeated items count once.
      let dropped = 0;
      const keep = <T extends { text: string; quote: string }>(items: readonly T[]): T[] => {
        const seen = new Set<string>();
        const out: T[] = [];
        for (const item of items) {
          const text = item.text.trim();
          if (text.length < 3 || !quoteInText(item.quote, source.text)) {
            dropped++;
            continue;
          }
          const key = normalizeText(text);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ ...item, text, quote: cut(item.quote.trim(), QUOTE_MAX) });
        }
        return out;
      };
      const decisions = keep(answer.extract.decisions).map(({ text, quote }) => ({ text, quote }));
      const questions = keep(answer.extract.questions).map(({ text, quote }) => ({ text, quote }));
      const actions = keep(answer.extract.actions).map(
        ({ text, quote, owner, due }): ProposedMinutesAction => {
          const named = owner.trim();
          const ownerId = named ? memberByName(s, named) : undefined;
          const day = due.trim();
          return {
            text,
            quote,
            ownerName: ownerId ? s.members[ownerId]!.displayName : named,
            ...(ownerId ? { ownerId } : {}),
            ...(isIsoDay(day) ? { due: day } : {}),
          };
        },
      );

      const findings: Finding[] = [];
      if (!decisions.length && !actions.length && !questions.length) {
        findings.push(
          hint("Der Agent hat im Text keine Entscheide, Pendenzen oder offenen Fragen gefunden."),
        );
      }
      if (dropped) {
        findings.push(
          hint(
            `${dropped} ${dropped === 1 ? "Vorschlag" : "Vorschläge"} ohne passende Stelle im Text verworfen: der Agent übernimmt nur, was der Text sagt.`,
          ),
        );
      }
      const unowned = actions.filter((a) => !a.ownerName).length;
      if (unowned) {
        findings.push(
          hint(
            `${unowned} ${unowned === 1 ? "Pendenz nennt" : "Pendenzen nennen"} keine Verantwortlichen: bitte zuweisen.`,
          ),
        );
      }
      const producer: Producer = {
        kind: "ai",
        agent: agent.id,
        provider: info.provider,
        model: info.model,
        runId,
      };
      const content: MinutesProposalContent = {
        title: source.title,
        heldOn: source.heldOn,
        decisions,
        actions,
        questions,
      };
      const proposalId = this.proposals.put<MinutesProposalContent>({
        kind: "minutes",
        projectId: s.projectId,
        userId: ctx.viewer.userId,
        producer,
        content,
      });
      result = { proposalId, ...content, dropped, findings, producer };
    } catch (err) {
      usage = addUsage(usage, failedUsage(err));
      record(closedByPerson(err) ? "aborted" : "failed", 0);
      throw agentFailure(
        this.log,
        err,
        { runId, projectId: s.projectId },
        "minutes",
        "Das Protokoll kannst du auch ohne den Agenten erfassen.",
      );
    }
    record("completed", result.findings.length);
    return result;
  }
}
