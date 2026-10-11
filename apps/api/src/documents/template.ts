// Word templates of the organisation: which fields a template has, and the
// template filled with a document's content (todo-later P02).
//
// A template needs no special markup. The fields are found from its layout:
// - a chapter is a paragraph in the style «heading 1»;
// - a text field is a label (bold, or a heading of level 2 or more) followed by
//   an empty paragraph, the place for the text; a chapter heading followed
//   directly by an empty paragraph is a text field of its own;
// - a cell field is a table row of two cells: a label and an empty cell.
// Everything else in the template stays as it is.

import type { Document as XmlDocument, Element, Node } from "@xmldom/xmldom";
import { DocxError, W_NS, XML_NS, partXml, readDocx, serializeXml, writeDocx } from "./docx";

export interface TemplateField {
  /** «1. Ausgangslage und Handlungsbedarf › Ausgangslage»: unique in the template. */
  id: string;
  /** The chapter the field is in; «Deckblatt» before the first chapter. */
  chapter: string;
  label: string;
  /** "text": paragraphs below a label. "cell": the empty cell of a table row. */
  kind: "text" | "cell";
}

export interface TemplateLayout {
  /** The text in the style «Title», e.g. «Projektauftrag». */
  title: string;
  fields: TemplateField[];
}

export const COVER = "Deckblatt";

const ELEMENT = 1;

const children = (el: Element | Node): Element[] => {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === ELEMENT) out.push(n as Element);
  return out;
};
const child = (el: Element, name: string) => children(el).find((c) => c.localName === name);
const descendants = (el: Element, name: string): Element[] =>
  Array.from(el.getElementsByTagNameNS(W_NS, name));
const val = (el: Element | undefined) => el?.getAttributeNS(W_NS, "val") ?? undefined;

/** The visible text of a paragraph or cell. */
function textOf(el: Element): string {
  let out = "";
  for (const n of Array.from(el.getElementsByTagNameNS(W_NS, "*"))) {
    if (n.localName === "t") out += n.textContent ?? "";
    else if (n.localName === "tab") out += "\t";
  }
  return out;
}

/** Headings, the title and bold paragraph styles of the template (styles.xml). */
interface Styles {
  level: Map<string, number>;
  title: Set<string>;
  bold: Set<string>;
  listBullet?: string;
}

function readStyles(doc: XmlDocument | undefined): Styles {
  const styles: Styles = { level: new Map(), title: new Set(), bold: new Set() };
  if (!doc) return styles;
  for (const s of descendants(doc.documentElement!, "style")) {
    if (s.getAttributeNS(W_NS, "type") !== "paragraph") continue;
    const id = s.getAttributeNS(W_NS, "styleId") ?? "";
    const name = (val(child(s, "name")) ?? "").toLowerCase();
    const heading = /^heading (\d)$/.exec(name);
    const outline = val(child(child(s, "pPr") ?? s, "outlineLvl"));
    if (heading) styles.level.set(id, Number(heading[1]));
    else if (outline !== undefined && /^\d$/.test(outline)) styles.level.set(id, Number(outline) + 1);
    if (name === "title") styles.title.add(id);
    if (name === "list bullet") styles.listBullet = id;
    const b = child(child(s, "rPr") ?? s, "b");
    if (b && !["0", "false", "off"].includes(val(b) ?? "")) styles.bold.add(id);
  }
  return styles;
}

const styleOf = (p: Element) => val(child(child(p, "pPr") ?? p, "pStyle"));

/** 0: the title; 1, 2 …: a heading of that level; undefined: body text. */
function headingLevel(p: Element, styles: Styles): number | undefined {
  const id = styleOf(p);
  if (!id) return undefined;
  if (styles.title.has(id)) return 0;
  return styles.level.get(id);
}

/** Every run with text is bold, directly or through the paragraph's style. */
function isBold(p: Element, styles: Styles): boolean {
  const styleBold = styles.bold.has(styleOf(p) ?? "");
  const runs = descendants(p, "r").filter((r) =>
    descendants(r, "t").some((t) => (t.textContent ?? "").trim()),
  );
  if (!runs.length) return false;
  return runs.every((r) => {
    const b = child(child(r, "rPr") ?? r, "b");
    if (!b) return styleBold;
    return !["0", "false", "off"].includes(val(b) ?? "");
  });
}

/** No text and nothing else to see: the place a template leaves for content. */
function isEmpty(p: Element): boolean {
  if (textOf(p).trim()) return false;
  return !["drawing", "pict", "object", "fldSimple", "instrText"].some((n) => descendants(p, n).length);
}

interface Located extends TemplateField {
  /** The paragraph that the content replaces. */
  target: Element;
}

