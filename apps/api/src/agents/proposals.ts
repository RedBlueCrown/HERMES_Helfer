// Proposals of the agents, kept on the server until a person accepts them.
// Accepting names the proposal; the server then records which agent, model
// and run produced it, and whether the person changed it. The client cannot
// claim AI provenance (architecture §3, principle 4).
//
// In memory: the API runs as one instance (todo-later E10); with several,
// proposals move to a shared store. They expire after a day.

import type { Producer } from "@hermes-helfer/core";
import { randomUUID } from "node:crypto";
import { HttpError } from "../errors";

export type ProposalKind = "change-request" | "risk-review" | "status-report";

export interface StoredProposal<T> {
  id: string;
  kind: ProposalKind;
  projectId: string;
  /** Only the person who asked the agent may accept the proposal. */
  userId: string;
  /** Agent, provider, model and the run id of the ai_run audit entry. */
  producer: Producer;
  content: T;
  createdAt: number;
  /** Parts already accepted (risk reviews accept item by item). */
  accepted: Set<string>;
  /** A request is using the whole proposal right now (claim). */
  claimed: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const PROPOSAL_GONE =
  "Der Vorschlag des Agenten ist abgelaufen oder gehört zu einer anderen Person. Bitte den Agenten neu fragen.";

export class ProposalStore {
  private readonly items = new Map<string, StoredProposal<unknown>>();

  constructor(
    private readonly ttlMs = DAY_MS,
    private readonly max = 2_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  put<T>(p: Pick<StoredProposal<T>, "kind" | "projectId" | "userId" | "producer" | "content">): string {
    this.prune();
    const id = randomUUID();
    this.items.set(id, { ...p, id, createdAt: this.now(), accepted: new Set(), claimed: false });
    return id;
  }

  /** The proposal, if it is of this kind, for this project and this person, and not expired; else 422. */
  require<T>(id: string, kind: ProposalKind, projectId: string, userId: string): StoredProposal<T> {
    const p = this.items.get(id);
    if (
      !p ||
      p.kind !== kind ||
      p.projectId !== projectId ||
      p.userId !== userId ||
      this.now() - p.createdAt > this.ttlMs
    ) {
      throw new HttpError(422, "proposal_gone", PROPOSAL_GONE);
    }
    return p as StoredProposal<T>;
  }

  /**
   * Takes the whole proposal for one request, before anything is awaited: a
   * second request with the same id is refused, so a proposal is used once even
   * when two submissions race. `release` hands it back when the command fails,
   * `delete` ends it when the command succeeded.
   */
  claim<T>(id: string, kind: ProposalKind, projectId: string, userId: string): StoredProposal<T> {
    const p = this.require<T>(id, kind, projectId, userId);
    if (p.claimed) throw new HttpError(409, "invalid_state", "Dieser Vorschlag wird bereits übernommen.");
    p.claimed = true;
    return p;
  }

  release(id: string): void {
    const p = this.items.get(id);
    if (p) p.claimed = false;
  }

  delete(id: string): void {
    this.items.delete(id);
  }

  private prune(): void {
    const t = this.now();
    for (const [id, p] of this.items) if (t - p.createdAt > this.ttlMs) this.items.delete(id);
    // Oldest first: Map keeps insertion order.
    while (this.items.size >= this.max) this.items.delete(this.items.keys().next().value!);
  }
}

/** The producer recorded for accepted agent content. */
export const acceptedProducer = (p: StoredProposal<unknown>, edited: boolean): Producer => ({
  ...p.producer,
  edited,
});

/** Same JSON: the person accepted the agent's content unchanged. */
export const sameContent = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
