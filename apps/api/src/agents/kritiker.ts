// Agent A11 "Kritiker": every draft is checked before a person sees it.
// Part 1 is deterministic (structure against the expected sections, rules for
// change requests); part 2 is the model's content review (provider.critique).

import {
  AMPEL_LABELS,
  CR_FLAGS,
  CR_FLAG_LABELS,
  CR_SECTIONS,
  STATUS_CRITERIA,
  type Ampel,
  type CrFlag,
  type CrFlags,
  type DeliverableDef,
  type DraftContent,
  type Finding,
  type SkillDef,
  type StatusCriterion,
  type StatusReportTexts,
} from "@hermes-helfer/core";
import type { CritiqueRequest } from "./provider";

const OPEN_MARKER = /\[OFFEN/;

/** `short`: sections whose answer is a short value by nature (table cells of a template). */
export function checkDraftStructure(
  sections: readonly string[],
  draft: DraftContent,
  short: readonly string[] = [],
): Finding[] {
  const findings: Finding[] = [];
  const byHeading = new Map(draft.sections.map((s) => [s.heading.trim().toLowerCase(), s]));
  for (const heading of sections) {
    const section = byHeading.get(heading.toLowerCase());
    // An empty section counts as missing (output.ts fits drafts into all sections).
    if (!section?.body.trim()) {
      findings.push({ severity: "warnung", source: "checkliste", text: `Abschnitt «${heading}» fehlt.` });
    } else if (section.body.trim().length < 40 && !short.includes(heading)) {
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

/** Areas the agent saw as touched and the requester cleared; the decider sees it (personal data: a warning). */
export function checkClearedFlags(
  agent: Record<CrFlag, { value: boolean; reason: string }>,
  flags: CrFlags,
): Finding[] {
  return CR_FLAGS.filter((f) => agent[f].value && !flags[f]).map((f) => ({
    severity: f === "daten" ? "warnung" : "hinweis",
    source: "checkliste",
    text: `Der Agent sah «${CR_FLAG_LABELS[f].label}» als betroffen (${agent[f].reason}); bei der Einreichung abgewählt.`,
  }));
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

/** The texts of a status report: overview, outlook, problem and measure per criterion. */
/** A status report as a document for the Kritiker: one section per text. */
export function statusReportDocument(texts: StatusReportTexts, colours: Record<StatusCriterion, Ampel>) {
  const notGreen = STATUS_CRITERIA.filter((c) => colours[c.id] !== "gruen");
  const sections = [
    { heading: "Übersicht und Prognose", body: texts.overview },
    { heading: "Ausblick", body: texts.outlook },
    ...notGreen.map((c) => ({
      heading: `${c.label} (${AMPEL_LABELS[colours[c.id]].label})`,
      body: `Problem: ${texts.criteria[c.id]?.problem ?? ""}\nMassnahme: ${texts.criteria[c.id]?.measure ?? ""}`,
    })),
  ];
  const draft: DraftContent = { summary: texts.overview, sections, openPoints: [] };
  return { draft, headings: sections.map((x) => x.heading) };
}

/** Deterministic checks of a status report draft. */
export function checkStatusReport(
  texts: StatusReportTexts,
  colours: Record<StatusCriterion, Ampel>,
): Finding[] {
  const findings: Finding[] = [];
  for (const c of STATUS_CRITERIA) {
    if (colours[c.id] === "gruen") continue;
    const e = texts.criteria[c.id];
    if (!e?.problem.trim() || !e.measure.trim()) {
      findings.push({
        severity: "warnung",
        source: "checkliste",
        text: `«${c.label}» ist ${AMPEL_LABELS[colours[c.id]].label}: Problem und Massnahme sind nötig.`,
      });
    }
  }
  const { draft } = statusReportDocument(texts, colours);
  const open = draft.sections.filter((x) => OPEN_MARKER.test(x.body)).length;
  if (open) {
    findings.push({
      severity: "hinweis",
      source: "checkliste",
      text: `${open === 1 ? "1 Text enthält" : `${open} Texte enthalten`} noch offene Angaben ([OFFEN]).`,
    });
  }
  return findings;
}

/** What the Kritiker reviews in a status report. */
export function statusReportCritique(
  texts: StatusReportTexts,
  colours: Record<StatusCriterion, Ampel>,
  background: readonly { name: string; summary: string }[],
): CritiqueRequest {
  const { draft, headings } = statusReportDocument(texts, colours);
  return {
    key: "statusbericht",
    document: "Statusbericht",
    sections: headings,
    results: [],
    draft,
    focus: [
      "Widersprüche zwischen Ampel und Text, zum Beispiel ein rotes Kriterium, das im Text unproblematisch klingt",
      "Massnahmen ohne verantwortliche Person oder ohne Termin",
      "Aussagen, die die Fakten nicht stützen",
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
