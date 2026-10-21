// Agent A13 "Wissen": answers questions across the projects a person may read,
// from passages of released results, minutes, risks, gate decisions and roles
// (engine/knowledge.ts). Need-to-know comes first: the search sees only what
// the person may read, so the model never gets anything else. The model
// answers from the passages and names them; code keeps only the sources it was
// given, and an answer without a source is no answer.

import {
  PASSAGE_KIND_LABELS,
  knowledgePassages,
  readableProjects,
  searchPassages,
  type KnowledgeAnswer,
  type KnowledgeSource,
} from "@hermes-helfer/core";
import { randomUUID } from "node:crypto";
import type { ProjectRepository } from "../projects/repository";
import type { RequestContext } from "../projects/service";
import { cut } from "./output";
import { addUsage, failedUsage, type AiProvider, type Usage } from "./provider";
import { agentFailure, callFor, closedByPerson, recordAiRun, type AiRunRecord, type Logger } from "./runner";

export const NOTHING_FOUND = "Dazu habe ich in den Unterlagen, die du lesen darfst, nichts gefunden.";

export class KnowledgeAgent {
  constructor(
    private readonly repo: ProjectRepository,
    private readonly provider: AiProvider,
    private readonly log: Logger,
  ) {}

  async ask(ctx: RequestContext, question: string): Promise<KnowledgeAnswer> {
    const model = this.repo.model;
    const info = this.provider.info;
    const projects = readableProjects(await this.repo.all(), ctx.viewer);
    const passages = knowledgePassages(projects, model, ctx.viewer);
    const hits = searchPassages(passages, question);
    const base = {
      question,
      searched: { projects: projects.length, passages: passages.length },
      producer: { kind: "ai", agent: "A13", provider: info.provider, model: info.model } as const,
    };
    const nothing = (): KnowledgeAnswer => ({ ...base, found: false, answer: NOTHING_FOUND, sources: [] });
    // Nothing to answer from: no model call.
    if (!hits.length) return nothing();

    const ids = hits.map((_, i) => `Q${i + 1}`);
    const runId = randomUUID();
    const started = Date.now();
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const record = (outcome: AiRunRecord["outcome"], cited: number) =>
      recordAiRun(this.log, info, {
        runId,
        projectId: "",
        skillId: "wissen.frage",
        agent: "A13",
        outcome,
        findings: cited,
        durationMs: Date.now() - started,
        usage,
        requestedBy: ctx.viewer.userId,
        channel: ctx.channel,
        correlationId: ctx.correlationId,
        sourceProjects: [...new Set(hits.map((p) => p.projectCode))],
      });

    let answer: KnowledgeAnswer;
    try {
      const res = await this.provider.answerQuestion(
        {
          agent: model.agent("A13"),
          question,
          passages: hits.map((p, i) => ({
            id: ids[i]!,
            source: `${p.projectCode} «${p.projectName}» · ${PASSAGE_KIND_LABELS[p.kind]} · ${p.title}`,
            text: p.text,
          })),
        },
        callFor(ctx),
      );
      if (res.usage) usage = res.usage;
      const known = new Set(ids);
      // Sources in the order the answer names them; a source the model was not given is dropped.
      const named = [...res.reply.answer.matchAll(/\[(Q\d+)\]/g)].map((m) => m[1]!);
      const cited = [...new Set([...named, ...res.reply.citations.map((c) => c.trim())])].filter((id) =>
        known.has(id),
      );
      const text = res.reply.answer
        .replace(/\s*\[(Q\d+)\]/g, (m, id: string) => (known.has(id) ? m : ""))
        .trim();
      if (!res.reply.found || !cited.length || !text) {
        answer = nothing();
      } else {
        const sources = cited.map((id): KnowledgeSource => {
          const p = hits[ids.indexOf(id)]!;
          return {
            id,
            projectCode: p.projectCode,
            projectName: p.projectName,
            kind: p.kind,
            title: p.title,
            excerpt: cut(p.text, 300),
            ...(p.deliverableId ? { deliverableId: p.deliverableId } : {}),
          };
        });
        answer = { ...base, found: true, answer: text, sources };
      }
    } catch (err) {
      usage = addUsage(usage, failedUsage(err));
      record(closedByPerson(err) ? "aborted" : "failed", 0);
      throw agentFailure(
        this.log,
        err,
        { runId },
        "knowledge",
        "Die Unterlagen findest du auch in den Vorhaben selbst.",
      );
    }
    record("completed", answer.sources.length);
    return answer;
  }
}
