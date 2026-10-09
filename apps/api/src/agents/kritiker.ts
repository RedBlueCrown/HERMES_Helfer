// Agent A11 "Kritiker": every draft is checked before a person sees it.
// Part 1 is deterministic (structure against the skill's sections); part 2 is
// the model's content review (provider.critique).

import type { DraftContent, Finding, SkillDef } from "@hermes-helfer/core";

const OPEN_MARKER = /\[OFFEN/;

export function checkDraftStructure(skill: SkillDef, draft: DraftContent): Finding[] {
  const findings: Finding[] = [];
  const byHeading = new Map(draft.sections.map((s) => [s.heading.trim().toLowerCase(), s]));
  for (const heading of skill.sections) {
    const section = byHeading.get(heading.toLowerCase());
    if (!section) {
      findings.push({ severity: "warnung", source: "checkliste", text: `Abschnitt «${heading}» fehlt.` });
    } else if (section.body.trim().length < 40) {
      findings.push({
        severity: "hinweis",
        source: "checkliste",
        text: `Abschnitt «${heading}» ist sehr knapp.`,
      });
    }
  }
  const open = draft.sections.filter((s) => OPEN_MARKER.test(s.body)).length;
  if (open) {
    findings.push({
      severity: "hinweis",
      source: "checkliste",
      text: `${open === 1 ? "1 Abschnitt enthält" : `${open} Abschnitte enthalten`} noch offene Angaben ([OFFEN]).`,
    });
  }
  return findings;
}

export function mergeFindings(...lists: Finding[][]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of lists.flat()) {
    const key = f.text.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  // Warnings first.
  return out.sort((a, b) => Number(b.severity === "warnung") - Number(a.severity === "warnung"));
}
