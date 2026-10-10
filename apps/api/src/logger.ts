import { createRequire } from "node:module";
import type * as Pino from "pino";
import type { Logger } from "pino";
import type { Config } from "./config";

// pino is CommonJS. Loading it through require lets the OpenTelemetry pino
// instrumentation add trace ids to the log lines (telemetry.ts).
const { pino } = createRequire(import.meta.url)("pino") as typeof Pino;

/** One JSON logger for the process. Never logs tokens, cookies or passwords. */
export function createLogger(config: Pick<Config, "LOG_LEVEL">): Logger {
  return pino({
    level: config.LOG_LEVEL,
    redact: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.SQL_PASSWORD"],
  });
}

export type { Logger };
