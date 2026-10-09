import {
  foldEvents,
  type Actor,
  type HermesModel,
  type ProjectEvent,
  type ProjectState,
  type StoredEvent,
} from "@hermes-helfer/core";
import { HttpError } from "../errors";
import { ConcurrencyError, type EventStore } from "../store/event-store";
import { KeyedMutex } from "../util/mutex";

/**
 * Read side and write gate for project streams. States are folded from events
 * and cached until the stream changes. Commands run under a per-project lock.
 */
export class ProjectRepository {
  private readonly cache = new Map<string, ProjectState>();
  private readonly codes = new Map<string, string>();
  private readonly mutex = new KeyedMutex();

  constructor(
    private readonly store: EventStore,
    readonly model: HermesModel,
  ) {
    for (const id of store.projectIds()) this.index(id);
  }

  private index(projectId: string): void {
    const first = this.store.read(projectId)[0];
    if (first?.type === "ProjectCreated") this.codes.set(first.data.code.toUpperCase(), projectId);
  }

  get(projectId: string): ProjectState | undefined {
    const events = this.store.read(projectId);
    if (!events.length) return undefined;
    const cached = this.cache.get(projectId);
    if (cached && cached.lastSeq === events.length) return cached;
    const state = foldEvents(events, this.model);
    this.cache.set(projectId, state);
    return state;
  }

  findByCode(code: string): ProjectState | undefined {
    const id = this.codes.get(code.toUpperCase());
    return id ? this.get(id) : undefined;
  }

  codeExists(code: string): boolean {
    return this.codes.has(code.toUpperCase());
  }

  all(): ProjectState[] {
    return this.store
      .projectIds()
      .map((id) => this.get(id))
      .filter((s): s is ProjectState => !!s);
  }

  events(projectId: string): readonly StoredEvent[] {
    return this.store.read(projectId);
  }

  verify(projectId: string) {
    return this.store.verify(projectId);
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
    try {
      const stored = await this.store.append({
        projectId,
        expectedSeq,
        events,
        actor,
        correlationId,
        ...(at ? { at } : {}),
      });
      if (expectedSeq === 0) this.index(projectId);
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
}
