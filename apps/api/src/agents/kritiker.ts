// Agent A11 "Kritiker": every draft is checked before a person sees it.
// Part 1 is deterministic (structure against the expected sections, rules for
// change requests); part 2 is the model's content review (provider.critique).

import {
  CR_SECTIONS,
  type CrFlags,
  type DeliverableDef,
  type DraftContent,
  type Finding,
  type SkillDef,
} from "@hermes-helfer/core";
import type { CritiqueRequest } from "./provider";

const OPEN_MARKER = /\[OFFEN/;

export function checkDraftStructure(sections: readonly string[], draft: DraftContent): Finding[] {
  const findings: Finding[] = [];
  const byHeading = new Map(draft.sections.map((s) => [s.heading.trim().toLowerCase(), s]));
  for (const heading of sections) {
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

/** What the Kritiker reviews in the draft of a skill. */
export function skillCritique(
  skill: SkillDef,
  deliverables: readonly DeliverableDef[],
  draft: DraftContent,
): CritiqueRequest {
  return {
    key: skill.id,
    document: skill.outputDoc,
    sections: skill.sections,
    results: deliverables.map((d) => d.name),
    draft,
  };
}

/** Deterministic checks of a change request (prototype: crNote). */
export function checkChangeRequest(content: DraftContent, flags: CrFlags): Finding[] {
  const findings = checkDraftStructure(CR_SECTIONS, content);
  if (flags.sonderloesung) {
    findings.push({
      severity: "hinweis",
      source: "checkliste",
      text: "Abweichung vom Standardprodukt: Das erhöht den Aufwand bei jedem Release. Zuerst prüfen, ob sich der Ablauf vereinfachen lässt.",
    });
  }
  return findings;
}

/** What the Kritiker reviews in a change request. */
export function changeRequestCritique(
  content: DraftContent,
  background: readonly { name: string; summary: string }[],
): CritiqueRequest {
  return {
    key: "change-request",
    document: "Change Request",
    sections: CR_SECTIONS,
    results: [],
    draft: content,
    focus: [
      "Widersprüche zu früheren Entscheiden des Vorhabens, zum Beispiel zum Variantenentscheid oder zum Pflichtenheft",
      "Sonderlösungen, wo eine Vereinfachung des Ablaufs genügen würde",
      "Nutzen ohne Beleg oder ohne betroffene Personengruppe",
    ],
    background,
  };
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
