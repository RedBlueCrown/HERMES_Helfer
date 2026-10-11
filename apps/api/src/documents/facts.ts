// Where the content of each field of a Word template comes from:
// - "engine": what the app knows for certain (the project's name, who holds
//   which role, the result's status …), filled in when the document is made;
//   an agent never writes it;
// - "person": signatures, approvals and the classification; people fill them
//   in on the document, the app leaves them empty;
// - "agent": everything else; the agent drafts it, and people check and edit
//   it in the app before the document is made.
// Labels are matched as written in the pilot's templates; a template with
// other labels gets agent fields instead of engine fields (the PMO sees which).

import {
  PROJECT_ROLES,
  PROJECT_ROLE_LABELS,
  deliverableStatus,
  deliverableStatusLabel,
  hasAiDraft,
  type DeliverableDef,
  type HermesModel,
  type ProjectRole,
  type ProjectState,
  type SkillDef,
} from "@hermes-helfer/core";
import { COVER, fieldKey, type TemplateField } from "./template";

export type FieldSource = "engine" | "agent" | "person";

export interface SourcedField extends TemplateField {
  source: FieldSource;
  /** Engine fields: what the app fills in, in words. */
  fact?: string;
}

type Fact =
  | { kind: "project" | "code" | "version" | "status" | "date" }
  | { kind: "roles"; roles: readonly ProjectRole[] }
  | { kind: "otherRoles" };

/** Facts of the cover page («Deckblatt»), by label. */
const COVER_FACTS: Readonly<Record<string, Fact>> = {
  projektname: { kind: "project" },
  projekt: { kind: "project" },
  vorhaben: { kind: "project" },
  "projekt / vorhaben": { kind: "project" },
  "projektnummer / referenz": { kind: "code" },
  projektnummer: { kind: "code" },
  referenz: { kind: "code" },
  dokumentversion: { kind: "version" },
  version: { kind: "version" },
  dokumentenstatus: { kind: "status" },
  dokumentstatus: { kind: "status" },
  status: { kind: "status" },
  datum: { kind: "date" },
};

/** Who holds a role in the project, by label, anywhere in the template. */
const ROLE_FACTS: Readonly<Record<string, readonly ProjectRole[]>> = {
  projektleitung: ["PL"],
  "auftraggeberin / auftraggeber": ["PA"],
  auftraggeberin: ["PA"],
  auftraggeber: ["PA"],
  "lenkungsausschuss / steuerungsgremium": ["PA"],
  lenkungsausschuss: ["PA"],
  steuerungsgremium: ["PA"],
  projektausschuss: ["PA"],
  fachvertretung: ["FACH"],
  "it- und lösungsvertretung": ["ARCH", "INFRA"],
  // Assumptions to confirm with the PMO (offene Fragen F40).
  "verantwortliche person für isds": ["ISM"],
  "systemverantwortliche person": ["APM"],
};
const OTHER_ROLES = new Set(["weitere rollen und zuständigkeiten", "weitere rollen"]);

/** Signatures, approvals and the classification: people decide and sign them. */
const PERSON_CHAPTER = /freigabe|unterschrift/;
const PERSON_LABEL =
  /unterschrift|visum|ort und datum|name und funktion|vertraulichkeitsklasse|klassifizierung|klassifikation/;

const isPersonField = (f: TemplateField) =>
  (f.chapter !== COVER && PERSON_CHAPTER.test(fieldKey(f.chapter))) || PERSON_LABEL.test(fieldKey(f.label));

function factOf(f: TemplateField): Fact | undefined {
  if (isPersonField(f)) return undefined;
  const label = fieldKey(f.label);
  const cover = f.chapter === COVER ? COVER_FACTS[label] : undefined;
  if (cover) return cover;
  const roles = ROLE_FACTS[label];
  if (roles) return { kind: "roles", roles };
  return OTHER_ROLES.has(label) ? { kind: "otherRoles" } : undefined;
}

const roleNames = (roles: readonly ProjectRole[]) =>
  roles.map((r) => `«${PROJECT_ROLE_LABELS[r]}»`).join(" und ");

