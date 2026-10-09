// Who must be involved in which phase. Ported from prototype v22 (todo-later P05).
// The base list per phase is extended by rules on the project profile.

import type { ParticipantDef, ParticipationRule, PhaseId, ProjectProfile, ProjectRole } from "./types";

export interface PhaseParticipantDef extends ParticipantDef {
  required: boolean;
}

const p = (
  id: string,
  label: string,
  why: string,
  required: boolean,
  ownerRole: ProjectRole,
): PhaseParticipantDef => ({ id, label, why, required, ownerRole });

export const PHASE_PARTICIPANTS: Readonly<Record<PhaseId, readonly PhaseParticipantDef[]>> = {
  init: [
    p(
      "sach",
      "Sachbearbeitende der Fachstelle",
      "Kennen den realen Ablauf und die Sonderfälle",
      true,
      "FACH",
    ),
    p(
      "apm",
      "Applikationsmanagement (APM)",
      "Betriebsanforderungen gehören vor die Ausschreibung",
      true,
      "APM",
    ),
    p("ism", "Informationssicherheit (ISM)", "Prüft die SchuBAn und berät früh statt spät", false, "ISM"),
    p(
      "ds",
      "Datenschutz (Koordination, Fachstelle Datenschutz)",
      "Klärt früh, ob die Daten so verwendet werden dürfen",
      false,
      "DS",
    ),
    p("ea", "Enterprise-Architektur", "Varianten im Forum spiegeln, Vorgaben einbringen", false, "ARCH"),
    p("dev", "Applikationsentwicklung", "Vorhandene Services und Synergien erkennen", false, "ARCH"),
    p(
      "tk",
      "Technische Koordination (Solution Architecture)",
      "Liefermodell und technische Mindestkriterien vor der Ausschreibung",
      false,
      "INFRA",
    ),
    p("infra", "Infrastruktur", "Machbarkeit und Kriterien früh einbringen", false, "INFRA"),
  ],
  konzept: [
    p(
      "sach",
      "Sachbearbeitende der Fachstelle",
      "Spezifikation mit denen, die damit arbeiten, nicht nur mit Vorgesetzten",
      true,
      "FACH",
    ),
    p("ea", "Enterprise-Architektur", "Forum und Board-Freigabe vor Realisierungsbeginn", true, "ARCH"),
    p("ism", "Informationssicherheit (ISM)", "ISDS-Konzept mit Praxisbezug zur Infrastruktur", true, "ISM"),
    p("infra", "Infrastruktur", "Infrastruktursicht und Kriterien für die Ausschreibung", false, "INFRA"),
    p("apm", "Applikationsmanagement (APM)", "Betriebskonzept und SLA mitgestalten", true, "APM"),
    p("dev", "Applikationsentwicklung", "Schnittstellen, Standards, Schätzung", false, "ARCH"),
    p(
      "tk",
      "Technische Koordination (Solution Architecture)",
      "Umgebungsdesign und Kapazitätszusage der Infrastruktur",
      false,
      "INFRA",
    ),
    p("seceng", "Security Engineering", "Schutzbedarf in umsetzbare Massnahmen übersetzen", false, "ISM"),
  ],
  real: [
    p("tk", "Technische Koordination", "Bestellungen bündeln und Reihenfolge steuern", true, "INFRA"),
    p("infra", "Infrastruktur", "Umgebungen, Firewall-Regeln, Berechtigungsgruppen", true, "INFRA"),
    p("apm", "Applikationsmanagement (APM)", "Testumgebung aufbauen, Übernahme vorbereiten", true, "APM"),
    p("sach", "Sachbearbeitende der Fachstelle", "Tests mit echten Sonderfällen", true, "FACH"),
    p(
      "lief",
      "Lieferant (Umsetzungsebene)",
      "Pulscheck auf Arbeitsebene, nicht nur im Management",
      false,
      "PL",
    ),
    p("ism", "Informationssicherheit (ISM)", "Pentest und Massnahmen-Umsetzung", false, "ISM"),
  ],
  einf: [
    p("apm", "Applikationsmanagement (APM)", "Betriebsübernahme", true, "APM"),
    p("sach", "Sachbearbeitende der Fachstelle", "Abnahme und Schulung", true, "FACH"),
    p("kom", "Kommunikation", "Nutzende früh informieren", false, "PL"),
    p("sd", "Servicedesk", "Support ab dem ersten Tag", false, "APM"),
  ],
  skal: [
    p("apm", "Applikationsmanagement (APM)", "Betrieb und Weiterentwicklung", true, "APM"),
    p("sach", "Sachbearbeitende der Fachstelle", "Nutzen und Verbesserungen", true, "FACH"),
  ],
};

