// Knowledge across projects for the Wissen agent (A13): passages of what a
// person may read, and a search over them. Need-to-know first: only the
// projects the person sees, released results only where the person may read
// their content, and nothing that would show a confidential result. The agent
// answers from the passages found here and names them; the search itself is
// deterministic, so the same question finds the same passages.

import type { HermesModel } from "../model";
import { PROJECT_ROLE_LABELS } from "../model/roles";
import { formatDay, minutesLabel } from "./minutes";
import type { PhaseId } from "../model/types";
import { canViewProject, canViewSkillContent, type Viewer } from "./permissions";
import { riskLabel } from "./risks";
import type { ProjectState } from "./state";
import { deliverableStatus } from "./status";

export type PassageKind = "ergebnis" | "entscheid" | "pendenz" | "frage" | "risiko" | "rollen" | "gate";

export const PASSAGE_KIND_LABELS: Readonly<Record<PassageKind, string>> = {
  ergebnis: "Ergebnis",
  entscheid: "Entscheid",
  pendenz: "Pendenz",
  frage: "Offene Frage",
  risiko: "Risiko",
  rollen: "Rollen",
  gate: "Gate-Entscheid",
};

export interface Passage {
  /** Stable within the project: the kind and what it belongs to. */
  key: string;
  projectCode: string;
  projectName: string;
  kind: PassageKind;
  /** «Projektauftrag › Ausgangslage», «P-02 Projektsitzung vom 14.10.2026» … */
  title: string;
  text: string;
  /** For a result: the deliverable, to open it. */
  deliverableId?: string;
}

/** Characters of one passage: a section is split into parts of about this size. */
export const PASSAGE_MAX = 900;
/** Passages the agent gets for one question. */
export const KNOWLEDGE_TOP = 8;
/** Characters of a question. */
export const QUESTION_MAX = 500;

