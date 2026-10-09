import type { Check } from "@hermes-helfer/core";
import { z } from "zod";

/** An error with a status code and a German message that may be shown to the user. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (message = "Nicht gefunden.") => new HttpError(404, "not_found", message);
export const unprocessable = (message: string) => new HttpError(422, "validation", message);

/** Turns a failed permission or state check into an HTTP error (403 or 409). */
export function assertCheck(check: Check): void {
  if (check.ok) return;
  throw check.code === "forbidden"
    ? new HttpError(403, "forbidden", check.reason)
    : new HttpError(409, "invalid_state", check.reason);
}

/** Parses input with a zod schema; the first issue becomes a 422 with a readable message. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
  throw unprocessable(`Ungültige Eingabe${where}: ${issue?.message ?? "unbekannter Fehler"}`);
}
