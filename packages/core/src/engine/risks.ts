// Risks: score, matrix and the facts the Risiko agent reviews (prototype:
// riskScore, renderRiskList, Risk agent). Deterministic: the engine scores and
// sorts, the Risiko agent proposes, the Projektleitung accepts.

import type { HermesModel } from "../model";
import { RISK_LEVELS, RISK_LEVEL_VALUE, RISK_SCORE_HIGH, RISK_SCORE_MEDIUM } from "../model/risks";
import { PROJECT_ROLE_LABELS } from "../model/roles";
import type { Level } from "../model/types";
import {
  changeImpact,
  crLabel,
  formatChf,
  impactContext,
  impactSummary,
  openChangeRequests,
  openRechecks,
  reserveStatus,
} from "./change-requests";
import { isConditionOverdue } from "./conditions";
import { openParticipation } from "./participation";
import type { ProjectState, RiskState } from "./state";
import { gateStatus, isFinished, isPhaseCurrent, missingRoles } from "./status";

export const riskLabel = (number: number) => `R-${String(number).padStart(2, "0")}`;

/** Probability × impact, 1 to 9. */
export const riskScore = (probability: Level, impact: Level) =>
  RISK_LEVEL_VALUE[probability] * RISK_LEVEL_VALUE[impact];

/** How serious a score is: from 6 high, from 3 medium (question F33). */
export function scoreLevel(score: number): Level {
  return score >= RISK_SCORE_HIGH ? "hoch" : score >= RISK_SCORE_MEDIUM ? "mittel" : "niedrig";
}

export const isOpenRisk = (r: RiskState) => r.status !== "geschlossen";
export const isHighRisk = (r: RiskState) =>
  isOpenRisk(r) && riskScore(r.probability, r.impact) >= RISK_SCORE_HIGH;

/** Highest score first, then the older risk. */
export function compareRisks(a: RiskState, b: RiskState): number {
  return riskScore(b.probability, b.impact) - riskScore(a.probability, a.impact) || a.number - b.number;
}

/** Open risks, the most serious first. */
export function openRisks(s: ProjectState): RiskState[] {
  return Object.values(s.risks).filter(isOpenRisk).sort(compareRisks);
}

export function highRisks(s: ProjectState): RiskState[] {
  return openRisks(s).filter(isHighRisk);
}

export const nextRiskNumber = (s: ProjectState) =>
  Object.values(s.risks).reduce((n, r) => Math.max(n, r.number), 0) + 1;

/**
 * Open risks per cell: `matrix[p][i]` counts the risks with probability
 * RISK_LEVELS[p] and impact RISK_LEVELS[i].
 */
export function riskMatrix(s: ProjectState): number[][] {
  const m = RISK_LEVELS.map(() => RISK_LEVELS.map(() => 0));
  for (const r of openRisks(s)) {
    m[RISK_LEVELS.indexOf(r.probability)]![RISK_LEVELS.indexOf(r.impact)]!++;
  }
  return m;
}

export type RiskTrend = "steigend" | "stabil" | "sinkend";

/** Change of the score with the last assessment; undefined before the first one. */
export function riskTrend(r: RiskState): RiskTrend | undefined {
  const prev = r.history.at(-2);
  if (!prev) return undefined;
  const before = riskScore(prev.probability, prev.impact);
  const now = riskScore(r.probability, r.impact);
  return now > before ? "steigend" : now < before ? "sinkend" : "stabil";
}

/** Last time a person assessed the risk (or recorded it). */
export const riskReviewedAt = (r: RiskState) => r.history.at(-1)?.at ?? r.recordedAt;

// ---------- Similar risks ----------

const STOP_WORDS = new Set(
  "der die das den dem des ein eine einer eines einem und oder bei beim im in am an auf aus mit von vom zum zur zu fur nicht kein keine wird werden ist sind durch uber nach vor".split(
    " ",
  ),
);

/** Significant words of a title: lower case, no umlauts, no stop words, the first six letters of the stem (German compounds). */
export function riskWords(text: string): Set<string> {
  const plain = text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return new Set(
    plain
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
      .map((w) => w.replace(/(ern|en|er|es|e|n|s)$/, "").slice(0, 6)),
  );
}

/** Share of the significant words two titles have in common (0 to 1); needs at least two common words. */
function titleOverlap(a: Set<string>, b: Set<string>): number {
  const common = [...a].filter((w) => b.has(w)).length;
  return common >= 2 ? common / Math.min(a.size, b.size) : 0;
}

/** Whether two risk titles probably name the same risk (half of the significant words in common). */
export const titlesSimilar = (a: string, b: string) => titleOverlap(riskWords(a), riskWords(b)) >= 0.5;

