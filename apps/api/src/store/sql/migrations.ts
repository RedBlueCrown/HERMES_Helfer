// Database schema of the SQL event store.
//
// Migrations are append-only: never edit one that ran anywhere, add a new one.
// The runner stores a checksum per migration and stops if an applied one was
// changed. Prefer expand-only changes (add tables, columns, indexes), so the
// previous app version keeps working during a rolling deployment.

import { createHash } from "node:crypto";
import { sql, type Mssql } from "./mssql";

export interface Migration {
  version: number;
  name: string;
  /** Executed in order, each as its own batch, in one transaction with the others. */
  batches: readonly string[];
}

const BOOTSTRAP = [
  `IF SCHEMA_ID(N'hh') IS NULL EXEC(N'CREATE SCHEMA hh AUTHORIZATION dbo');`,
  `IF OBJECT_ID(N'hh.schema_migrations', N'U') IS NULL
  CREATE TABLE hh.schema_migrations (
    version    int           NOT NULL CONSTRAINT pk_schema_migrations PRIMARY KEY,
    name       nvarchar(200) NOT NULL,
    checksum   char(64)      NOT NULL,
    applied_at datetime2(3)  NOT NULL CONSTRAINT df_schema_migrations_applied_at DEFAULT SYSUTCDATETIME()
  );`,
];

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "event-store",
    batches: [
      // One row per event. Append-only ledger table: nobody can update or delete
      // rows, and the database keeps a cryptographic digest of every change.
      // body holds the complete event as JSON; the other columns are copies for queries.
      `CREATE TABLE hh.events (
        project_id     varchar(64)      NOT NULL,
        seq            int              NOT NULL,
        event_id       uniqueidentifier NOT NULL,
        event_type     varchar(64)      NOT NULL,
        occurred_at    datetime2(3)     NOT NULL,
        actor_id       nvarchar(128)    NOT NULL,
        correlation_id varchar(128)     NOT NULL,
        prev_hash      char(64)         NOT NULL,
        hash           char(64)         NOT NULL,
        body           nvarchar(max)    NOT NULL,
        CONSTRAINT pk_events PRIMARY KEY CLUSTERED (project_id, seq)
      )
      WITH (LEDGER = ON (APPEND_ONLY = ON));`,
      // Head of each stream. Appends lock and advance it, which serializes
      // writers per project across all API instances.
      `CREATE TABLE hh.streams (
        project_id varchar(64)  NOT NULL CONSTRAINT pk_streams PRIMARY KEY,
        last_seq   int          NOT NULL,
        last_hash  char(64)     NOT NULL,
        created_at datetime2(3) NOT NULL CONSTRAINT df_streams_created_at DEFAULT SYSUTCDATETIME(),
        updated_at datetime2(3) NOT NULL CONSTRAINT df_streams_updated_at DEFAULT SYSUTCDATETIME()
      );`,
      // Least privilege for the app's managed identity: read and append events,
      // move stream heads. No DDL, no delete.
      `IF DATABASE_PRINCIPAL_ID(N'hh_app') IS NULL EXEC(N'CREATE ROLE hh_app AUTHORIZATION dbo');`,
      `GRANT SELECT, INSERT ON hh.events TO hh_app;
      GRANT SELECT, INSERT, UPDATE ON hh.streams TO hh_app;
      GRANT SELECT ON hh.schema_migrations TO hh_app;`,
    ],
  },
];

/** The schema version this build of the app needs. */
export const SCHEMA_VERSION = MIGRATIONS.at(-1)!.version;

export function checksum(m: Migration): string {
  return createHash("sha256").update(JSON.stringify(m.batches)).digest("hex");
}

/**
 * Applies pending migrations in one transaction. An application lock keeps
 * parallel instances or jobs from migrating at the same time. Returns the
 * versions applied.
 */
