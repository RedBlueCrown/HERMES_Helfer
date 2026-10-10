import type { AgentDef } from "./types";

/** The 13 agents of the target architecture (§5). `active`: available in the current increment. */
export const AGENTS: readonly AgentDef[] = [
  {
    id: "A1",
    name: "Delivery-Assistent",
    description: "Beantwortet Fragen zum Vorhaben und stösst auf Wunsch Entwürfe an. Entscheidet nie.",
    active: true,
  },
  {
    id: "A2",
    name: "Projektführung & Kommunikation",
    description: "Entwirft Projektgrundlagen, Phasenberichte, Kick-off und Projektabschluss.",
    active: true,
  },
  {
    id: "A3",
    name: "Business-Analyse",
    description: "Erhebt Anforderungen, bewertet Varianten und plant das Backlog.",
    active: true,
  },
  {
    id: "A4",
    name: "Architektur & Technik",
    description: "Prüft gegen die Architektur-Patterns, entwirft Architektur und Umgebungen.",
    active: true,
  },
  {
    id: "A5",
    name: "ISDS & Datenschutz",
    description: "Bereitet Datenklassifizierung, Schutzbedarf, ISDS-Konzept und DSFA vor.",
    active: true,
  },
  {
    id: "A6",
    name: "Recht & Beschaffung",
    description: "Analysiert Rechtsgrundlagen und bereitet das Pflichtenheft vor.",
    active: true,
  },
  {
    id: "A7",
    name: "Test & Abnahme",
    description: "Entwirft Testkonzepte, Testfälle und stellt die Go-live-Bereitschaft zusammen.",
    active: true,
  },
  {
    id: "A8",
    name: "Einführung & Betrieb",
    description: "Plant Einführung und Schulung, entwirft Handbücher und die Betriebsübergabe.",
    active: true,
  },
  {
    id: "A9",
    name: "Protokoll",
    description: "Leitet aus Besprechungen Entscheide, Aufgaben und offene Fragen ab.",
    active: false,
  },
  {
    id: "A10",
    name: "Change-Request",
    description:
      "Arbeitet Änderungswünsche zu Change Requests aus und schätzt ein, welche Bereiche betroffen sind. Den Aufwand schätzt das Team.",
    active: true,
  },
  {
    id: "A11",
    name: "Kritiker",
    description: "Prüft jeden Entwurf auf Vollständigkeit, Lücken und Widersprüche.",
    active: true,
  },
  {
    id: "A12",
    name: "Risiko",
    description: "Schlägt neue oder geänderte Risiken vor.",
    active: false,
  },
  {
    id: "A13",
    name: "Wissen",
    description: "Findet Unterlagen, Lessons Learned und Zuständigkeiten.",
    active: false,
  },
];
