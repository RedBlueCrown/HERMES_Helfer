// Offline provider for local development and tests: deterministic placeholder
// drafts, no network, no model. Never allowed in production (config.ts).

import {
  RISK_LEVELS,
  titlesSimilar,
  type DraftContent,
  type Finding,
  type Level,
  type ProjectRole,
} from "@hermes-helfer/core";
import type {
  AiProvider,
  ChangeRequestDraft,
  ChangeRequestDraftRequest,
  CritiqueRequest,
  DraftRequest,
  ProposedReassessment,
  ProposedRisk,
  ProviderInfo,
  RiskReview,
  RiskReviewRequest,
} from "./provider";

/** Content hints the mock Kritiker raises for some skills (todo-later P03). */
const MOCK_FINDINGS: Readonly<Record<string, string>> = {
  "init.discovery":
    "Die Varianten unterscheiden sich kaum. Prüfen, ob eine echte Alternative fehlt (Scheinvariante).",
  "init.projektgrundlagen": "Das Kapitel Qualitätssicherung nennt keine konkreten Massnahmen.",
  "init.bewerter": "Die Empfehlung stützt sich auf eine Aufwandschätzung ohne Quellenangabe.",
  "konzept.business-analyse":
    "Abläufe nur im Normalfall beschrieben. Alternativpfade (Rückweisung, Nachforderung) und Akzeptanzkriterien ergänzen.",
  "konzept.test-engineer": "Die Abnahmekriterien sind nicht je Mängelklasse festgelegt.",
  "konzept.isds": "Restrisiken ohne verantwortliche Person.",
  "real.user-acceptance": "Fehler der Klasse 3 ohne Termin zur Behebung.",
  "real.handbuecher": "SLA-Anhang fehlt, der Eskalationsweg ist unklar.",
  "einf.betrieb": "Der Eskalationskontakt des Lieferanten fehlt.",
  "skal.wertnachweis": "Die KPI-Basislinie vor der Einführung ist nicht dokumentiert.",
};

export function mockDraft(req: DraftRequest): DraftContent {
  const p = req.project;
  const facts = [
    `Schutzbedarf ${p.profile.schutzbedarf}`,
    p.profile.personendaten ? "Personendaten" : null,
    p.profile.cloud ? "Cloud-Nutzung" : null,
    p.profile.lieferant ? "externer Lieferant" : null,
  ]
    .filter(Boolean)
    .join(", ");
  const risks = p.openRisks.length
    ? `Offene Risiken gemäss Risikoregister: ${p.openRisks
        .slice(0, 5)
        .map((r) => `${r.label} ${r.title} (Eintritt ${r.probability}, Auswirkung ${r.impact})`)
        .join("; ")}.`
    : "Im Risikoregister sind keine offenen Risiken erfasst.";
  return {
    summary: `Testentwurf «${req.skill.outputDoc}» für das Vorhaben «${p.name}» (${p.code}). Erstellt im Testmodus ohne KI-Modell; alle Inhalte sind Platzhalter.`,
    sections: req.skill.sections.map((heading) => ({
      heading,
      body: /risik/i.test(heading)
        ? `${heading} für «${p.name}»: ${risks}`
        : `${heading} für «${p.name}»: Hier fasst der Agent «${req.agent.name}» die Angaben aus den Projektunterlagen zusammen. Im Testmodus steht an dieser Stelle ein Platzhalter. Phase ${p.phaseLabel}; Profil: ${facts}.`,
    })),
    openPoints: ["Platzhalter: Die Vorlage der Firma Muster AG fehlt noch (todo-later P02)."],
  };
}

export function mockFindings(skillId: string): Finding[] {
  const text = MOCK_FINDINGS[skillId];
  return text ? [{ severity: "hinweis", source: "kritiker", text }] : [];
}

const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/**
 * Change-Request agent without a model: a structured placeholder text and a
 * keyword-based guess of the areas, so the flow can be tried offline.
 */
