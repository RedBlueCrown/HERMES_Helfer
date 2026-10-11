// The organisation's Word templates in use: which sections an agent drafts for
// a result that has a template, and the result as a Word document (todo-later P02).
// The PMO uploads one template per deliverable (documents/routes.ts); every version stays.

import {
  canViewSkillContent,
  contentVersion,
  deliverableStatus,
  deliverableStatusLabel,
  hasAiDraft,
  type DeliverableDef,
  type DraftSection,
  type HermesModel,
  type ProjectState,
  type SkillDef,
  type TemplateRef,
  type Viewer,
} from "@hermes-helfer/core";
import { MAX_SECTIONS } from "../agents/output";
import { HttpError } from "../errors";
import { DocxError } from "./docx";
import { engineValues, templateSkillOf, withSources, type SourcedField } from "./facts";
import { analyzeTemplate, fieldKey, fillTemplate } from "./template";
import type { TemplateInfo, TemplateStore } from "./template-store";

/** The most fields of one template an agent drafts; a draft has at most MAX_SECTIONS. */
export const MAX_AGENT_FIELDS = 100;
/** A field id is a section heading of the draft (routes.ts: at most 200 characters). */
const MAX_FIELD_ID = 200;
/**
 * How long an instance keeps the list of templates in use. Another API instance
 * sees a new upload after at most this long; the instance that took it, at once.
 */
const IN_USE_MS = 60_000;

interface Analysed {
  /** The template's title («Projektauftrag»); empty if it has none. */
  title: string;
  fields: SourcedField[];
}

export interface TemplateInUse extends Analysed {
  info: TemplateInfo;
}

/** What a skill drafts: the agent fields of the templates it writes, else the model's sections. */
export interface DraftPlan {
  sections: string[];
  /** Sections that are table cells: a short value, no running text. */
  short: string[];
  /** The templates the sections come from; empty: the model's sections. */
  templates: TemplateRef[];
  /** The templates' titles, for the agent. */
  titles: string[];
}

/** What the Word document of a deliverable contains, for the person before downloading it. */
export interface DocumentReport {
  template: { version: number; fileName: string; title: string; uploadedAt: string };
  fields: number;
  /** Fields with content from the app or from a draft. */
  filled: number;
  /** Signatures, approvals, classification: people fill them in on the document. */
  forPeople: number;
  /** Sections of the draft without a field in the template: they are not in the document. */
  unplaced: string[];
}

export interface TemplateOverview {
  deliverableId: string;
  name: string;
  phase: string;
  restricted: boolean;
  /** The skill whose draft follows the template, if the deliverable has one. */
  skill?: { id: string; name: string };
  template?: TemplateInfo & Analysed;
}

