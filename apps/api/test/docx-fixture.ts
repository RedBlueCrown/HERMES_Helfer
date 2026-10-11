// A small Word template for tests, built in code: the organisation's own
// templates do not belong in the repository. It has the layout the templates
// of the pilot use: a title, a cover table, chapters in «heading 1», bold
// labels with an empty paragraph below, and a two-column table.

import { strToU8, zipSync } from "fflate";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`;

export const p = (text: string, opts: { style?: string; bold?: boolean } = {}) =>
  `<w:p>${opts.style ? `<w:pPr><w:pStyle w:val="${opts.style}"/></w:pPr>` : ""}<w:r>${
    opts.bold ? "<w:rPr><w:b/></w:rPr>" : ""
  }<w:t>${text}</w:t></w:r></w:p>`;
export const empty = '<w:p><w:pPr><w:spacing w:after="160"/></w:pPr><w:r><w:br/></w:r></w:p>';
export const row = (label: string, value = "") =>
  `<w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${label}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:rPr><w:sz w:val="18"/></w:rPr>${
    value ? `<w:t>${value}</w:t>` : "<w:br/>"
  }</w:r></w:p></w:tc></w:tr>`;
export const table = (...rows: string[]) =>
  `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="6000"/></w:tblGrid>${rows.join("")}</w:tbl>`;

export const FIXTURE_BODY = [
  p("Testauftrag", { style: "Title" }),
  p("Vorlage für Tests"),
  table(row("Projektname"), row("Datum"), row("Ablage", "Projektraum")),
  p("1. Ausgangslage", { style: "Heading1" }),
  p("Ausgangslage", { bold: true }),
  empty,
  p("Handlungsbedarf", { bold: true }),
  empty,
  p("2. Ziele", { style: "Heading1" }),
  empty,
  p("3. Freigabe", { style: "Heading1" }),
  table(row("Freigabeentscheid"), row("Unterschrift")),
].join("");

const STYLES = xml(
  `<w:styles ${W}>` +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/></w:style>' +
    "</w:styles>",
);

/** The test template as a .docx, or with other parts (`content type` of the main part, a body, extras). */
export function docxFixture(
  opts: { body?: string; mainType?: string; extra?: Record<string, string> } = {},
): Uint8Array {
  const mainType =
    opts.mainType ?? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
  const parts: Record<string, string> = {
    "[Content_Types].xml": xml(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/word/document.xml" ContentType="${mainType}"/>` +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        "</Types>",
    ),
    "_rels/.rels": xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        "</Relationships>",
    ),
    "word/_rels/document.xml.rels": xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>",
    ),
    "word/document.xml": xml(
      `<w:document ${W}><w:body>${opts.body ?? FIXTURE_BODY}<w:sectPr/></w:body></w:document>`,
    ),
    "word/styles.xml": STYLES,
    "docProps/core.xml": xml(
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title/><dc:creator>Vorlage</dc:creator><dcterms:modified xsi:type="dcterms:W3CDTF">2020-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>',
    ),
    ...opts.extra,
  };
  return zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])));
}