export async function migrate(
  pool: Mssql.ConnectionPool,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<number[]> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const lock = await new sql.Request(tx).query<{ result: number }>(
      `DECLARE @result int;
      EXEC @result = sp_getapplock @Resource = N'hh:migrations', @LockMode = N'Exclusive',
        @LockOwner = N'Transaction', @LockTimeout = 60000;
      SELECT @result AS result;`,
    );
    if ((lock.recordset[0]?.result ?? -1) < 0) throw new Error("Could not get the migration lock.");

    for (const batch of BOOTSTRAP) await new sql.Request(tx).batch(batch);
    const applied = await new sql.Request(tx).query<{ version: number; checksum: string }>(
      "SELECT version, checksum FROM hh.schema_migrations ORDER BY version",
    );
    const known = new Map(migrations.map((m) => [m.version, m]));
    for (const row of applied.recordset) {
      const m = known.get(row.version);
      if (!m) {
        throw new Error(`The database has migration ${row.version}, which this app version does not know.`);
      }
      if (checksum(m) !== row.checksum) {
        throw new Error(`Migration ${row.version} (${m.name}) was changed after it was applied.`);
      }
    }

    const done = new Set(applied.recordset.map((r) => r.version));
    const pending = migrations.filter((m) => !done.has(m.version));
    for (const m of pending) {
      for (const batch of m.batches) await new sql.Request(tx).batch(batch);
      await new sql.Request(tx)
        .input("version", sql.Int, m.version)
        .input("name", sql.NVarChar(200), m.name)
        .input("checksum", sql.Char(64), checksum(m))
        .query(
          "INSERT INTO hh.schema_migrations (version, name, checksum) VALUES (@version, @name, @checksum)",
        );
    }
    await tx.commit();
    return pending.map((m) => m.version);
  } catch (err) {
    await rollbackQuietly(tx);
    throw err;
  }
}

/** Schema version of the database; 0 if it was never migrated. */
export async function schemaVersion(pool: Mssql.ConnectionPool): Promise<number> {
  const r = await pool.request().query<{ version: number }>(
    `IF OBJECT_ID(N'hh.schema_migrations', N'U') IS NULL SELECT 0 AS version
    ELSE SELECT ISNULL(MAX(version), 0) AS version FROM hh.schema_migrations;`,
  );
  return r.recordset[0]?.version ?? 0;
}

/**
 * Refuses to run against an older schema. A newer schema is fine: migrations
 * are expand-only, so the previous version keeps working during a rollout.
 */
export async function assertSchema(pool: Mssql.ConnectionPool): Promise<number> {
  const version = await schemaVersion(pool);
  if (version < SCHEMA_VERSION) {
    throw new Error(
      `The database schema is at version ${version}, this app needs ${SCHEMA_VERSION}. Run the migration first (npm run migrate).`,
    );
  }
  return version;
}

/**
 * Gives a database user the app role hh_app. With `clientId`, first creates the
 * user for an Entra ID managed identity (Azure SQL only). The SID is derived
 * from the client ID, so the server needs no permission to read the directory.
 */
export async function grantAppAccess(
  pool: Mssql.ConnectionPool,
  user: { name: string; clientId?: string | undefined },
): Promise<void> {
  await pool
    .request()
    .input("name", sql.NVarChar(128), user.name)
    .input("clientId", sql.UniqueIdentifier, user.clientId ?? null)
    .query(
      `IF DATABASE_PRINCIPAL_ID(@name) IS NULL AND @clientId IS NULL
        THROW 50001, N'The database user does not exist.', 1;
      IF DATABASE_PRINCIPAL_ID(@name) IS NULL
      BEGIN
        DECLARE @sid nvarchar(64) = CONVERT(nvarchar(64), CONVERT(varbinary(16), @clientId), 1);
        DECLARE @create nvarchar(400) = N'CREATE USER ' + QUOTENAME(@name) + N' WITH SID = ' + @sid + N', TYPE = E;';
        EXEC sp_executesql @create;
      END;
      IF ISNULL(IS_ROLEMEMBER(N'hh_app', @name), 0) = 0
      BEGIN
        DECLARE @add nvarchar(400) = N'ALTER ROLE hh_app ADD MEMBER ' + QUOTENAME(@name) + N';';
        EXEC sp_executesql @add;
      END;`,
    );
}

export async function rollbackQuietly(tx: Mssql.Transaction): Promise<void> {
  try {
    await tx.rollback();
  } catch {
    // Already rolled back by the server (for example after a deadlock) or never begun.
  }
}
