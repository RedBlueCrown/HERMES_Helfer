// Shared use of the model (review F9). The deployment has one tokens-per-minute
// quota for all agents and projects: one person repeating a review must not
// leave everyone else with «ausgelastet». So at most a few calls run at a time,
// a call waits only briefly for a free slot, each person has a daily token
// budget, and a call stops when the person closes the request.
//
// In memory: the API runs as one instance (todo-later E10). With several
// instances, or for limits per project, the API Management AI gateway takes
// over (todo-later H03).

import {
  AiProviderError,
  type AiProvider,
  type CallContext,
  type ChatMessage,
  type ToolSpec,
  type Usage,
} from "./provider";

export interface QuotaOptions {
  /** Model calls at the same time, across all agents. */
  maxConcurrent: number;
  /** How long a call waits for a free slot before it is refused. */
  waitMs: number;
  /** Tokens (input and output) per person and day (UTC); 0: no limit. */
  dailyTokensPerUser: number;
  now?: () => number;
}

const aborted = () => new AiProviderError("aborted", "The request was closed");

export class AiQuota {
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly used = new Map<string, { day: string; tokens: number }>();

  constructor(private readonly opts: QuotaOptions) {}

  private day(): string {
    return new Date(this.opts.now?.() ?? Date.now()).toISOString().slice(0, 10);
  }

  /** Tokens the person used today. */
  usedToday(userId: string): number {
    const u = this.used.get(userId);
    return u && u.day === this.day() ? u.tokens : 0;
  }

  private charge(userId: string, usage: Usage | undefined): void {
    if (!usage) return;
    this.used.set(userId, {
      day: this.day(),
      tokens: this.usedToday(userId) + usage.inputTokens + usage.outputTokens,
    });
  }

  private acquire(signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted) return Promise.reject(aborted());
    if (this.running < this.opts.maxConcurrent) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const done = (err?: AiProviderError) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const i = this.waiting.indexOf(grant);
        if (i >= 0) this.waiting.splice(i, 1);
        if (err) reject(err);
        else resolve();
      };
      // The slot passes directly to the next in line (release does not decrement).
      const grant = () => done();
      const onAbort = () => done(aborted());
      const timer = setTimeout(
        () => done(new AiProviderError("busy", "No free slot for a model call")),
        this.opts.waitMs,
      );
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(grant);
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.running--;
  }

  /** Runs `call` in a free slot and charges its tokens to the person. */
  async run<T extends { usage?: Usage }>(ctx: CallContext | undefined, call: () => Promise<T>): Promise<T> {
    const userId = ctx?.userId;
    const budget = this.opts.dailyTokensPerUser;
    if (userId && budget > 0 && this.usedToday(userId) >= budget) {
      throw new AiProviderError("budget", "Daily token budget used up");
    }
    await this.acquire(ctx?.signal);
    try {
      const out = await call();
      if (userId) this.charge(userId, out.usage);
      return out;
    } finally {
      this.release();
    }
  }
}

/** The provider for the agents: every call goes through the quota. */
export class QuotaProvider implements AiProvider {
  readonly chat?: AiProvider["chat"];

  constructor(
    private readonly inner: AiProvider,
    private readonly quota: AiQuota,
  ) {
    if (inner.chat) {
      const chat = inner.chat.bind(inner);
      this.chat = (messages: ChatMessage[], tools: ToolSpec[], ctx?: CallContext) =>
        this.quota.run(ctx, () => chat(messages, tools, ctx));
    }
  }

  get info() {
    return this.inner.info;
  }

  draft: AiProvider["draft"] = (req, ctx) => this.quota.run(ctx, () => this.inner.draft(req, ctx));
  critique: AiProvider["critique"] = (req, ctx) => this.quota.run(ctx, () => this.inner.critique(req, ctx));
  draftChangeRequest: AiProvider["draftChangeRequest"] = (req, ctx) =>
    this.quota.run(ctx, () => this.inner.draftChangeRequest(req, ctx));
  reviewRisks: AiProvider["reviewRisks"] = (req, ctx) =>
    this.quota.run(ctx, () => this.inner.reviewRisks(req, ctx));
  draftStatusReport: AiProvider["draftStatusReport"] = (req, ctx) =>
    this.quota.run(ctx, () => this.inner.draftStatusReport(req, ctx));
}