function describeFact(fact: Fact): string {
  switch (fact.kind) {
    case "project":
      return "Name des Vorhabens";
    case "code":
      return "Kürzel des Vorhabens";
    case "version":
      return "Version des Inhalts im HERMES Helfer";
    case "status":
      return "Status des Ergebnisses, z. B. «Entwurf (KI)» oder «Freigegeben»";
    case "date":
      return "Datum der Freigabe, sonst des letzten Stands";
    case "roles":
      return `Personen mit der Rolle ${roleNames(fact.roles)}`;
    case "otherRoles":
      return "Die übrigen Rollen des Vorhabens mit ihren Personen";
  }
}

/** The fields of a template with the source of their content. */
export function withSources(fields: readonly TemplateField[]): SourcedField[] {
  return fields.map((f) => {
    if (isPersonField(f)) return { ...f, source: "person" };
    const fact = factOf(f);
    return fact ? { ...f, source: "engine", fact: describeFact(fact) } : { ...f, source: "agent" };
  });
}

/**
 * The skill whose draft follows a deliverable's template: the one that writes
 * the document (its output has the deliverable's name), else the last one.
 */
export function templateSkillOf(model: HermesModel, d: DeliverableDef): SkillDef | undefined {
  const skills = d.skills.map((id) => model.skill(id));
  return skills.find((k) => fieldKey(k.outputDoc) === fieldKey(d.name)) ?? skills.at(-1);
}

/** A date as people in Switzerland write it, in Swiss time. */
export const swissDate = (iso: string) =>
  new Date(iso).toLocaleDateString("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const holders = (s: ProjectState, role: ProjectRole) =>
  Object.values(s.members)
    .filter((m) => m.roles.includes(role))
    .map((m) => m.displayName)
    .sort((a, b) => a.localeCompare(b, "de-CH"));

/** When the content was last released, else last changed; undefined without content. */
function contentDate(s: ProjectState, d: DeliverableDef): string | undefined {
  const released = s.released[d.id];
  if (released && !s.unreleased[d.id]) return released.at;
  const changed = d.skills
    .map((id) => s.skills[id]?.output)
    .map((o) => o?.editedAt ?? o?.createdAt)
    .filter((at): at is string => !!at)
    .sort();
  return changed.at(-1);
}

/**
 * The values of the template's engine fields for a project's deliverable, keyed
 * by field id (fieldKey). Empty facts (a role nobody holds) are left out.
 */
export function engineValues(
  fields: readonly TemplateField[],
  s: ProjectState,
  model: HermesModel,
  d: DeliverableDef,
  now: Date,
): Map<string, string> {
  const facts = fields.map((f) => [f, factOf(f)] as const);
  // «Weitere Rollen» lists the roles that have no field of their own.
  const named = new Set(facts.flatMap(([, fact]) => (fact?.kind === "roles" ? fact.roles : [])));
  const skill = templateSkillOf(model, d);
  const value = (fact: Fact): string => {
    switch (fact.kind) {
      case "project":
        return s.name;
      case "code":
        return s.code;
      case "version": {
        const v = skill ? s.skills[skill.id]?.output?.version : undefined;
        return v ? String(v) : "";
      }
      case "status":
        return deliverableStatusLabel(d, deliverableStatus(s, model, d), hasAiDraft(s, d));
      case "date":
        return swissDate(contentDate(s, d) ?? now.toISOString());
      case "roles":
        return fact.roles.flatMap((r) => holders(s, r)).join(", ");
      case "otherRoles":
        return PROJECT_ROLES.filter((r) => !named.has(r))
          .map((r) => [r, holders(s, r)] as const)
          .filter(([, names]) => names.length)
          .map(([r, names]) => `${PROJECT_ROLE_LABELS[r]}: ${names.join(", ")}`)
          .join("\n");
    }
  };
  const values = new Map<string, string>();
  for (const [f, fact] of facts) {
    const v = fact ? value(fact) : "";
    if (v) values.set(fieldKey(f.id), v);
  }
  return values;
}
