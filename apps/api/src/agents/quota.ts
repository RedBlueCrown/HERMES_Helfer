// Shared use of the model (review F9). The deployment has one tokens-per-minute
// quota for all agents and projects: one person repeating a review must not
// leave everyone else with «ausgelastet». So at most a few calls run at a time,
// and only a few of them for the same person; a call waits only briefly for a
// free slot (a draft in the background longer); each person has a daily token
// budget, which also counts calls that failed after the model answered; and a
// call stops when the person closes the request.
//
// The budget is checked before a call, so calls running at the same time can
// pass it together: by at most the person's parallel calls times the tokens of
// one call.
//
// In memory: the API runs as one instance (todo-later E10). With several
// instances, or for limits per project, the API Management AI gateway takes
// over (todo-later H03).

import {
  AiProviderError,
  failedUsage,
  type AiProvider,
  type CallContext,
  type ChatMessage,
  type ToolSpec,
  type Usage,
} from "./provider";

export interface QuotaOptions {
  /** Model calls at the same time, across all agents. */
  maxConcurrent: number;
  /** Model calls at the same time for one person. */
  maxConcurrentPerUser: number;
  /** How long a call waits for a free slot before it is refused. */
  waitMs: number;
  /** The same for a draft in the background, which nobody waits for. */
  backgroundWaitMs: number;
  /** Tokens (input and output) per person and day (UTC); 0: no limit. */
  dailyTokensPerUser: number;
  now?: () => number;
}

const aborted = () => new AiProviderError("aborted", "The request was closed");

interface Waiter {
  userId: string | undefined;
  grant(): void;
}

export class AiQuota {
  private running = 0;
  private readonly perUser = new Map<string, number>();
  private readonly waiting: Waiter[] = [];
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

  private ownCalls = (userId: string | undefined) => (userId ? (this.perUser.get(userId) ?? 0) : 0);

  private canStart(userId: string | undefined): boolean {
    return this.running < this.opts.maxConcurrent && this.ownCalls(userId) < this.opts.maxConcurrentPerUser;
  }

  private start(userId: string | undefined): void {
    this.running++;
    if (userId) this.perUser.set(userId, this.ownCalls(userId) + 1);
  }

  private acquire(ctx: CallContext | undefined): Promise<void> {
    const userId = ctx?.userId;
    const signal = ctx?.signal;
    if (signal?.aborted) return Promise.reject(aborted());
    // A free slot means nobody in line could take it (release hands slots out at once).
    if (this.canStart(userId)) {
      this.start(userId);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const done = (err?: AiProviderError) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const i = this.waiting.indexOf(waiter);
        if (i >= 0) this.waiting.splice(i, 1);
        if (err) reject(err);
        else resolve();
      };
      // release() counts the slot for the waiter before it grants it.
      const waiter: Waiter = { userId, grant: () => done() };
      const onAbort = () => done(aborted());
      const timer = setTimeout(
        () =>
          done(
            this.ownCalls(userId) >= this.opts.maxConcurrentPerUser
              ? new AiProviderError("own_limit", "The person's calls use all their slots")
              : new AiProviderError("busy", "No free slot for a model call"),
          ),
        ctx?.background ? this.opts.backgroundWaitMs : this.opts.waitMs,
      );
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(waiter);
    });
  }

  private release(userId: string | undefined): void {
    this.running--;
    if (userId) {
      const n = this.ownCalls(userId) - 1;
      if (n > 0) this.perUser.set(userId, n);
      else this.perUser.delete(userId);
    }
    // The free slot goes to the first in line whose person is below their limit.
    const next = this.waiting.find((w) => this.canStart(w.userId));
    if (next) {
      this.start(next.userId);
      next.grant();
    }
  }

  /** Runs `call` in a free slot and charges its tokens to the person, also when it failed. */
  async run<T extends { usage?: Usage }>(ctx: CallContext | undefined, call: () => Promise<T>): Promise<T> {
    const userId = ctx?.userId;
    const budget = this.opts.dailyTokensPerUser;
    if (userId && budget > 0 && this.usedToday(userId) >= budget) {
      throw new AiProviderError("budget", "Daily token budget used up");
    }
    await this.acquire(ctx);
    try {
      const out = await call();
      if (userId) this.charge(userId, out.usage);
      return out;
    } catch (err) {
      if (userId) this.charge(userId, failedUsage(err));
      throw err;
    } finally {
      this.release(userId);
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
  extractMinutes: AiProvider["extractMinutes"] = (req, ctx) =>
    this.quota.run(ctx, () => this.inner.extractMinutes(req, ctx));
  answerQuestion: AiProvider["answerQuestion"] = (req, ctx) =>
    this.quota.run(ctx, () => this.inner.answerQuestion(req, ctx));
}
