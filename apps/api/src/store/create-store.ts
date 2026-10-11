import type { TokenCredential } from "@azure/identity";
import type { Config } from "../config";
import { MemoryTemplateStore, type TemplateStore } from "../documents/template-store";
import type { Logger } from "../logger";
import type { EventStore } from "./event-store";
import { MemoryEventStore } from "./memory-event-store";
import { connectSql, type SqlSettings } from "./sql/connection";
import { assertSchema, migrate } from "./sql/migrations";
import { SqlEventStore } from "./sql/sql-event-store";
import { SqlTemplateStore } from "./sql/sql-template-store";

export type SqlConfig = Pick<
  Config,
  | "SQL_SERVER"
  | "SQL_PORT"
  | "SQL_DATABASE"
  | "SQL_AUTH"
  | "SQL_USER"
  | "SQL_PASSWORD"
  | "SQL_TRUST_SERVER_CERTIFICATE"
>;

export async function sqlSettings(
  config: SqlConfig,
  credential: () => Promise<TokenCredential>,
): Promise<SqlSettings> {
  return {
    server: config.SQL_SERVER!,
    port: config.SQL_PORT,
    database: config.SQL_DATABASE!,
    auth:
      config.SQL_AUTH === "entra"
        ? { kind: "entra", credential: await credential() }
        : { kind: "password", user: config.SQL_USER!, password: config.SQL_PASSWORD! },
    trustServerCertificate: config.SQL_TRUST_SERVER_CERTIFICATE,
  };
}

export interface Stores {
  events: EventStore;
  /** The organisation's Word templates (documents/template-store.ts). */
  templates: TemplateStore;
}

/** The stores from the configuration. Checks the database schema before use. */
export async function createStores(
  config: Config,
  log: Logger,
  credential: () => Promise<TokenCredential>,
): Promise<Stores> {
  if (config.STORE === "memory") {
    const files = config.DATA_DIR ? { dataDir: config.DATA_DIR } : {};
    return { events: new MemoryEventStore(files), templates: new MemoryTemplateStore(files) };
  }
  const pool = await connectSql(await sqlSettings(config, credential), (err) =>
    log.error({ err }, "sql connection error"),
  );
  if (config.SQL_MIGRATE_ON_START) {
    const applied = await migrate(pool);
    if (applied.length) log.info({ applied }, "applied database migrations");
  }
  const version = await assertSchema(pool);
  log.info({ store: "sql", schemaVersion: version }, "event store ready");
  return { events: new SqlEventStore(pool), templates: new SqlTemplateStore(pool) };
}
