// Event store on Azure SQL Database (or SQL Server 2022+ for development).
// Events live in an append-only ledger table; hh.streams holds the head of
// each stream and serializes appends per project across API instances.

import type { StoredEvent } from "@hermes-helfer/core";
import { deepFreeze } from "../../util/canonical-json";
import {
  ConcurrencyError,
  CorruptStreamError,
  GENESIS_HASH,
  StoreUnavailableError,
  assertValidAppend,
  sealEvents,
  type AppendRequest,
  type EventStore,
  type StreamHead,
} from "../event-store";
import { rollbackQuietly } from "./migrations";
import { sql, type Mssql } from "./mssql";

/** SQL errors worth retrying: Azure SQL failover, throttling, deadlocks, broken connections. */
const TRANSIENT_ERRORS = new Set([
  20, 64, 233, 1205, 4060, 4221, 10053, 10054, 10060, 10928, 10929, 40143, 40197, 40501, 40540, 40613, 42108,
  42109, 49918, 49919, 49920,
]);
const TRANSIENT_CODES = new Set(["ESOCKET", "ECONNCLOSED", "ECONNRESET", "ETIMEOUT", "ENOCONN"]);
const UNIQUE_VIOLATION = new Set([2601, 2627]);

/** Parameters per INSERT statement stay well below SQL Server's limit of 2,100. */
const ROWS_PER_INSERT = 100;
const READ_ATTEMPTS = 3;

interface SqlError {
  number?: number;
  code?: string;
  originalError?: { number?: number; code?: string; info?: { number?: number } };
}

export function sqlErrorNumber(err: unknown): number | undefined {
  const e = err as SqlError;
  return e?.number ?? e?.originalError?.info?.number ?? e?.originalError?.number;
}

export function isTransientSqlError(err: unknown): boolean {
  const e = err as SqlError;
  const n = sqlErrorNumber(err);
  return (
    (n !== undefined && TRANSIENT_ERRORS.has(n)) ||
    TRANSIENT_CODES.has(e?.code ?? "") ||
    TRANSIENT_CODES.has(e?.originalError?.code ?? "")
  );
}

export interface SqlEventStoreOptions {
  now?: () => Date;
  /** Waits between read attempts; tests pass a shorter one. */
  backoffMs?: (attempt: number) => number;
}

export class SqlEventStore implements EventStore {
  readonly kind = "sql";
  private readonly now: () => Date;
  private readonly backoffMs: (attempt: number) => number;

  constructor(
    private readonly pool: Mssql.ConnectionPool,
    opts: SqlEventStoreOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.backoffMs = opts.backoffMs ?? ((attempt) => 200 * 4 ** (attempt - 1));
  }

  async append(req: AppendRequest): Promise<StoredEvent[]> {
    const tx = new sql.Transaction(this.pool);
    try {
      await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
      // UPDLOCK makes a second writer on the same project wait until this transaction ends.
      const head = await new sql.Request(tx)
        .input("projectId", sql.VarChar(64), req.projectId)
        .query<{ last_seq: number; last_hash: string }>(
          "SELECT last_seq, last_hash FROM hh.streams WITH (UPDLOCK, ROWLOCK) WHERE project_id = @projectId",
        );
      const current = head.recordset[0];
      assertValidAppend(req, current?.last_seq ?? 0);
      const stored = sealEvents(
        req,
        { seq: current?.last_seq ?? 0, hash: current?.last_hash ?? GENESIS_HASH },
        req.at ?? this.now().toISOString(),
      );
      const last = stored.at(-1)!;

      const move = new sql.Request(tx)
        .input("projectId", sql.VarChar(64), req.projectId)
        .input("lastSeq", sql.Int, last.seq)
        .input("lastHash", sql.Char(64), last.hash);
      if (current) {
        const r = await move.input("expectedSeq", sql.Int, req.expectedSeq).query(
          `UPDATE hh.streams SET last_seq = @lastSeq, last_hash = @lastHash, updated_at = SYSUTCDATETIME()
            WHERE project_id = @projectId AND last_seq = @expectedSeq`,
        );
        if (r.rowsAffected[0] !== 1) throw new ConcurrencyError(req.projectId, req.expectedSeq, undefined);
      } else {
        // A parallel create of the same project fails here with a key violation.
        await move.query(
          "INSERT INTO hh.streams (project_id, last_seq, last_hash) VALUES (@projectId, @lastSeq, @lastHash)",
        );
      }

      for (let i = 0; i < stored.length; i += ROWS_PER_INSERT) {
        await this.insertEvents(tx, stored.slice(i, i + ROWS_PER_INSERT));
      }
      await tx.commit();
      return stored;
    } catch (err) {
      await rollbackQuietly(tx);
      if (err instanceof ConcurrencyError) throw err;
      const n = sqlErrorNumber(err);
      if (n !== undefined && UNIQUE_VIOLATION.has(n)) {
        throw new ConcurrencyError(req.projectId, req.expectedSeq, undefined);
      }
      if (isTransientSqlError(err)) {
        throw new StoreUnavailableError("The SQL event store is unavailable.", { cause: err });
      }
      throw err;
    }
  }