export function mockChangeRequest(req: ChangeRequestDraftRequest): ChangeRequestDraft {
  const { title, description, requestedBy } = req.idea;
  const text = plain(`${title} ${description}`);
  const has = (re: RegExp) => re.test(text);
  const flag = (value: boolean, yes: string, no: string) => ({ value, reason: value ? yes : no });
  const body: Record<string, string> = {
    Ausgangslage: `${requestedBy || "Die antragstellende Stelle"} wünscht im Vorhaben «${req.project.name}» (Phase ${req.project.phaseLabel}) eine Änderung: ${title}.`,
    "Gewünschte Änderung": description.trim(),
    "Begründung und Nutzen": "[OFFEN: Wer profitiert, und woran lässt sich der Nutzen messen?]",
    "Betroffene Abläufe und Ergebnisse": "[OFFEN: Welche Abläufe, Ergebnisse und Systeme ändern sich?]",
    Alternativen:
      "[OFFEN: Lässt sich das Ziel ohne Anpassung des Produkts erreichen, zum Beispiel mit einem einfacheren Ablauf?]",
  };
  return {
    content: {
      summary: `${title}: ${description.trim()}`.slice(0, 600),
      sections: req.sections.map((heading) => ({ heading, body: body[heading] ?? "[OFFEN]" })),
      openPoints: ["Testmodus ohne KI-Modell: Text und Einschätzung der Bereiche bitte prüfen und ergänzen."],
    },
    flags: {
      daten: flag(
        has(/personendaten|personenbezogen|kunden|export|adresse|e-?mail|mandat|daten/),
        "Der Wunsch nennt Daten oder einen Export; ISM und Datenschutz sollten neu prüfen.",
        "Im Wunsch ist keine Änderung an Personendaten erkennbar.",
      ),
      schnittstelle: flag(
        has(/schnittstelle|anbind|api\b|fremdsystem|umsystem|ubertragung an/),
        "Der Wunsch betrifft den Austausch mit einem anderen System.",
        "Keine neue Schnittstelle erkennbar.",
      ),
      sonderloesung: flag(
        has(/sonder|individuell|anpassung des (standard|produkt)|eigenes feld|zusatzfeld|customizing/),
        "Der Wunsch verlangt eine Anpassung am Standardprodukt.",
        "Keine Abweichung vom Standard erkennbar.",
      ),
      oberflaeche: flag(
        has(/maske|feld|filter|button|knopf|ansicht|oberflache|anzeige|suche|formular|liste|export/),
        "Die Nutzenden sehen oder bedienen etwas Neues.",
        "Keine Änderung an der Oberfläche erkennbar.",
      ),
      extern: flag(
        has(/extern|kundin|kunde|partner|burger|treuhand|lieferant|revision/),
        "Personen ausserhalb des Projektteams sind betroffen.",
        "Nur interne Nutzende betroffen.",
      ),
    },
  };
}

type RiskTemplate = Omit<ProposedRisk, "reason">;

const risk = (
  title: string,
  probability: Level,
  impact: Level,
  ownerRole: ProjectRole,
  mitigation: string,
  description: string,
): RiskTemplate => ({ title, description, probability, impact, ownerRole, mitigation });

/** Typical risks behind the engine's facts (riskTriggers), keyed by the trigger id before ":". */
const MOCK_RISKS: Readonly<Record<string, RiskTemplate>> = {
  veto: risk(
    "Offenes Veto verzögert die Phasenfreigabe",
    "hoch",
    "mittel",
    "PL",
    "Mit der Rolle mit Veto die Bedingungen klären und einen Termin für den neuen Entscheid vereinbaren.",
    "Solange das Veto besteht, kann das Gate nicht entschieden werden; die Folgephase beginnt später.",
  ),
  "gate-zurueckgewiesen": risk(
    "Nacharbeit nach dem zurückgewiesenen Gate dauert länger als geplant",
    "mittel",
    "hoch",
    "PL",
    "Die Gründe der Rückweisung in einen Massnahmenplan mit Terminen überführen und mit dem Projektausschuss abstimmen.",
    "Die Rückweisung verlangt Nacharbeit an den Ergebnissen der Phase.",
  ),
  rolle: risk(
    "Entscheide verzögern sich wegen einer unbesetzten Rolle",
    "hoch",
    "mittel",
    "PL",
    "Die Rolle beim Auftraggeber anfordern und eine Stellvertretung bestimmen.",
    "Ohne die Rolle bleiben Entscheide der Phase offen.",
  ),
  beteiligung: risk(
    "Anforderungen bleiben unvollständig, weil Beteiligte fehlen",
    "mittel",
    "mittel",
    "PL",
    "Die fehlenden Beteiligten zu einem Workshop einladen und ihre Anforderungen erfassen.",
    "Nicht einbezogene Stellen melden ihre Anforderungen spät, was Nacharbeit auslöst.",
  ),
  "auflagen-ueberfaellig": risk(
    "Überfällige Auflagen gefährden die nächste Freigabe",
    "mittel",
    "mittel",
    "PL",
    "Für jede Auflage einen neuen Termin festlegen und den Stand im Projektausschuss berichten.",
    "Offene Auflagen werden beim nächsten Gate wieder zum Thema.",
  ),
  neupruefung: risk(
    "Neuprüfung von Sicherheit und Datenschutz verzögert das Gate",
    "mittel",
    "hoch",
    "DS",
    "ISM und Datenschutz früh einplanen und die Neuprüfung mit einem Termin versehen.",
    "Bis die Neuprüfung abgeschlossen ist, bleibt das Gate geschlossen.",
  ),
  cr: risk(
    "Offene Change Requests verschieben Termine und Kosten",
    "mittel",
    "mittel",
    "PL",
    "Die Change Requests im nächsten Projektausschuss entscheiden lassen und die Planung nachführen.",
    "Solange über die Änderungen nicht entschieden ist, sind Umfang und Termine unsicher.",
  ),
  "reserve-ueberschritten": risk(
    "Mehrkosten übersteigen die Reserve für Änderungen",
    "hoch",
    "hoch",
    "PA",
    "Einen Nachtragskredit beantragen oder den Umfang mit dem Projektausschuss reduzieren.",
    "Die angenommenen Change Requests kosten mehr als die Reserve aus dem Projektauftrag.",
  ),
  "reserve-fehlt": risk(
    "Mehrkosten durch Änderungen ohne Reserve",
    "mittel",
    "mittel",
    "PL",
    "Die Reserve für Änderungen gemäss Projektauftrag erfassen und die Kosten laufend verfolgen.",
    "Ohne Reserve ist offen, wie Änderungen finanziert werden.",
  ),
  "profil:lieferant": risk(
    "Lieferverzug des externen Lieferanten",
    "mittel",
    "hoch",
    "PL",
    "Liefertermine vertraglich festhalten und einen Eskalationskontakt beim Lieferanten bestimmen.",
    "Das Vorhaben hängt von Lieferungen eines externen Lieferanten ab.",
  ),
  "profil:cloud": risk(
    "Personendaten in der Cloud ohne geklärten Speicherort",
    "mittel",
    "hoch",
    "DS",
    "Speicherort und Auftragsbearbeitung mit dem Anbieter vertraglich regeln.",
    "Personendaten werden in einer Cloud-Lösung bearbeitet.",
  ),
  "profil:technologie": risk(
    "Neue Technologie verursacht Mehraufwand",
    "mittel",
    "mittel",
    "ARCH",
    "Einen Prototyp mit den kritischen Funktionen früh bauen und testen.",
    "Mit der Technologie fehlt im Team Erfahrung.",
  ),
  "profil:schnittstellen": risk(
    "Fehler in den Schnittstellen zu Umsystemen",
    "mittel",
    "mittel",
    "ARCH",
    "Schnittstellen früh spezifizieren und zusätzliche Integrationstests einplanen.",
    "Mehrere Schnittstellen erhöhen den Test- und Abstimmungsaufwand.",
  ),
  "profil:extern": risk(
    "Geringe Akzeptanz bei externen Nutzenden",
    "mittel",
    "mittel",
    "FACH",
    "Externe Nutzende in die Tests einbeziehen und die Einführung mit Anleitungen begleiten.",
    "Externe Nutzende kennen die Abläufe der Firma nicht.",
  ),
  "profil:verfuegbarkeit": risk(
    "Betriebsunterbrüche trotz hoher Anforderungen an die Verfügbarkeit",
    "niedrig",
    "hoch",
    "APM",
    "Ein Betriebskonzept mit Überwachung und Notfallplan früh erstellen.",
    "Ausfälle treffen die Nutzenden direkt.",
  ),
  "profil:schutzbedarf": risk(
    "Sicherheitslücken bei hohem Schutzbedarf",
    "niedrig",
    "hoch",
    "ISM",
    "Die Sicherheitsanforderungen im ISDS-Konzept festhalten und vor dem Go-live prüfen lassen.",
    "Die Daten haben einen hohen Schutzbedarf.",
  ),
};

