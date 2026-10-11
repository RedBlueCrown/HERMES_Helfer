// Word files (.docx, .dotx): reading a package safely, its XML parts, and
// writing it back. A .docx is a ZIP of XML parts. Templates come from people
// (the PMO uploads them), so a package is checked before anything is parsed:
// size limits against zip bombs, no macros, no document type definitions.

import { DOMParser, XMLSerializer, type Document as XmlDocument } from "@xmldom/xmldom";
import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from "fflate";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const XML_NS = "http://www.w3.org/XML/1998/namespace";

export const DOCX_LIMITS = {
  /** The upload. */
  fileBytes: 5 * 1024 * 1024,
  /** All parts unpacked. */
  unpackedBytes: 40 * 1024 * 1024,
  entries: 300,
} as const;

/** A file that is not a usable Word file; the message is for the person who uploaded it. */
export class DocxError extends Error {}

export interface DocxPackage {
  /** The parts by name, unpacked. */
  parts: Unzipped;
  /** Part names in the order of the archive, so a written file keeps it. */
  order: string[];
  /** A template (.dotx) rather than a document. */
  template: boolean;
}

const MAIN_DOCUMENT = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const MAIN_TEMPLATE = "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml";

export function readDocx(bytes: Uint8Array): DocxPackage {
  if (bytes.length > DOCX_LIMITS.fileBytes) throw new DocxError("Die Datei ist grösser als 5 MB.");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new DocxError("Das ist keine Word-Datei (.docx).");
  const order: string[] = [];
  let declared = 0;
  let parts: Unzipped;
  try {
    parts = unzipSync(bytes, {
      filter: (f) => {
        declared += f.originalSize;
        order.push(f.name);
        if (order.length > DOCX_LIMITS.entries || declared > DOCX_LIMITS.unpackedBytes) {
          throw new DocxError("Die Datei ist entpackt zu gross.");
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof DocxError) throw err;
    throw new DocxError("Die Datei lässt sich nicht öffnen. Ist es eine Word-Datei (.docx)?");
  }
  // Declared sizes can lie: count what was unpacked.
  const unpacked = Object.values(parts).reduce((n, p) => n + p.length, 0);
  if (unpacked > DOCX_LIMITS.unpackedBytes) throw new DocxError("Die Datei ist entpackt zu gross.");
  if (order.some((name) => name.startsWith("/") || name.split("/").includes(".."))) {
    throw new DocxError("Die Datei enthält ungültige Pfade.");
  }
  const types = parts["[Content_Types].xml"];
  if (!types || !parts["word/document.xml"]) throw new DocxError("Das ist keine Word-Datei (.docx).");
  const typesXml = strFromU8(types);
  if (/macroEnabled|vbaProject/i.test(typesXml) || order.some((n) => /vbaproject/i.test(n))) {
    throw new DocxError("Dateien mit Makros (.docm, .dotm) sind nicht erlaubt.");
  }
  return { parts, order, template: typesXml.includes(MAIN_TEMPLATE) };
}

/** A part as XML. Refuses document type definitions (entity expansion). */
export function parseXml(xml: string, part: string): XmlDocument {
  if (/<!DOCTYPE/i.test(xml)) throw new DocxError(`${part}: Dokumenttyp-Definitionen sind nicht erlaubt.`);
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") errors.push(message);
    },
  }).parseFromString(xml, "text/xml");
  if (errors.length) throw new DocxError(`${part} ist kein gültiges XML.`);
  return doc;
}

export function partXml(pkg: DocxPackage, part: string): XmlDocument | undefined {
  const bytes = pkg.parts[part];
  return bytes ? parseXml(strFromU8(bytes), part) : undefined;
}

export const serializeXml = (doc: XmlDocument): string => new XMLSerializer().serializeToString(doc);

/** The package with some parts replaced, as a .docx (a .dotx becomes a document). */
export function writeDocx(pkg: DocxPackage, replaced: Readonly<Record<string, string>>): Uint8Array {
  const out: Record<string, Uint8Array> = {};
  for (const name of pkg.order) {
    let bytes = name in replaced ? strToU8(replaced[name]!) : pkg.parts[name]!;
    if (name === "[Content_Types].xml" && pkg.template && !(name in replaced)) {
      bytes = strToU8(strFromU8(bytes).replace(MAIN_TEMPLATE, MAIN_DOCUMENT));
    }
    out[name] = bytes;
  }
  return zipSync(out, { level: 6 });
}
