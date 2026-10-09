// Offline provider for local development and tests: deterministic placeholder
// drafts, no network, no model. Never allowed in production (config.ts).

import type { DraftContent, Finding } from "@hermes-helfer/core";
import type { AiProvider, CritiqueRequest, DraftRequest, ProviderInfo } from "./provider";

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
    return { findings: mockFindings(req.skill.id) };
  }
}
