// Meeting minutes (Protokolle): what a meeting decided, who does what by when
// (Pendenzen), and what stays open. The Protokoll agent (A9) proposes the items
// from notes or a transcript, each with a passage of the text as evidence; a
// person checks and accepts them. The engine keeps the accepted items, never
// the text itself, and puts open action items on their owners' task lists.

import { MIN_TITLE } from "./decisions";
import type { MinutesActionState, MinutesState, ProjectState } from "./state";

/** Items of one kind in one set of minutes. */
export const MINUTES_ITEMS_MAX = 30;
/** Characters of notes or a transcript the agent reads at once. */
export const MINUTES_TEXT_MAX = 60_000;
/** Characters of a quote: the passage an item rests on. */
export const QUOTE_MAX = 300;
/** Least characters of a quote, so that it names one passage. */
export const QUOTE_MIN = 8;
/** Characters of the text of an item. */
export const MINUTES_ITEM_MAX = 500;

export const minutesLabel = (n: number) => `P-${String(n).padStart(2, "0")}`;

export const nextMinutesNumber = (s: ProjectState) =>
  Object.values(s.minutes).reduce((n, m) => Math.max(n, m.number), 0) + 1;

/** A day as YYYY-MM-DD that exists in the calendar. */
export function isIsoDay(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  // An impossible day (2026-13-45) is no date at all; 2026-02-30 rolls over to March.
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().startsWith(d);
}

/** 2026-10-21 → 21.10.2026 */
export const formatDay = (d: string) =>
  isIsoDay(d) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : d;

/**
 * Text as a reader compares it: any run of whitespace one space, typographic
 * quotation marks, apostrophes and dashes plain, case ignored.
 */
export function normalizeText(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″«»‹›]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Whether `quote` is a passage of `text`: the agent's evidence for an item. Quotation
 * marks around the quote do not count; anything left out in the middle does.
 */
export function quoteInText(quote: string, text: string): boolean {
  const q = normalizeText(quote).replace(/^["' ]+|["' ]+$/g, "");
  return q.length >= QUOTE_MIN && normalizeText(text).includes(q);
}

/** The project member a name in the text means, if exactly one fits: «Anna», «Keller», «A. Keller». */
export function memberByName(s: ProjectState, name: string): string | undefined {
  const words = normalizeText(name)
    .replace(/[^a-zäöüéèàç'. -]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.replace(/\.$/, "").length >= 1);
  if (!words.length) return undefined;
  const fits = Object.entries(s.members).filter(([, m]) => {
    const parts = normalizeText(m.displayName).split(/[\s-]+/);
    return words.every((w) =>
      w.endsWith(".") ? parts.some((p) => p.startsWith(w.slice(0, -1))) : w.length >= 3 && parts.includes(w),
    );
  });
  return fits.length === 1 ? fits[0]![0] : undefined;
}

export interface MinutesItemInput {
  text: string;
}

export interface MinutesActionInput extends MinutesItemInput {
  /** A member of the project; else ownerName names someone outside it. */
  ownerId?: string;
  ownerName?: string;
  /** YYYY-MM-DD */
  due?: string;
}

export interface MinutesInput {
  title: string;
  heldOn: string;
  decisions: readonly MinutesItemInput[];
  actions: readonly MinutesActionInput[];
  questions: readonly MinutesItemInput[];
}

/** Minutes as entered or accepted; a message for the person, or null. */
export function validateMinutes(s: ProjectState, input: MinutesInput): string | null {
  if (input.title.trim().length < MIN_TITLE) {
    return `Bitte die Besprechung benennen (mindestens ${MIN_TITLE} Zeichen).`;
  }
  if (!isIsoDay(input.heldOn)) return "Bitte das Datum der Besprechung angeben.";
  const kinds = [input.decisions, input.actions, input.questions];
  if (kinds.every((k) => !k.length)) {
    return "Bitte mindestens einen Entscheid, eine Pendenz oder eine offene Frage erfassen.";
  }
  if (kinds.some((k) => k.length > MINUTES_ITEMS_MAX))
    return `Höchstens ${MINUTES_ITEMS_MAX} Einträge je Art.`;
  if (kinds.flat().some((i) => i.text.trim().length < 3)) {
    return "Jeder Eintrag braucht einen Text (mindestens 3 Zeichen).";
  }
  for (const a of input.actions) {
    if (a.ownerId && !s.members[a.ownerId])
      return "Die verantwortliche Person ist nicht Mitglied des Vorhabens.";
    if (a.due && !isIsoDay(a.due)) return "Bitte den Termin im Format JJJJ-MM-TT angeben.";
  }
  return null;
}

/** Open after its day. */
export function isActionOverdue(a: MinutesActionState, now: Date): boolean {
  return !a.doneAt && !!a.due && a.due < now.toISOString().slice(0, 10);
}

/** Minutes, the latest meeting first. */
export function minutesList(s: ProjectState): MinutesState[] {
  return Object.values(s.minutes).sort((a, b) => b.heldOn.localeCompare(a.heldOn) || b.number - a.number);
}

/** Open action items, the earliest due first; those without a day last. */
export function openActions(s: ProjectState): { minutes: MinutesState; action: MinutesActionState }[] {
  return Object.values(s.minutes)
    .flatMap((minutes) => minutes.actions.filter((a) => !a.doneAt).map((action) => ({ minutes, action })))
    .sort(
      (x, y) =>
        (x.action.due ?? "9999").localeCompare(y.action.due ?? "9999") || x.minutes.number - y.minutes.number,
    );
}
