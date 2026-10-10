// Append-only event store with a hash chain per project (architecture §9).
// Implementations: MemoryEventStore (tests and local development, optionally
// persisted as JSON lines) and SqlEventStore (Azure SQL, append-only ledger table).

import type { Actor, ProjectEvent, StoredEvent } from "@hermes-helfer/core";
import { createHash, randomUUID } from "node:crypto";
import { canonicalJson, deepFreeze } from "../util/canonical-json";

export const GENESIS_HASH = "0".repeat(64);

export interface AppendRequest {
  projectId: string;
  /** Sequence number of the last event the caller has seen (0 for a new project). */
  expectedSeq: number;
  events: ProjectEvent[];
  actor: Actor;
  correlationId: string;
  /** Only for seeding and data imports: timestamp of the events. */
  at?: string;
}

export interface StreamHead {
  projectId: string;
  lastSeq: number;
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  brokenAtSeq?: number;
  reason?: string;
}

export interface EventStore {
  readonly kind: "memory" | "sql";
  /**
   * Appends events if the stream is still at `expectedSeq`, otherwise throws
   * ConcurrencyError. A new stream (expectedSeq 0) must start with ProjectCreated.
   */
  append(req: AppendRequest): Promise<StoredEvent[]>;
  /** Events with a sequence number greater than `afterSeq`, oldest first. */
  read(projectId: string, afterSeq?: number): Promise<StoredEvent[]>;
  /** The last sequence number of every stream. */
  heads(): Promise<StreamHead[]>;
  /** Throws if the store cannot serve requests (readiness probe). */
  ping(): Promise<void>;
  close(): Promise<void>;
}

export class ConcurrencyError extends Error {
  constructor(
    readonly projectId: string,
    readonly expectedSeq: number,
    readonly actualSeq: number | undefined,
  ) {
    super(`Concurrent change on ${projectId}: expected seq ${expectedSeq}, actual ${actualSeq ?? "unknown"}`);
  }
}

/** The store cannot be reached right now (network, failover, throttling). Worth retrying later. */
export class StoreUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StoreUnavailableError";
  }
}

/** A stored event cannot be read back (for example invalid JSON). */
export class CorruptStreamError extends Error {
  constructor(
    readonly projectId: string,
    readonly seq: number,
    reason: string,
  ) {
    super(`Event ${seq} of ${projectId} is unreadable: ${reason}`);
    this.name = "CorruptStreamError";
  }
}

type Unhashed = Omit<StoredEvent, "hash">;

export function hashEvent(e: Unhashed): string {
  const { projectId, seq, id, type, data, at, actor, correlationId, prevHash } = e;
  return createHash("sha256")
    .update(canonicalJson({ projectId, seq, id, type, data, at, actor, correlationId, prevHash }))
    .digest("hex");
}

/** Checks the request before anything is written. */
export function assertValidAppend(req: AppendRequest, actualSeq: number): void {
  if (actualSeq !== req.expectedSeq) throw new ConcurrencyError(req.projectId, req.expectedSeq, actualSeq);
  if (req.events.length === 0) throw new Error("Nothing to append");
  if (actualSeq === 0 && req.events[0]?.type !== "ProjectCreated") {
    throw new Error("A new project stream must start with ProjectCreated");
  }
}

/** Turns the requested events into stored events that continue the chain after `prev`. */
export function sealEvents(
  req: AppendRequest,
  prev: { seq: number; hash: string },
  at: string,
): StoredEvent[] {
  let prevHash = prev.hash;
  return req.events.map((event, i) => {
    const unhashed = {
      ...structuredClone(event),
      projectId: req.projectId,
      seq: prev.seq + i + 1,
      id: randomUUID(),
      at,
      actor: structuredClone(req.actor),
      correlationId: req.correlationId,
      prevHash,
    } as Unhashed;
    const stored = deepFreeze({ ...unhashed, hash: hashEvent(unhashed) } as StoredEvent);
    prevHash = stored.hash;
    return stored;
  });
}

/**
 * Verifies that `events` form an unbroken chain. With `after`, the events must
 * continue the chain after that event (incremental check of newly read events).
 */
export function verifyChain(
  events: readonly StoredEvent[],
  after: { seq: number; hash: string } = { seq: 0, hash: GENESIS_HASH },
): VerifyResult {
  let prev = after.hash;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const broken = (reason: string): VerifyResult => ({ ok: false, checked: i, brokenAtSeq: e.seq, reason });
    if (e.seq !== after.seq + i + 1) return broken("Lücke in der Reihenfolge");
    if (e.prevHash !== prev) return broken("Verkettung zum vorherigen Ereignis gebrochen");
    if (hashEvent(e) !== e.hash) return broken("Inhalt nachträglich verändert");
    prev = e.hash;
  }
  return { ok: true, checked: events.length };
}