const higher = (l: Level): Level => RISK_LEVELS[Math.min(RISK_LEVELS.indexOf(l) + 1, 2)]!;

/**
 * Risiko agent without a model: one typical risk per fact from the engine, unless
 * the register already has a similar one; then that one is proposed for a new
 * assessment with a higher probability.
 */
export function mockRiskReview(req: RiskReviewRequest): RiskReview {
  const newRisks: ProposedRisk[] = [];
  const reassessments: ProposedReassessment[] = [];
  for (const t of req.triggers) {
    const template = MOCK_RISKS[t.id] ?? MOCK_RISKS[t.id.split(":")[0]!];
    if (!template) continue;
    const reason = `Anlass: ${t.text}`;
    const existing = req.project.openRisks.find((r) => titlesSimilar(r.title, template.title));
    if (existing) {
      if (existing.probability !== "hoch" && !reassessments.some((x) => x.risk === existing.label)) {
        reassessments.push({
          risk: existing.label,
          probability: higher(existing.probability),
          impact: existing.impact,
          mitigation: "",
          reason: `Der Anlass besteht weiterhin. ${reason}`,
        });
      }
    } else if (!newRisks.some((x) => x.title === template.title)) {
      newRisks.push({ ...template, reason });
    }
  }
  return { newRisks: newRisks.slice(0, req.max), reassessments: reassessments.slice(0, req.max) };
}

export class MockProvider implements AiProvider {
  readonly info: ProviderInfo = {
    provider: "mock",
    model: "mock (ohne KI-Modell)",
    region: "lokal",
    supportsChat: false,
  };

  constructor(private readonly latencyMs = 0) {}

  private wait(): Promise<void> {
    return this.latencyMs ? new Promise((r) => setTimeout(r, this.latencyMs)) : Promise.resolve();
  }

  async draft(req: DraftRequest) {
    await this.wait();
    return { draft: mockDraft(req) };
  }

  async critique(req: CritiqueRequest) {
    return { findings: mockFindings(req.key) };
  }

  async draftChangeRequest(req: ChangeRequestDraftRequest) {
    await this.wait();
    return { draft: mockChangeRequest(req) };
  }

  async reviewRisks(req: RiskReviewRequest) {
    await this.wait();
    return { review: mockRiskReview(req) };
  }
}