/** The open risk whose title is most similar to `title`, if any. */
export function similarOpenRisk(s: ProjectState, title: string): RiskState | undefined {
  const words = riskWords(title);
  let best: { risk: RiskState; overlap: number } | undefined;
  for (const r of openRisks(s)) {
    const overlap = titleOverlap(words, riskWords(r.title));
    if (overlap >= 0.5 && (!best || overlap > best.overlap)) best = { risk: r, overlap };
  }
  return best?.risk;
}

// ---------- Facts for the Risiko agent ----------

export interface RiskTrigger {
  /** Stable key, e.g. "veto" or "profil:lieferant"; the offline agent maps it to a proposal. */
  id: string;
  text: string;
}

/**
 * Facts from the project that may point to a risk: blocked or rejected gate,
 * overdue Auflagen, missing roles and participants, change requests and the
 * reserve, and the project profile. The Risiko agent decides which of them
 * are risks not yet in the register.
 */
export function riskTriggers(s: ProjectState, model: HermesModel, now: Date): RiskTrigger[] {
  if (isFinished(s, model)) return [];
  const out: RiskTrigger[] = [];
  const phase = model.phase(s.phase);
  const current = isPhaseCurrent(s, phase.id);
  if (current) {
    const gate = gateStatus(s, model, phase.id);
    if (gate === "blocked") {
      out.push({
        id: "veto",
        text: `Ein Veto-Entscheid ist offen und blockiert das Gate «${phase.gate.name}».`,
      });
    }
    if (s.gateDecisions[phase.id]?.at(-1)?.decision === "zurückgewiesen") {
      out.push({
        id: "gate-zurueckgewiesen",
        text: `Der letzte Entscheid zum Gate «${phase.gate.name}» lautet «zurückgewiesen».`,
      });
    }
    for (const role of missingRoles(s, model, phase.id)) {
      out.push({
        id: `rolle:${role}`,
        text: `Niemand im Vorhaben hat die Rolle ${PROJECT_ROLE_LABELS[role]}, die in dieser Phase entscheidet.`,
      });
    }
    const involve = openParticipation(s, model, phase.id);
    if (involve.length) {
      out.push({
        id: "beteiligung",
        text: `Noch nicht einbezogen: ${involve.map((x) => x.label).join(", ")}.`,
      });
    }
  }
  const overdue = Object.values(s.conditions).filter(
    (c) => !c.doneAt && isConditionOverdue(s, model, c, now),
  );
  if (overdue.length) {
    out.push({
      id: "auflagen-ueberfaellig",
      text: `${overdue.length === 1 ? "1 Auflage ist" : `${overdue.length} Auflagen sind`} überfällig: ${overdue.map((c) => c.text).join("; ")}.`,
    });
  }
  for (const cr of openRechecks(s)) {
    out.push({
      id: `neupruefung:${cr.id}`,
      text: `Nach ${crLabel(cr.number)} prüfen ISM und Datenschutz SchuBAn, ISDS-Konzept und DSFA neu; bis dahin bleibt das Gate zu.`,
    });
  }
  for (const cr of openChangeRequests(s)) {
    const impact = changeImpact(cr, impactContext(s), model);
    out.push({
      id: `cr:${cr.id}`,
      text: `${crLabel(cr.number)} «${cr.title}» wartet auf den Entscheid (${cr.effortDays} Personentage; ${impactSummary(impact)}).`,
    });
  }
  const reserve = reserveStatus(s);
  if (reserve.remainingChf !== undefined && reserve.remainingChf < 0) {
    out.push({
      id: "reserve-ueberschritten",
      text: `Die angenommenen Change Requests übersteigen die Reserve für Änderungen um ${formatChf(-reserve.remainingChf)}.`,
    });
  } else if (reserve.reserveChf === undefined && reserve.usedChf > 0) {
    out.push({
      id: "reserve-fehlt",
      text: `Keine Reserve für Änderungen erfasst; die angenommenen Change Requests kosten ${formatChf(reserve.usedChf)}.`,
    });
  }
  const p = s.profile;
  const profile: [boolean, string, string][] = [
    [p.lieferant, "profil:lieferant", "Ein externer Lieferant ist beteiligt."],
    [p.cloud && p.personendaten, "profil:cloud", "Personendaten werden in einer Cloud-Lösung bearbeitet."],
    [p.neueTechnologie, "profil:technologie", "Das Vorhaben setzt eine neue Technologie ein."],
    [
      p.schnittstellen >= 3,
      "profil:schnittstellen",
      `${p.schnittstellen} Schnittstellen zu anderen Systemen.`,
    ],
    [p.externeNutzende, "profil:extern", "Externe Nutzende sind betroffen."],
    [p.verfuegbarkeit === "hoch", "profil:verfuegbarkeit", "Hohe Anforderungen an die Verfügbarkeit."],
    [p.schutzbedarf === "hoch", "profil:schutzbedarf", "Hoher Schutzbedarf der Daten."],
  ];
  for (const [on, id, text] of profile) if (on) out.push({ id, text });
  return out;
}