  private async insertEvents(tx: Mssql.Transaction, events: readonly StoredEvent[]): Promise<void> {
    const request = new sql.Request(tx);
    const rows = events.map((e, i) => {
      request
        .input(`p${i}`, sql.VarChar(64), e.projectId)
        .input(`s${i}`, sql.Int, e.seq)
        .input(`id${i}`, sql.UniqueIdentifier, e.id)
        .input(`t${i}`, sql.VarChar(64), e.type)
        .input(`at${i}`, sql.DateTime2(3), new Date(e.at))
        .input(`a${i}`, sql.NVarChar(128), e.actor.userId)
        .input(`c${i}`, sql.VarChar(128), e.correlationId)
        .input(`ph${i}`, sql.Char(64), e.prevHash)
        .input(`h${i}`, sql.Char(64), e.hash)
        .input(`b${i}`, sql.NVarChar(sql.MAX), JSON.stringify(e));
      return `(@p${i}, @s${i}, @id${i}, @t${i}, @at${i}, @a${i}, @c${i}, @ph${i}, @h${i}, @b${i})`;
    });
    await request.query(
      `INSERT INTO hh.events
        (project_id, seq, event_id, event_type, occurred_at, actor_id, correlation_id, prev_hash, hash, body)
      VALUES ${rows.join(",\n")}`,
    );
  }

  async read(projectId: string, afterSeq = 0): Promise<StoredEvent[]> {
    const result = await this.withRetry(() =>
      this.pool
        .request()
        .input("projectId", sql.VarChar(64), projectId)
        .input("afterSeq", sql.Int, afterSeq)
        .query<{ seq: number; hash: string; body: string }>(
          "SELECT seq, hash, body FROM hh.events WHERE project_id = @projectId AND seq > @afterSeq ORDER BY seq",
        ),
    );
    return result.recordset.map((row) => toEvent(projectId, row));
  }

  async heads(): Promise<StreamHead[]> {
    const result = await this.withRetry(() =>
      this.pool
        .request()
        .query<{ project_id: string; last_seq: number }>("SELECT project_id, last_seq FROM hh.streams"),
    );
    return result.recordset.map((r) => ({ projectId: r.project_id, lastSeq: r.last_seq }));
  }

  async ping(): Promise<void> {
    await this.withRetry(() => this.pool.request().query("SELECT 1 AS ok"), 1);
  }

  async close(): Promise<void> {
    await this.pool.close();
  }

  /** Retries reads on transient errors, then reports the store as unavailable. */
  private async withRetry<T>(op: () => Promise<T>, attempts = READ_ATTEMPTS): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await op();
      } catch (err) {
        if (!isTransientSqlError(err)) throw err;
        if (attempt >= attempts) {
          throw new StoreUnavailableError("The SQL event store is unavailable.", { cause: err });
        }
        await new Promise((r) => setTimeout(r, this.backoffMs(attempt)));
      }
    }
  }
}

/**
 * The body is the stored event. Columns win over the body for identity, so a
 * difference between the two shows up as a broken hash in the chain check.
 */
function toEvent(projectId: string, row: { seq: number; hash: string; body: string }): StoredEvent {
  let parsed: StoredEvent;
  try {
    parsed = JSON.parse(row.body) as StoredEvent;
  } catch {
    throw new CorruptStreamError(projectId, row.seq, "invalid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new CorruptStreamError(projectId, row.seq, "not an object");
  }
  return deepFreeze({ ...parsed, projectId, seq: row.seq, hash: row.hash });
}