/** Parties that rules can add to a phase where they are not in the base list. */
export const PARTICIPANT_CATALOG: Readonly<Record<string, ParticipantDef>> = {
  sach: {
    id: "sach",
    label: "Sachbearbeitende der Fachstelle",
    why: "Kennen den realen Ablauf und die Sonderfälle",
    ownerRole: "FACH",
  },
  apm: {
    id: "apm",
    label: "Applikationsmanagement (APM)",
    why: "Betriebsanforderungen und Notfallkonzept früh einbringen",
    ownerRole: "APM",
  },
  ism: {
    id: "ism",
    label: "Informationssicherheit (ISM)",
    why: "Schutzbedarf und Massnahmen früh statt spät",
    ownerRole: "ISM",
  },
  ds: {
    id: "ds",
    label: "Datenschutz (Koordination, Fachstelle Datenschutz)",
    why: "Klärt früh, ob die Daten so verwendet werden dürfen",
    ownerRole: "DS",
  },
  ea: {
    id: "ea",
    label: "Enterprise-Architektur",
    why: "Varianten im Forum spiegeln, Vorgaben einbringen",
    ownerRole: "ARCH",
  },
  dev: {
    id: "dev",
    label: "Applikationsentwicklung",
    why: "Vorhandene Services und Schnittstellen kennen",
    ownerRole: "ARCH",
  },
  infra: {
    id: "infra",
    label: "Infrastruktur",
    why: "Machbarkeit, Umgebungen und Kapazität zusagen",
    ownerRole: "INFRA",
  },
  tk: {
    id: "tk",
    label: "Technische Koordination (Solution Architecture)",
    why: "Liefermodell, Umgebungen und technische Mindestkriterien vor der Ausschreibung",
    ownerRole: "INFRA",
  },
  seceng: {
    id: "seceng",
    label: "Security Engineering",
    why: "Übersetzt den Schutzbedarf in umsetzbare technische Massnahmen",
    ownerRole: "ISM",
  },
  besch: {
    id: "besch",
    label: "Beschaffung",
    why: "Muss-Kriterien und Verfahren früh klären",
    ownerRole: "PL",
  },
  lief: {
    id: "lief",
    label: "Lieferant (Umsetzungsebene)",
    why: "Pulscheck auf Arbeitsebene, nicht nur im Management",
    ownerRole: "PL",
  },
  kom: {
    id: "kom",
    label: "Kommunikation",
    why: "Externe Nutzende rechtzeitig mit Handlungsbedarf informieren",
    ownerRole: "PL",
  },
  sd: { id: "sd", label: "Servicedesk", why: "Support ab dem ersten Tag", ownerRole: "APM" },
  a11y: {
    id: "a11y",
    label: "Barrierefreiheit (QS)",
    why: "Portale für externe Nutzende müssen WCAG 2.1 AA erfüllen",
    ownerRole: "FACH",
  },
};

export const PARTICIPATION_RULES: readonly ParticipationRule[] = [
  {
    id: "schutz",
    label: "Schutzbedarf hoch",
    when: (pr: ProjectProfile) => pr.schutzbedarf === "hoch",
    add: { init: ["ism", "apm"], konzept: ["ism", "seceng"], real: ["ism"] },
  },
  {
    id: "pd",
    label: "Personendaten",
    when: (pr) => pr.personendaten,
    add: { init: ["ds"], konzept: ["ds"], real: ["ds"] },
  },
  {
    id: "cloud",
    label: "Cloud-Nutzung",
    when: (pr) => pr.cloud,
    add: { init: ["ism", "ea", "ds"], konzept: ["ea", "infra"] },
  },
  {
    id: "if",
    label: "Schnittstellen",
    when: (pr) => pr.schnittstellen > 0,
    add: { init: ["dev", "tk"], konzept: ["dev", "tk", "ea"], real: ["tk"] },
  },
  {
    id: "lief",
    label: "Externer Lieferant",
    when: (pr) => pr.lieferant,
    add: { init: ["tk", "besch"], konzept: ["besch", "tk"], real: ["lief"] },
  },
  {
    id: "verf",
    label: "Verfügbarkeit kritisch",
    when: (pr) => pr.verfuegbarkeit === "hoch",
    add: { init: ["apm", "infra"], konzept: ["apm", "infra"], einf: ["sd"] },
  },
  {
    id: "neu",
    label: "Neue Technologie",
    when: (pr) => pr.neueTechnologie,
    add: { init: ["ea"], konzept: ["seceng", "ea"] },
  },
  {
    id: "ext",
    label: "Portal für externe Nutzende",
    when: (pr) => pr.externeNutzende,
    add: { real: ["a11y"], einf: ["kom"] },
  },
];

/** How a party was involved; offered in the UI when recording participation. */
export const INVOLVEMENT_OPTIONS: readonly string[] = [
  "Kick-off",
  "Workshop",
  "Interview",
  "Review",
  "Architekturforum",
  "Sonstiges",
];