function locate(doc: XmlDocument, styles: Styles): { title: string; fields: Located[] } {
  const body = child(doc.documentElement!, "body");
  if (!body) throw new DocxError("Die Vorlage hat keinen Inhalt.");
  let chapter = COVER;
  let title = "";
  const fields: Omit<Located, "id">[] = [];
  const kids = children(body);
  const emptyNext = (i: number) => {
    const next = kids[i + 1];
    return next?.localName === "p" && isEmpty(next) && headingLevel(next, styles) === undefined
      ? next
      : undefined;
  };
  for (const [i, el] of kids.entries()) {
    if (el.localName === "p") {
      const level = headingLevel(el, styles);
      const text = textOf(el).replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (level === 0) {
        title ||= text;
        continue;
      }
      if (level === 1) chapter = text;
      if (level !== undefined || (isBold(el, styles) && text.length <= 160)) {
        const target = emptyNext(i);
        if (target) fields.push({ chapter, label: text, kind: "text", target });
      }
    } else if (el.localName === "tbl") {
      for (const row of children(el).filter((r) => r.localName === "tr")) {
        const cells = children(row).filter((c) => c.localName === "tc");
        if (cells.length !== 2) continue;
        const label = textOf(cells[0]!).replace(/\s+/g, " ").trim();
        const target = child(cells[1]!, "p");
        if (!label || !target || textOf(cells[1]!).trim()) continue;
        fields.push({ chapter, label, kind: "cell", target });
      }
    }
  }
  const seen = new Map<string, number>();
  return {
    title,
    fields: fields.map((f) => {
      const base = f.label === f.chapter ? f.chapter : `${f.chapter} › ${f.label}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return { ...f, id: n === 1 ? base : `${base} (${n})` };
    }),
  };
}

/** The fields of a template. Refuses files that are not Word files or have no field. */
export function analyzeTemplate(bytes: Uint8Array): TemplateLayout {
  const pkg = readDocx(bytes);
  const doc = partXml(pkg, "word/document.xml")!;
  const { title, fields } = locate(doc, readStyles(partXml(pkg, "word/styles.xml")));
  if (!fields.length) {
    throw new DocxError(
      "In der Vorlage sind keine Felder zu erkennen: Kapitel als «Überschrift 1», darunter fette Bezeichnungen mit einem leeren Absatz oder Tabellen mit zwei Spalten.",
    );
  }
  return { title, fields: fields.map(({ id, chapter, label, kind }) => ({ id, chapter, label, kind })) };
}

/** How field ids and draft headings are compared: case and spacing do not matter. */
export const fieldKey = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Without the characters XML 1.0 does not allow: control characters, U+FFFE and U+FFFF. */
const xmlSafe = (s: string) =>
  Array.from(s)
    .filter((ch) => {
      const c = ch.codePointAt(0)!;
      return c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c !== 0xfffe && c !== 0xffff);
    })
    .join("");

/** The paragraphs of a value: one per line; «- » or «• » starts a bullet. */
function lines(value: string): { text: string; bullet: boolean }[] {
  return xmlSafe(value)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const bullet = /^[-•*–]\s+/.test(l);
      return { text: bullet ? l.replace(/^[-•*–]\s+/, "") : l, bullet };
    });
}

function fill(doc: XmlDocument, target: Element, value: string, styles: Styles, keepRunFormat: boolean) {
  const paragraphs = lines(value);
  if (!paragraphs.length) return;
  const parent = target.parentNode!;
  const pPr = child(target, "pPr");
  const rPr = keepRunFormat ? descendants(target, "rPr")[0] : undefined;
  for (const line of paragraphs) {
    const p = doc.createElementNS(W_NS, "w:p");
    const props = pPr ? (pPr.cloneNode(true) as Element) : doc.createElementNS(W_NS, "w:pPr");
    if (line.bullet && styles.listBullet) {
      for (const old of children(props).filter((c) => c.localName === "pStyle")) props.removeChild(old);
      const style = doc.createElementNS(W_NS, "w:pStyle");
      style.setAttributeNS(W_NS, "w:val", styles.listBullet);
      props.insertBefore(style, props.firstChild);
    }
    if (props.firstChild) p.appendChild(props);
    const r = doc.createElementNS(W_NS, "w:r");
    if (rPr) r.appendChild(rPr.cloneNode(true));
    const t = doc.createElementNS(W_NS, "w:t");
    t.setAttributeNS(XML_NS, "xml:space", "preserve");
    t.appendChild(doc.createTextNode(line.bullet && !styles.listBullet ? `– ${line.text}` : line.text));
    r.appendChild(t);
    p.appendChild(r);
    parent.insertBefore(p, target);
  }
  parent.removeChild(target);
}

export interface DocumentProperties {
  title: string;
  /** Who or what wrote it, e.g. «HERMES Helfer». */
  creator: string;
  description: string;
  /** ISO time. */
  modified: string;
}

const DC = "http://purl.org/dc/elements/1.1/";
const DCTERMS = "http://purl.org/dc/terms/";
const CP = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";

function setProperties(doc: XmlDocument, props: DocumentProperties) {
  const root = doc.documentElement!;
  const set = (ns: string, qname: string, value: string) => {
    const local = qname.split(":")[1]!;
    let el = Array.from(root.getElementsByTagNameNS(ns, local))[0];
    if (!el) {
      el = doc.createElementNS(ns, qname);
      root.appendChild(el);
    }
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(doc.createTextNode(xmlSafe(value)));
  };
  set(DC, "dc:title", props.title);
  set(DC, "dc:creator", props.creator);
  set(CP, "cp:lastModifiedBy", props.creator);
  set(DC, "dc:description", props.description);
  set(DCTERMS, "dcterms:modified", props.modified.replace(/\.\d+Z$/, "Z"));
}

/**
 * The template with values in its fields, as a .docx. `values` is keyed by
 * field id (fieldKey); fields without a value keep the template's empty place.
 */
export function fillTemplate(
  bytes: Uint8Array,
  values: ReadonlyMap<string, string>,
  props: DocumentProperties,
): Uint8Array {
  const pkg = readDocx(bytes);
  const doc = partXml(pkg, "word/document.xml")!;
  const styles = readStyles(partXml(pkg, "word/styles.xml"));
  for (const f of locate(doc, styles).fields) {
    const value = values.get(fieldKey(f.id));
    if (value?.trim()) fill(doc, f.target, value, styles, f.kind === "cell");
  }
  const replaced: Record<string, string> = { "word/document.xml": serializeXml(doc) };
  const core = partXml(pkg, "docProps/core.xml");
  if (core) {
    setProperties(core, props);
    replaced["docProps/core.xml"] = serializeXml(core);
  }
  return writeDocx(pkg, replaced);
}