/** A long text in parts at paragraph or sentence ends, each at most `max` characters. */
export function chunks(text: string, max = PASSAGE_MAX): string[] {
  const parts: string[] = [];
  let current = "";
  const pieces = text
    .split(/\n\s*\n|(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const piece of pieces) {
    for (let i = 0; i < piece.length; i += max) {
      const bit = piece.slice(i, i + max);
      if (current && current.length + bit.length + 1 > max) {
        parts.push(current);
        current = "";
      }
      current = current ? `${current} ${bit}` : bit;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** Everything of the projects the person may read, as passages. */
export function knowledgePassages(
  projects: readonly ProjectState[],
  model: HermesModel,
  v: Viewer,
): Passage[] {
  const out: Passage[] = [];
  for (const s of projects) {
    if (!canViewProject(s, v)) continue;
    const base = { projectCode: s.code, projectName: s.name };
    const add = (p: Omit<Passage, "projectCode" | "projectName">) => out.push({ ...base, ...p });

    // Released results whose content the person may read (need-to-know).
    for (const ph of model.phases) {
      for (const d of ph.deliverables) {
        if (deliverableStatus(s, model, d) !== "done") continue;
        for (const sid of d.skills) {
          const skill = model.skill(sid);
          const draft = s.skills[sid]?.output?.draft;
          if (!draft || !canViewSkillContent(s, model, v, skill)) continue;
          const doc = skill.outputDoc;
          if (draft.summary.trim()) {
            add({
              key: `${sid}:summary`,
              kind: "ergebnis",
              title: `${doc} › Zusammenfassung`,
              text: draft.summary,
              deliverableId: d.id,
            });
          }
          draft.sections.forEach((section, n) =>
            chunks(section.body).forEach((text, i) =>
              add({
                key: `${sid}:${n}:${i}`,
                kind: "ergebnis",
                title: `${doc} › ${section.heading}`,
                text,
                deliverableId: d.id,
              }),
            ),
          );
        }
      }
    }

    for (const m of Object.values(s.minutes)) {
      const of = `${minutesLabel(m.number)} «${m.title}» vom ${formatDay(m.heldOn)}`;
      for (const x of m.decisions)
        add({ key: `${m.id}:${x.id}`, kind: "entscheid", title: of, text: x.text });
      for (const x of m.actions) {
        const who = x.ownerName ? `, verantwortlich ${x.ownerName}` : "";
        const due = x.due ? `, bis ${formatDay(x.due)}` : "";
        const state = x.doneAt ? " (erledigt)" : "";
        add({ key: `${m.id}:${x.id}`, kind: "pendenz", title: of, text: `${x.text}${who}${due}${state}` });
      }
      for (const x of m.questions) add({ key: `${m.id}:${x.id}`, kind: "frage", title: of, text: x.text });
    }

    for (const r of Object.values(s.risks)) {
      add({
        key: r.id,
        kind: "risiko",
        title: `${riskLabel(r.number)} ${r.title}`,
        text: [
          r.description,
          `Eintritt ${r.probability}, Auswirkung ${r.impact}, ${r.status}, verantwortlich ${PROJECT_ROLE_LABELS[r.ownerRole]}.`,
          r.mitigation ? `Massnahme: ${r.mitigation}` : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
    }

    for (const [phase, decisions] of Object.entries(s.gateDecisions)) {
      const ph = model.phase(phase as PhaseId);
      for (const [i, g] of (decisions ?? []).entries()) {
        add({
          key: `gate:${phase}:${i}`,
          kind: "gate",
          title: `Gate «${ph.gate.name}» vom ${formatDay(g.at.slice(0, 10))}`,
          text: `${g.decision}${g.reason ? `: ${g.reason}` : "."}`,
        });
      }
    }

    // Who holds which role: one passage per project.
    const holders = Object.values(s.members)
      .flatMap((m) => m.roles.map((r) => `${PROJECT_ROLE_LABELS[r]}: ${m.displayName}`))
      .sort();
    if (holders.length)
      add({ key: "rollen", kind: "rollen", title: "Rollen im Vorhaben", text: `${holders.join("; ")}.` });
  }
  return out;
}

const STOP = new Set(
  (
    "aber alle allem allen alles also als am an auch auf aus bei beim bin bis bist da dabei dafur damit dann " +
    "das dass dem den der des dessen die dies diese diesem diesen dieser dieses doch dort du durch ein eine " +
    "einem einen einer eines er es etwa euch fur gab gibt hab habe haben hat hatte hier ich ihr im in ins " +
    "ist ja jede jedem jeden jeder jedes kann kein keine konnen man mehr mit muss nach nicht noch nun nur ob " +
    "oder ohne sein seine sich sie sind so soll sollte sowie uber um und uns unter vom von vor war waren " +
    "warum was weil welche welchem welchen welcher welches wem wen wenn wer werden wie wieder wir wird wo " +
    "wurde wurden zu zum zur zwischen gibts gemacht sagen sag bitte"
  ).split(" "),
);

/** Words of a text as the search compares them: lower case, without accents, stop words out. */
export function terms(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/**
 * Words of project work that mean the same: a question about «Erfahrungen» finds
 * «Lessons Learned». Keys and words as `terms` writes them; a key matches the
 * beginning of a word. The search in production understands meaning (todo-later H27).
 */
const SYNONYMS: ReadonlyArray<[string, string[]]> = [
  ["erfahrung", ["lessons", "learned"]],
  ["lessons", ["erfahrungen"]],
  ["beschluss", ["entscheid"]],
  ["beschlossen", ["entscheid"]],
  ["entscheid", ["beschluss"]],
  ["entschieden", ["entscheid", "beschluss"]],
  ["zustandig", ["verantwortlich", "rollen"]],
  ["verantwortlich", ["zustandig"]],
  ["projektleiter", ["projektleitung"]],
  ["aufgabe", ["pendenz"]],
  ["pendenz", ["aufgabe"]],
  ["risk", ["risiko"]],
];

function expand(query: readonly string[]): string[] {
  const out = new Set(query);
  for (const q of query)
    for (const [key, words] of SYNONYMS) if (q.startsWith(key)) words.forEach((w) => out.add(w));
  return [...out];
}

/** Two words match when one starts with the other (German compounds and endings), from 5 letters. */
function same(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return l.startsWith(s.length > 6 ? s.slice(0, -1) : s);
}

/**
 * The passages that answer the question best (BM25 over the passages' words,
 * with matching of word beginnings), at most `top`, and at most three of one
 * document, so that one long result does not fill the answer.
 */
export function searchPassages(
  passages: readonly Passage[],
  question: string,
  top = KNOWLEDGE_TOP,
): Passage[] {
  const query = expand([...new Set(terms(question))]);
  if (!query.length || !passages.length) return [];
  // The project's code and name count too: «… im CRM» favours that project.
  const docs = passages.map((p) => terms(`${p.projectCode} ${p.projectName} ${p.title} ${p.text}`));
  const avg = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1;
  const df = query.map((q) => docs.filter((d) => d.some((w) => same(w, q))).length);
  const k1 = 1.2;
  const b = 0.75;
  const scored = docs.map((d, i) => {
    let score = 0;
    query.forEach((q, j) => {
      const tf = d.filter((w) => same(w, q)).length;
      if (!tf) return;
      const idf = Math.log(1 + (docs.length - df[j]! + 0.5) / (df[j]! + 0.5));
      score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.length) / avg));
    });
    return { p: passages[i]!, score };
  });
  const perDoc = new Map<string, number>();
  const out: Passage[] = [];
  for (const x of scored.filter((y) => y.score > 0).sort((a, c) => c.score - a.score)) {
    const doc = `${x.p.projectCode}:${x.p.kind}:${x.p.title.split(" › ")[0]}`;
    const n = perDoc.get(doc) ?? 0;
    if (n >= 3) continue;
    perDoc.set(doc, n + 1);
    out.push(x.p);
    if (out.length === top) break;
  }
  return out;
}

/** A source of an answer, as the person sees it. */
export interface KnowledgeSource {
  /** Q1, Q2 …: as the answer names it. */
  id: string;
  projectCode: string;
  projectName: string;
  kind: PassageKind;
  title: string;
  excerpt: string;
  deliverableId?: string;
}

export interface KnowledgeAnswer {
  question: string;
  /** The passages answer the question; else the answer says that nothing was found. */
  found: boolean;
  /** With the sources as [Q1], [Q2] … */
  answer: string;
  /** The sources the answer names, in their order. */
  sources: KnowledgeSource[];
  /** How many projects and passages the search went through (what the person may read). */
  searched: { projects: number; passages: number };
  producer: { kind: "ai"; agent: "A13"; provider: string; model: string };
}

/** Projects the person may read, for the count in the answer. */
export const readableProjects = (projects: readonly ProjectState[], v: Viewer) =>
  projects.filter((s) => canViewProject(s, v));