/** Only characters that are safe in a file name on every system. */
export function safeFileName(name: string, fallback: string): string {
  const base = Array.from(name.split(/[/\\]/).pop() ?? "")
    .filter((ch) => {
      const c = ch.codePointAt(0)!;
      return c >= 0x20 && c !== 0x7f && !'"*:<>?|'.includes(ch);
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return base && !/^\.+$/.test(base) ? base : fallback;
}

/** Checks an uploaded template: a Word file with fields. The reason is for the person who uploaded it. */
function inspect(content: Uint8Array): Analysed {
  let analysed: Analysed;
  try {
    const layout = analyzeTemplate(content);
    analysed = { title: layout.title, fields: withSources(layout.fields) };
  } catch (err) {
    if (err instanceof DocxError) throw new HttpError(400, "invalid_template", err.message);
    throw err;
  }
  const long = analysed.fields.find((f) => f.id.length > MAX_FIELD_ID);
  if (long) {
    throw new HttpError(
      400,
      "invalid_template",
      `Die Bezeichnung «${long.id.slice(0, 80)}…» ist mit dem Kapitel zu lang (höchstens ${MAX_FIELD_ID} Zeichen).`,
    );
  }
  const drafted = analysed.fields.filter((f) => f.source === "agent").length;
  if (drafted > MAX_AGENT_FIELDS) {
    throw new HttpError(
      400,
      "invalid_template",
      `Die Vorlage hat ${drafted} Felder für den Agenten; höchstens ${MAX_AGENT_FIELDS} sind möglich.`,
    );
  }
  return analysed;
}

export class DocumentService {
  /** A template's fields by the hash of its file: each version is analysed once. */
  private readonly analysed = new Map<string, Analysed>();
  private inUse?: { until: number; byDeliverable: Map<string, TemplateInfo> };

  constructor(
    private readonly store: TemplateStore,
    private readonly model: HermesModel,
  ) {}

  private analyse(content: Uint8Array, sha256: string): Analysed {
    let found = this.analysed.get(sha256);
    if (!found) {
      found = inspect(content);
      this.analysed.set(sha256, found);
    }
    return found;
  }

  private async current(): Promise<Map<string, TemplateInfo>> {
    if (this.inUse && this.inUse.until > Date.now()) return this.inUse.byDeliverable;
    const byDeliverable = new Map((await this.store.list()).map((t) => [t.deliverableId, t]));
    this.inUse = { until: Date.now() + IN_USE_MS, byDeliverable };
    return byDeliverable;
  }

  /** The template in use for a deliverable, with its fields and where their content comes from. */
  async template(deliverableId: string): Promise<TemplateInUse | undefined> {
    const info = (await this.current()).get(deliverableId);
    if (!info) return undefined;
    const known = this.analysed.get(info.sha256);
    if (known) return { info, ...known };
    const stored = await this.store.latest(deliverableId);
    if (!stored) return undefined;
    const { content, ...latest } = stored;
    return { info: latest, ...this.analyse(content, latest.sha256) };
  }

  /** Checks an upload and keeps it as the deliverable's new template version. */
  async add(
    deliverableId: string,
    fileName: string,
    content: Uint8Array,
    by: { userId: string; displayName: string },
    at: string,
  ): Promise<TemplateInfo & Analysed> {
    const checked = inspect(content);
    const info = await this.store.add({
      deliverableId,
      fileName: safeFileName(fileName, `${deliverableId}.docx`),
      content,
      uploadedBy: by,
      uploadedAt: at,
    });
    this.analysed.set(info.sha256, checked);
    this.inUse = undefined;
    return { ...info, ...checked };
  }

  /** The template file in use, as uploaded. */
  async file(deliverableId: string) {
    return this.store.latest(deliverableId);
  }

  /** Every deliverable of the model with the template in use, if any (the PMO's page). */
  async overview(): Promise<TemplateOverview[]> {
    this.inUse = undefined;
    const out: TemplateOverview[] = [];
    for (const phase of this.model.phases) {
      for (const d of phase.deliverables) {
        const skill = templateSkillOf(this.model, d);
        const t = await this.template(d.id);
        out.push({
          deliverableId: d.id,
          name: d.name,
          phase: phase.label,
          restricted: d.restricted,
          ...(skill ? { skill: { id: skill.id, name: skill.name } } : {}),
          ...(t ? { template: { ...t.info, title: t.title, fields: t.fields } } : {}),
        });
      }
    }
    return out;
  }

  /**
   * The sections a skill drafts: the agent fields of the templates of the
   * results it writes, in the order of its results; without such a template,
   * the model's sections.
   */
  async plan(skill: SkillDef): Promise<DraftPlan> {
    const plan: DraftPlan = { sections: [], short: [], templates: [], titles: [] };
    const seen = new Set<string>();
    for (const d of this.model.deliverablesOfSkill(skill.id)) {
      if (templateSkillOf(this.model, d)?.id !== skill.id) continue;
      const t = await this.template(d.id);
      if (!t) continue;
      let used = false;
      for (const f of t.fields) {
        if (f.source !== "agent" || seen.has(fieldKey(f.id)) || plan.sections.length >= MAX_SECTIONS)
          continue;
        seen.add(fieldKey(f.id));
        plan.sections.push(f.id);
        if (f.kind === "cell") plan.short.push(f.id);
        used = true;
      }
      if (!used) continue;
      plan.templates.push({ deliverableId: d.id, version: t.info.version, sha256: t.info.sha256 });
      plan.titles.push(t.title || d.name);
    }
    return plan.sections.length
      ? plan
      : { sections: [...skill.sections], short: [], templates: [], titles: [] };
  }

  /**
   * The values of the document's fields: engine facts, and the drafts of the
   * deliverable's skills that the viewer may read. A field takes the section
   * with its id from the template skill's draft; failing that, a section
   * headed like its label (a draft written before the template).
   */
  private values(t: Analysed, s: ProjectState, d: DeliverableDef, viewer: Viewer, now: Date) {
    const values = engineValues(t.fields, s, this.model, d, now);
    const skill = templateSkillOf(this.model, d);
    const sections = (id: string): DraftSection[] =>
      canViewSkillContent(s, this.model, viewer, this.model.skill(id))
        ? (s.skills[id]?.output?.draft.sections.filter((x) => x.body.trim()) ?? [])
        : [];
    const own = skill ? sections(skill.id) : [];
    const others = d.skills.filter((id) => id !== skill?.id).flatMap(sections);
    const byId = new Map(own.map((x) => [fieldKey(x.heading), x]));
    const used = new Set<DraftSection>();
    for (const f of t.fields) {
      if (f.source !== "agent") continue;
      const section =
        byId.get(fieldKey(f.id)) ??
        [...own, ...others].find((x) => !used.has(x) && fieldKey(x.heading) === fieldKey(f.label));
      if (!section) continue;
      used.add(section);
      values.set(fieldKey(f.id), section.body);
    }
    return { values, unplaced: own.filter((x) => !used.has(x)).map((x) => x.heading) };
  }

  private report(t: TemplateInUse, values: Map<string, string>, unplaced: string[]): DocumentReport {
    return {
      template: {
        version: t.info.version,
        fileName: t.info.fileName,
        title: t.title,
        uploadedAt: t.info.uploadedAt,
      },
      fields: t.fields.length,
      filled: t.fields.filter((f) => f.source !== "person" && values.get(fieldKey(f.id))?.trim()).length,
      forPeople: t.fields.filter((f) => f.source === "person").length,
      unplaced,
    };
  }

  /** What the deliverable's document would contain; undefined without a template. */
  async preview(
    s: ProjectState,
    d: DeliverableDef,
    viewer: Viewer,
    now: Date,
  ): Promise<DocumentReport | undefined> {
    const t = await this.template(d.id);
    if (!t) return undefined;
    const { values, unplaced } = this.values(t, s, d, viewer, now);
    return this.report(t, values, unplaced);
  }

  /**
   * The deliverable as a Word document: the template in use with the project's
   * facts and the drafts the viewer may read. The caller checks need-to-know.
   */
  async document(s: ProjectState, d: DeliverableDef, viewer: Viewer, now: Date) {
    const stored = await this.store.latest(d.id);
    if (!stored) return undefined;
    const { content: file, ...info } = stored;
    const t: TemplateInUse = { info, ...this.analyse(file, info.sha256) };
    const { values, unplaced } = this.values(t, s, d, viewer, now);
    const status = deliverableStatusLabel(d, deliverableStatus(s, this.model, d), hasAiDraft(s, d));
    const content = contentVersion(s, d);
    const bytes = fillTemplate(file, values, {
      title: `${t.title || d.name} – ${s.name}`,
      creator: "HERMES Helfer",
      description: `Erzeugt vom HERMES Helfer für ${s.code}. Status: ${status}. Inhalt: ${content}. Vorlage: ${info.fileName}, Version ${info.version}.`,
      modified: now.toISOString(),
    });
    return {
      bytes,
      fileName: safeFileName(`${s.code} ${d.name}.docx`, "dokument.docx"),
      template: info,
      contentVersion: content,
      report: this.report(t, values, unplaced),
    };
  }
}
