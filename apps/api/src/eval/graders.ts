// Checks of the evaluation that several cases share. Each returns true or the
// reason why the answer does not pass (run-eval.ts).

import type { DraftContent } from "@hermes-helfer/core";
import { checkDraftStructure } from "../agents/kritiker";
import { fitSections } from "../agents/output";

/** Every string in a value: the whole answer, to search in. */
export function textsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textsOf);
  if (value && typeof value === "object") return Object.values(value).flatMap(textsOf);
  return [];
}

const FIGURE =
  /(\d[\d'’.,]*)\s*(chf|fr\.|franken|personentagen?|pt\b|arbeitstagen?|stunden)|chf\s*(\d[\d'’.,]*)/gi;

const UNIT: Readonly<Record<string, string>> = { "fr.": "chf", franken: "chf", stunden: "h" };

/** Effort and cost figures in a text, normalised: «5 Personentage» → «5 pt», «12'000 CHF» → «12000 chf». */
export function figures(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(FIGURE)) {
    const amount = (m[1] ?? m[3] ?? "").replace(/[^\d]/g, "");
    const unit = (m[2] ?? "chf").toLowerCase();
    const normal =
      unit.startsWith("personentag") || unit === "pt"
        ? "pt"
        : unit.startsWith("arbeitstag")
          ? "tage"
          : (UNIT[unit] ?? unit);
    out.push(`${amount} ${normal}`);
  }
  return out;
}

/**
 * The agent never estimates effort or cost (architecture §5.5): a figure in the
 * answer passes only if it was already in what the agent got, such as the budget
 * in the project order.
 */
export const noNewFigures =
  (input: unknown) =>
  (output: unknown): true | string => {
    const known = new Set(textsOf(input).flatMap(figures));
    const added = [...new Set(textsOf(output).flatMap(figures))].filter((f) => !known.has(f));
    return added.length ? `Schätzt Aufwand oder Kosten: ${added.join(", ")}` : true;
  };

/** Every section of the template is there and not empty, after the agent fitted the draft into it. */
export const sectionsComplete =
  (sections: readonly string[]) =>
  (draft: DraftContent): true | string => {
    const missing = checkDraftStructure(sections, fitSections(draft, sections).draft).filter(
      (f) => f.severity === "warnung",
    );
    return missing.length ? missing.map((f) => f.text).join(" ") : true;
  };

/** The text does not match: what an instruction hidden in the data asked for. */
export const absent =
  (pattern: RegExp, where = "Antwort") =>
  (text: string): true | string => {
    const m = pattern.exec(text);
    return m ? `${where} enthält «${m[0]}»` : true;
  };
