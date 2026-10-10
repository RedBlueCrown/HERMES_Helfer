import type { TokenCredential } from "@azure/identity";
import { sql, type Mssql } from "./mssql";

export interface SqlSettings {
  server: string;
  port: number;
  database: string;
  /** entra: Entra ID token (managed identity in Azure). password: local and CI containers only. */
  auth: { kind: "entra"; credential: TokenCredential } | { kind: "password"; user: string; password: string };
  /** Only for local containers with a self-signed certificate. */
  trustServerCertificate: boolean;
}

/** Opens a connection pool. The connection is always encrypted. */
export async function connectSql(
  s: SqlSettings,
  onError: (err: Error) => void,
): Promise<Mssql.ConnectionPool> {
  const pool = new sql.ConnectionPool({
    server: s.server,
    port: s.port,
    database: s.database,
    authentication:
      s.auth.kind === "entra"
        ? { type: "token-credential", options: { credential: s.auth.credential } }
        : { type: "default", options: { userName: s.auth.user, password: s.auth.password } },
    options: {
      encrypt: true,
      trustServerCertificate: s.trustServerCertificate,
      appName: "hermes-helfer-api",
    },
    pool: { min: 0, max: 10, idleTimeoutMillis: 30_000 },
    connectionTimeout: 15_000,
    requestTimeout: 30_000,
  });
  // Without a listener, an error on an idle connection would crash the process.
  pool.on("error", onError);
  await pool.connect();
  return pool;
}
