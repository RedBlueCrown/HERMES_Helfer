// Runs only with a SQL Server 2022+ (CI starts one as a service container):
//   TEST_SQL_SERVER=localhost TEST_SQL_PASSWORD=<sa password> npm test -w apps/api

import { MODEL } from "@hermes-helfer/core";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProjectRepository } from "../src/projects/repository";
import { connectSql, type SqlSettings } from "../src/store/sql/connection";
import {
  MIGRATIONS,
  SCHEMA_VERSION,
  assertSchema,
  grantAppAccess,
  migrate,
  schemaVersion,
} from "../src/store/sql/migrations";
import { sql, type Mssql } from "../src/store/sql/mssql";
import { SqlEventStore, isTransientSqlError } from "../src/store/sql/sql-event-store";
import { ACTOR, created, eventStoreContract, released, sharedStoreContract } from "./store-contract";

const server = process.env.TEST_SQL_SERVER;
const noop = () => undefined;

describe.skipIf(!server)("SQL event store on SQL Server", () => {
  const db = `hh_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const appUser = `${db}_app`;
  const appPassword = `Aa1!${randomBytes(18).toString("base64url")}`;
  const settings = (database: string, auth?: { user: string; password: string }): SqlSettings => ({
    server: server!,
    port: Number(process.env.TEST_SQL_PORT ?? 1433),
    database,
    auth: {
      kind: "password",
      user: auth?.user ?? process.env.TEST_SQL_USER ?? "sa",
      password: auth?.password ?? process.env.TEST_SQL_PASSWORD ?? "",
    },
    trustServerCertificate: true,
  });

  let admin: Mssql.ConnectionPool;
  let owner: Mssql.ConnectionPool;
  let app: Mssql.ConnectionPool;
  let store: SqlEventStore;
  let versionBefore: number;
  let applied: number[];

  beforeAll(async () => {
    admin = await connectSql(settings("master"), noop);
    await admin.request().batch(`CREATE DATABASE [${db}];`);
    // Azure SQL defaults: row versioning, which the ledger verification needs too.
    await admin
      .request()
      .batch(
        `ALTER DATABASE [${db}] SET ALLOW_SNAPSHOT_ISOLATION ON; ALTER DATABASE [${db}] SET READ_COMMITTED_SNAPSHOT ON;`,
      );
    owner = await connectSql(settings(db), noop);
    versionBefore = await schemaVersion(owner);
    applied = await migrate(owner);

    await admin
      .request()
      .batch(`CREATE LOGIN [${appUser}] WITH PASSWORD = N'${appPassword}', CHECK_POLICY = OFF;`);
    await owner.request().batch(`CREATE USER [${appUser}] FOR LOGIN [${appUser}];`);
    await grantAppAccess(owner, { name: appUser });
    await grantAppAccess(owner, { name: appUser }); // idempotent
    app = await connectSql(settings(db, { user: appUser, password: appPassword }), noop);
    store = new SqlEventStore(app, { backoffMs: () => 1 });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await owner?.close();
    if (admin) {
      await admin
        .request()
        .batch(
          `ALTER DATABASE [${db}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${db}]; DROP LOGIN [${appUser}];`,
        );
      await admin.close();
    }
  }, 60_000);

  describe("as the app's database user (role hh_app)", () => {
    eventStoreContract(() => store);
    sharedStoreContract(() => store);

    it("reads the schema version and answers the readiness probe", async () => {
      expect(await assertSchema(app)).toBe(SCHEMA_VERSION);
      await expect(store.ping()).resolves.toBeUndefined();
    });

    it("cannot change or delete events, move heads back or change the schema", async () => {
      await new ProjectRepository(store, MODEL).append("p-perm", 0, [created()], ACTOR, "c");
      // The ledger refuses changes to events before permissions are even checked.
      const refused: [string, RegExp][] = [
        ["UPDATE hh.events SET event_type = 'X' WHERE project_id = 'p-perm'", /ledger|permission/i],
        ["DELETE FROM hh.events WHERE project_id = 'p-perm'", /ledger|permission/i],
        ["DELETE FROM hh.streams WHERE project_id = 'p-perm'", /permission/i],
        ["CREATE TABLE hh.x (id int)", /permission/i],
        ["DROP TABLE hh.events", /permission/i],
        ["INSERT INTO hh.schema_migrations (version, name, checksum) VALUES (99, 'x', 'x')", /permission/i],
      ];
      for (const [statement, message] of refused) {
        await expect(app.request().query(statement), statement).rejects.toThrow(message);
      }
    });
  });

  describe("as the database owner", () => {
    it("migrated the empty database to the current schema", () => {
      expect(versionBefore).toBe(0);
      expect(applied).toEqual(MIGRATIONS.map((m) => m.version));
    });

    it("cannot change or delete events either: the ledger table is append-only", async () => {
      await store.append({
        projectId: "p-ledger",
        expectedSeq: 0,
        events: [created()],
        actor: ACTOR,
        correlationId: "c",
      });
      await expect(
        owner.request().query("UPDATE hh.events SET event_type = 'X' WHERE project_id = 'p-ledger'"),
      ).rejects.toThrow(/ledger/i);
      await expect(
        owner.request().query("DELETE FROM hh.events WHERE project_id = 'p-ledger'"),
      ).rejects.toThrow(/ledger/i);
      expect(await store.read("p-ledger")).toHaveLength(1);
    });

    it("verifies the database ledger against a digest", async () => {
      await store.append({
        projectId: "p-digest",
        expectedSeq: 0,
        events: [created()],
        actor: ACTOR,
        correlationId: "c",
      });
      const digest = await owner
        .request()
        .query<{ latest_digest: string }>("EXECUTE sys.sp_generate_database_ledger_digest");
      const json = digest.recordset[0]?.latest_digest;
      expect(json).toContain("block_id");
      await expect(
        owner
          .request()
          .input("digests", sql.NVarChar(sql.MAX), `[${json}]`)
          .query("EXECUTE sys.sp_verify_database_ledger @digests"),
      ).resolves.toBeDefined();
    });

    it("grants the app role only to existing users unless a client ID is given", async () => {
      await expect(grantAppAccess(owner, { name: "nobody_here" })).rejects.toThrow(/does not exist/);
    });

    it("runs migrations once and refuses a migration that changed after it ran", async () => {
      expect(await migrate(owner)).toEqual([]);
      const changed = MIGRATIONS.map((m) =>
        m.version === 1 ? { ...m, batches: [...m.batches, "SELECT 1;"] } : m,
      );
      await expect(migrate(owner, changed)).rejects.toThrow(/changed after it was applied/);
      await expect(migrate(owner, [])).rejects.toThrow(/does not know/);
      expect(await schemaVersion(owner)).toBe(SCHEMA_VERSION);
    });

    it("stores the complete event as JSON next to its query columns", async () => {
      await new ProjectRepository(store, MODEL).append("p-body", 0, [created(), released()], ACTOR, "c-body");
      const rows = await owner.request().query<{
        seq: number;
        event_type: string;
        actor_id: string;
        correlation_id: string;
        prev_hash: string;
        hash: string;
        body: string;
      }>("SELECT seq, event_type, actor_id, correlation_id, prev_hash, hash, body FROM hh.events WHERE project_id = 'p-body' ORDER BY seq");
      expect(rows.recordset).toHaveLength(2);
      for (const row of rows.recordset) {
        const body = JSON.parse(row.body);
        expect(body).toMatchObject({
          projectId: "p-body",
          seq: row.seq,
          type: row.event_type,
          correlationId: row.correlation_id,
          prevHash: row.prev_hash,
          hash: row.hash,
        });
        expect(row.actor_id).toBe(ACTOR.userId);
      }
      const head = await owner
        .request()
        .query<{ last_seq: number; last_hash: string }>(
          "SELECT last_seq, last_hash FROM hh.streams WHERE project_id = 'p-body'",
        );
      expect(head.recordset[0]).toEqual({ last_seq: 2, last_hash: rows.recordset[1]!.hash });
    });
  });
});

describe("SQL error classification", () => {
  it("classifies transient errors", () => {
    expect(isTransientSqlError({ number: 40613 })).toBe(true);
    expect(isTransientSqlError({ code: "ESOCKET" })).toBe(true);
    expect(isTransientSqlError({ originalError: { info: { number: 1205 } } })).toBe(true);
    expect(isTransientSqlError({ number: 2627 })).toBe(false);
  });
});
