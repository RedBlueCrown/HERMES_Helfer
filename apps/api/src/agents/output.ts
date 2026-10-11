// What the agents' answers must fit before anyone sees them. A model sometimes
// writes a little too much or renames a heading; one such slip must not waste
// a paid call or produce a draft the form cannot submit (review F7).

import type { DraftContent, Finding } from "@hermes-helfer/core";
import { z } from "zod";

/** The longest section body the API accepts in a draft (routes.ts) and asks of the model. */
export const SECTION_MAX = 30_000;

/** `s` cut to `max` characters, marked with an ellipsis; never splits a character. */
export function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  let t = s.slice(0, max - 1);
  if (/[\uD800-\uDBFF]$/.test(t)) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** A string of the model's answer: over-long text is cut, not refused. */
export const clampedText = (max: number) => z.string().transform((s) => cut(s, max));

/** A list of the model's answer: surplus items are dropped, not refused. */
export const clampedList = <T extends z.ZodType>(item: T, max: number) =>
  z.array(item).transform((items) => items.slice(0, max));

const norm = (heading: string) => heading.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The draft in the template's sections and order, whatever headings the model
 * used: the same heading (ignoring case and spaces) first, then one that starts
 * like a template heading («Begründung» for «Begründung und Nutzen»). Text under
 * any other heading moves to the section before it, under its own heading, and
 * a hint says so: nothing the model wrote is lost, and every section is one
 * field with a heading. Without a template, sections keep their order; empty
 * headings get a name and repeated ones are merged.
 */
export function fitSections(
  draft: DraftContent,
  template: readonly string[],
): { draft: DraftContent; findings: Finding[] } {
  const findings: Finding[] = [];
  const named = (heading: string, n: number) =>
    heading.trim() || (template.length ? "" : `Abschnitt ${n + 1}`);
  const headings = [...template];
  if (!template.length) {
    for (const [n, section] of draft.sections.entries()) {
      const heading = named(section.heading, n);
      if (!headings.some((h) => norm(h) === norm(heading))) headings.push(heading);
    }
  }
  const bodies = headings.map(() => [] as string[]);
  const used = new Set<number>();
  let previous = 0;
  for (const [n, section] of draft.sections.entries()) {
    const heading = norm(named(section.heading, n));
    const body = section.body.trim();
    let i = headings.findIndex((t) => norm(t) === heading);
    if (i < 0 && heading.length >= 4) {
      i = headings.findIndex(
        (t, j) => !used.has(j) && (norm(t).startsWith(heading) || heading.startsWith(norm(t))),
      );
    }
    if (i >= 0) {
      if (body) bodies[i]!.push(body);
      used.add(i);
      previous = i;
      continue;
    }
    if (!body) continue;
    const label = section.heading.trim();
    bodies[previous]!.push(label ? `${label}:\n${body}` : body);
    findings.push({
      severity: "hinweis",
      source: "checkliste",
      text: `Der Agent hat einen Abschnitt «${label || "ohne Titel"}» geschrieben, der nicht zur Vorlage gehört; der Text steht unter «${headings[previous]}».`,
    });
  }
  const sections = headings.map((heading, i) => {
    // Sections joined from several parts can outgrow the limit each part kept.
    const body = bodies[i]!.join("\n\n");
    if (body.length <= SECTION_MAX) return { heading, body };
    findings.push({
      severity: "hinweis",
      source: "checkliste",
      text: `Der Abschnitt «${heading}» war zu lang und wurde gekürzt; bitte das Ende prüfen.`,
    });
    return { heading, body: cut(body, SECTION_MAX) };
  });
  return { draft: { ...draft, sections }, findings };
}
