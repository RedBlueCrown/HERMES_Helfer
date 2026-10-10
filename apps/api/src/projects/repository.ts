import {
  foldEvents,
  type Actor,
  type HermesModel,
  type ProjectEvent,
  type ProjectState,
  type StoredEvent,
} from "@hermes-helfer/core";
import { HttpError } from "../errors";
import {
  ConcurrencyError,
  CorruptStreamError,
  verifyChain,
  type EventStore,
  type VerifyResult,
} from "../store/event-store";
import { KeyedMutex } from "../util/mutex";

/** Stream id of a project. Derived from the code, so the store keeps codes unique. */
export function projectIdForCode(code: string): string {
  return `p-${code.trim().toLowerCase()}`;
}

export interface RepositoryOptions {
  /** Called once when a project fails verification; it is no longer served (todo-later E11). */
  onCorruptProject?: (projectId: string, result: VerifyResult) => void;
}

interface CachedStream {
  events: readonly StoredEvent[];
  state: ProjectState;
}

const LOAD_CONCURRENCY = 8;

/**
 * Read side and write gate for project streams. Keeps the events and the folded
 * state of every project in memory and fetches only new events from the store,
 * so several API instances can share one store. Every event read is checked
 * against the hash chain before it is used. Commands run under a per-project lock.
 */
export class ProjectRepository {
  private readonly cache = new Map<string, CachedStream>();
  private readonly quarantined = new Map<string, VerifyResult>();
  private readonly syncing = new Map<string, Promise<void>>();
  private readonly mutex = new KeyedMutex();

  constructor(
    private readonly store: EventStore,
    readonly model: HermesModel,
    private readonly opts: RepositoryOptions = {},
  ) {}

  /** Loads and verifies every project. Call once at startup. */
  async load(): Promise<void> {
    await this.refresh();
  }

  async get(projectId: string): Promise<ProjectState | undefined> {
    await this.sync(projectId);
    return this.cache.get(projectId)?.state;
  }

  findByCode(code: string): Promise<ProjectState | undefined> {
    return this.get(projectIdForCode(code));
  }

  /** All projects that can be served, up to date with the store. */
  async all(): Promise<ProjectState[]> {
    const heads = await this.refresh();
    return heads.flatMap((id) => this.cache.get(id)?.state ?? []);
  }

  async events(projectId: string): Promise<readonly StoredEvent[]> {
    await this.sync(projectId);
    return this.cache.get(projectId)?.events ?? [];
  }

  /**
   * Re-reads the whole stream from the store and checks the hash chain. Also
   * detects events that disappeared or were replaced since this instance read them.
   */
  async verify(projectId: string): Promise<VerifyResult> {
    const events = await this.store.read(projectId);
    let result = verifyChain(events);
    const seen = this.cache.get(projectId)?.events.at(-1);
    if (result.ok && seen && events[seen.seq - 1]?.hash !== seen.hash) {
      result = {
        ok: false,
        checked: events.length,
        brokenAtSeq: seen.seq,
        reason: "Ereignisse fehlen oder wurden ersetzt",
      };
    }
    if (!result.ok) this.quarantine(projectId, result);
    return result;
  }

  isQuarantined(projectId: string): boolean {
    return this.quarantined.has(projectId);
  }

  /** Serialize work on one project (read → check → append). */
  withLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    return this.mutex.run(projectId, fn);
  }

  async append(
    projectId: string,
    expectedSeq: number,
    events: ProjectEvent[],
    actor: Actor,
    correlationId: string,
    at?: string,
  ): Promise<StoredEvent[]> {
    if (this.quarantined.has(projectId)) {
      throw new HttpError(
        423,
        "locked",
        "Das Vorhaben ist gesperrt, weil die Integritätsprüfung fehlschlug.",
      );
    }
    try {
      const stored = await this.store.append({
        projectId,
        expectedSeq,
        events,
        actor,
        correlationId,
        ...(at ? { at } : {}),
      });
      this.merge(projectId, stored);
      return stored;
    } catch (err) {
      if (err instanceof ConcurrencyError) {
        throw new HttpError(
          409,
          "conflict",
          "Das Vorhaben wurde gerade von jemand anderem geändert. Bitte neu laden.",
        );
      }
      throw err;
    }
  }

  /** Brings the cache up to date with the heads of all streams; returns their ids. */
  private async refresh(): Promise<string[]> {
    const heads = await this.store.heads();
    const stale = heads.filter(
      (h) =>
        !this.quarantined.has(h.projectId) && (this.cache.get(h.projectId)?.state.lastSeq ?? 0) < h.lastSeq,
    );
    for (let i = 0; i < stale.length; i += LOAD_CONCURRENCY) {
      await Promise.all(stale.slice(i, i + LOAD_CONCURRENCY).map((h) => this.sync(h.projectId)));
    }
    return heads.map((h) => h.projectId);
  }

  /** Fetches events newer than the cached ones. Concurrent calls share one read. */
  private sync(projectId: string): Promise<void> {
    if (this.quarantined.has(projectId)) return Promise.resolve();
    const running = this.syncing.get(projectId);
    if (running) return running;
    const after = this.cache.get(projectId)?.state.lastSeq ?? 0;
    const job = this.store
      .read(projectId, after)
      .then(
        (fresh) => this.merge(projectId, fresh),
        (err: unknown) => {
          if (!(err instanceof CorruptStreamError)) throw err;
          this.quarantine(projectId, {
            ok: false,
            checked: err.seq - 1,
            brokenAtSeq: err.seq,
            reason: "Ereignis nicht lesbar",
          });
        },
      )
      .finally(() => this.syncing.delete(projectId));
    this.syncing.set(projectId, job);
    return job;
  }

  /** Adds events that continue the cached stream. Synchronous, so it never interleaves. */
  private merge(projectId: string, incoming: readonly StoredEvent[]): void {
    if (this.quarantined.has(projectId)) return;
    const cached = this.cache.get(projectId);
    const have = cached?.events ?? [];
    const last = have.at(-1);
    const fresh = incoming.filter((e) => e.seq > (last?.seq ?? 0));
    if (!fresh.length) return;
    const result = verifyChain(fresh, last ? { seq: last.seq, hash: last.hash } : undefined);
    if (!result.ok) {
      this.quarantine(projectId, {
        ...result,
        checked: result.checked + have.length,
      });
      return;
    }
    const events = [...have, ...fresh];
    let state: ProjectState;
    try {
      state = foldEvents(events, this.model);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.quarantine(projectId, { ok: false, checked: events.length, reason: `Nicht lesbar: ${reason}` });
      return;
    }
    this.cache.set(projectId, { events, state });
  }

  private quarantine(projectId: string, result: VerifyResult): void {
    if (this.quarantined.has(projectId)) return;
    this.quarantined.set(projectId, result);
    this.cache.delete(projectId);
    this.opts.onCorruptProject?.(projectId, result);
  }
}
