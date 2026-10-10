// Migration job: applies pending database migrations and gives the app's
// identity the role hh_app. It runs with an identity that may change the
// schema (in Azure a Container Apps job with its own managed identity), never
// with the identity of the running app.
//
//   node dist/migrate.js
//
// Environment: the SQL_* settings of the API, plus APP_DB_USER (name of the
// app's database user) and APP_DB_USER_CLIENT_ID (client ID of the app's
// managed identity; creates the user in Azure SQL if it does not exist yet).

import { z } from "zod";
import { createLogger } from "./logger";
import { sqlSettings } from "./store/create-store";
import { connectSql } from "./store/sql/connection";
import { grantAppAccess, migrate, schemaVersion } from "./store/sql/migrations";
import { azureCredential } from "./util/azure-credential";

const env = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    AZURE_CLIENT_ID: z.string().optional(),
    SQL_SERVER: z.string().min(1),
    SQL_PORT: z.coerce.number().int().min(1).max(65535).default(1433),
    SQL_DATABASE: z.string().min(1),
    SQL_AUTH: z.enum(["entra", "password"]).default("entra"),
    SQL_USER: z.string().optional(),
    SQL_PASSWORD: z.string().optional(),
    SQL_TRUST_SERVER_CERTIFICATE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    APP_DB_USER: z.string().min(1).max(128).optional(),
    APP_DB_USER_CLIENT_ID: z.uuid().optional(),
  })
  .parse(process.env);

const log = createLogger(env);
if (env.NODE_ENV === "production" && (env.SQL_AUTH !== "entra" || env.SQL_TRUST_SERVER_CERTIFICATE)) {
  throw new Error("In production the migration job connects with Entra ID and a verified certificate.");
}

const pool = await connectSql(
  await sqlSettings(env, () =>
    azureCredential({ managedIdentityOnly: env.NODE_ENV === "production", clientId: env.AZURE_CLIENT_ID }),
  ),
  (err) => log.error({ err }, "sql connection error"),
);
try {
  const before = await schemaVersion(pool);
  const applied = await migrate(pool);
  log.info({ before, applied, after: await schemaVersion(pool) }, "database migrated");
  if (env.APP_DB_USER) {
    await grantAppAccess(pool, { name: env.APP_DB_USER, clientId: env.APP_DB_USER_CLIENT_ID });
    log.info({ user: env.APP_DB_USER }, "app identity has role hh_app");
  }
} finally {
  await pool.close();
}
