// Offline provider for local development and tests: deterministic placeholder
// drafts, no network, no model. Never allowed in production (config.ts).

import type { DraftContent, Finding } from "@hermes-helfer/core";
import type {
  AiProvider,
  ChangeRequestDraft,
  ChangeRequestDraftRequest,
  CritiqueRequest,
  DraftRequest,
  ProviderInfo,
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
  return {
    summary: `Testentwurf «${req.skill.outputDoc}» für das Vorhaben «${p.name}» (${p.code}). Erstellt im Testmodus ohne KI-Modell; alle Inhalte sind Platzhalter.`,
    sections: req.skill.sections.map((heading) => ({
      heading,
      body: `${heading} für «${p.name}»: Hier fasst der Agent «${req.agent.name}» die Angaben aus den Projektunterlagen zusammen. Im Testmodus steht an dieser Stelle ein Platzhalter. Phase ${p.phaseLabel}; Profil: ${facts}.`,
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
}
