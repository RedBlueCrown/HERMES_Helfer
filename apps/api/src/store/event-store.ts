// Append-only event store with a hash chain per project (architecture §9).
// Pilot implementation: in memory, optionally persisted as JSON lines per
// project. Next increment: Azure SQL with an append-only ledger table (H01).

import type { Actor, ProjectEvent, StoredEvent } from "@hermes-helfer/core";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

export interface VerifyResult {
  ok: boolean;
  checked: number;
  brokenAtSeq?: number;
  reason?: string;
}

export interface EventStore {
  append(req: AppendRequest): Promise<StoredEvent[]>;
  read(projectId: string): readonly StoredEvent[];
  projectIds(): string[];
  verify(projectId: string): VerifyResult;
}

export class ConcurrencyError extends Error {
  constructor(
    readonly projectId: string,
    readonly expectedSeq: number,
    readonly actualSeq: number,
  ) {
    super(`Concurrent change on ${projectId}: expected seq ${expectedSeq}, actual ${actualSeq}`);
  }
}

type Unhashed = Omit<StoredEvent, "hash">;

export function hashEvent(e: Unhashed): string {
  const { projectId, seq, id, type, data, at, actor, correlationId, prevHash } = e;
  return createHash("sha256")
    .update(canonicalJson({ projectId, seq, id, type, data, at, actor, correlationId, prevHash }))
    .digest("hex");
}

export function verifyChain(events: readonly StoredEvent[]): VerifyResult {
  let prev = GENESIS_HASH;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.seq !== i + 1)
      return { ok: false, checked: i, brokenAtSeq: e.seq, reason: "Lücke in der Reihenfolge" };
    if (e.prevHash !== prev) {
      return {
        ok: false,
        checked: i,
        brokenAtSeq: e.seq,
        reason: "Verkettung zum vorherigen Ereignis gebrochen",
      };
    }
    if (hashEvent(e) !== e.hash) {
      return { ok: false, checked: i, brokenAtSeq: e.seq, reason: "Inhalt nachträglich verändert" };
    }
    prev = e.hash;
  }
  return { ok: true, checked: events.length };
}

export interface MemoryEventStoreOptions {
  /** Directory for JSON-lines persistence; omit for memory only. */
  dataDir?: string;
  now?: () => Date;
  onCorruptProject?: (projectId: string, result: VerifyResult) => void;
}

export class MemoryEventStore implements EventStore {
  private readonly streams = new Map<string, StoredEvent[]>();
  private readonly now: () => Date;
  /** Projects that failed verification at load time and are not served (todo-later E11). */
  readonly quarantined = new Map<string, VerifyResult>();

  constructor(private readonly opts: MemoryEventStoreOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    if (opts.dataDir) this.load(opts.dataDir);
  }

  private file(projectId: string): string | undefined {
    return this.opts.dataDir ? join(this.opts.dataDir, "projects", `${projectId}.jsonl`) : undefined;
  }

  private load(dataDir: string): void {
    const dir = join(dataDir, "projects");
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
      const projectId = name.slice(0, -".jsonl".length);
      const lines = readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean);
      const events = lines.map((l) => deepFreeze(JSON.parse(l) as StoredEvent));
      const result = verifyChain(events);
      if (!result.ok) {
        this.quarantined.set(projectId, result);
        this.opts.onCorruptProject?.(projectId, result);
        continue;
      }
      this.streams.set(projectId, events);
    }
  }

  async append(req: AppendRequest): Promise<StoredEvent[]> {
    if (this.quarantined.has(req.projectId)) {
      throw new Error(`Project ${req.projectId} is quarantined after a failed integrity check`);
    }
    const stream = this.streams.get(req.projectId) ?? [];
    const actualSeq = stream.length;
    if (actualSeq !== req.expectedSeq) throw new ConcurrencyError(req.projectId, req.expectedSeq, actualSeq);
    if (actualSeq === 0 && req.events[0]?.type !== "ProjectCreated") {
      throw new Error("A new project stream must start with ProjectCreated");
    }
    const at = req.at ?? this.now().toISOString();
    let prevHash = stream.at(-1)?.hash ?? GENESIS_HASH;
    const stored: StoredEvent[] = [];
    for (const [i, event] of req.events.entries()) {
      const unhashed = {
        ...structuredClone(event),
        projectId: req.projectId,
        seq: actualSeq + i + 1,
        id: randomUUID(),
        at,
        actor: structuredClone(req.actor),
        correlationId: req.correlationId,
        prevHash,
      } as Unhashed;
      const e = deepFreeze({ ...unhashed, hash: hashEvent(unhashed) } as StoredEvent);
      prevHash = e.hash;
      stored.push(e);
    }
    const file = this.file(req.projectId);
    if (file) {
      mkdirSync(join(this.opts.dataDir!, "projects"), { recursive: true });
      appendFileSync(file, stored.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    }
    this.streams.set(req.projectId, [...stream, ...stored]);
    return stored;
  }

  read(projectId: string): readonly StoredEvent[] {
    return this.streams.get(projectId) ?? [];
  }

  projectIds(): string[] {
    return [...this.streams.keys()];
  }

  verify(projectId: string): VerifyResult {
    const q = this.quarantined.get(projectId);
    return q ?? verifyChain(this.read(projectId));
  }

  /** Test helper: replace an event to simulate tampering. Never used by the app. */
  tamperForTest(projectId: string, seq: number, patch: (e: StoredEvent) => StoredEvent): void {
    const stream = this.streams.get(projectId);
    if (!stream) return;
    this.streams.set(
      projectId,
      stream.map((e) => (e.seq === seq ? patch(structuredClone(e) as StoredEvent) : e)),
    );
  }
}
