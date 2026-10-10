import { pino, type Logger } from "pino";
import type { Config } from "./config";

/** One JSON logger for the process. Never logs tokens, cookies or passwords. */
export function createLogger(config: Pick<Config, "LOG_LEVEL">): Logger {
  return pino({
    level: config.LOG_LEVEL,
    redact: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.SQL_PASSWORD"],
  });
}

export type { Logger };
