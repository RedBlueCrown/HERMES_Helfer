// Event store in memory, optionally persisted as JSON lines per project.
// For tests and local development only; production uses SqlEventStore.

import type { StoredEvent } from "@hermes-helfer/core";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deepFreeze } from "../util/canonical-json";
import {
  GENESIS_HASH,
  assertValidAppend,
  sealEvents,
  type AppendRequest,
  type EventStore,
  type StreamHead,
} from "./event-store";

export interface MemoryEventStoreOptions {
  /** Directory for JSON-lines persistence; omit for memory only. */
  dataDir?: string;
  now?: () => Date;
}

const PROJECT_ID = /^[a-z0-9-]{1,64}$/;

export class MemoryEventStore implements EventStore {
  readonly kind = "memory";
  private readonly streams = new Map<string, StoredEvent[]>();
  private readonly now: () => Date;

  constructor(private readonly opts: MemoryEventStoreOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    if (opts.dataDir) this.load(opts.dataDir);
  }

  private dir(): string | undefined {
    return this.opts.dataDir ? join(this.opts.dataDir, "projects") : undefined;
  }

  /** Loads the files as they are. The repository verifies the hash chains. */
  private load(dataDir: string): void {
    const dir = join(dataDir, "projects");
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
      const lines = readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean);
      const events = lines.map((l) => deepFreeze(JSON.parse(l) as StoredEvent));
      this.streams.set(name.slice(0, -".jsonl".length), events);
    }
  }

  async append(req: AppendRequest): Promise<StoredEvent[]> {
    if (!PROJECT_ID.test(req.projectId)) throw new Error(`Invalid project id ${req.projectId}`);
    const stream = this.streams.get(req.projectId) ?? [];
    assertValidAppend(req, stream.length);
    const last = stream.at(-1);
    const stored = sealEvents(
      req,
      { seq: last?.seq ?? 0, hash: last?.hash ?? GENESIS_HASH },
      req.at ?? this.now().toISOString(),
    );
    const dir = this.dir();
    if (dir) {
      mkdirSync(dir, { recursive: true });
      appendFileSync(
        join(dir, `${req.projectId}.jsonl`),
        stored.map((e) => JSON.stringify(e)).join("\n") + "\n",
        "utf8",
      );
    }
    this.streams.set(req.projectId, [...stream, ...stored]);
    return stored;
  }

  async read(projectId: string, afterSeq = 0): Promise<StoredEvent[]> {
    return (this.streams.get(projectId) ?? []).filter((e) => e.seq > afterSeq);
  }

  async heads(): Promise<StreamHead[]> {
    return [...this.streams].map(([projectId, events]) => ({
      projectId,
      lastSeq: events.at(-1)?.seq ?? 0,
    }));
  }

  async ping(): Promise<void> {}

  async close(): Promise<void> {}

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
