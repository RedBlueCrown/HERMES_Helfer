import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DocxError } from "../src/documents/docx";
import { swissDate, withSources } from "../src/documents/facts";
import { attachment } from "../src/documents/routes";
import { safeFileName } from "../src/documents/service";
import {
  COVER,
  analyzeTemplate,
  fieldKey,
  fillTemplate,
  type TemplateField,
} from "../src/documents/template";
import { FIXTURE_BODY, docxFixture } from "./docx-fixture";

const props = {
  title: "Testauftrag · Kundenportal",
  creator: "HERMES Helfer",
  description: "Entwurf (KI)",
  modified: "2026-10-11T12:00:00.000Z",
};
const documentXml = (docx: Uint8Array) => strFromU8(unzipSync(docx)["word/document.xml"]!);
const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
/** The paragraphs' texts in order, one string per paragraph. */
const paragraphs = (xml: string) =>
  [...xml.matchAll(/<w:p[ >].*?<\/w:p>/gs)].map((m) =>
    decode([...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("")),
  );

describe("Word templates: the fields", () => {
  it("finds chapters, labels with an empty paragraph, and table rows with an empty cell", () => {
    const layout = analyzeTemplate(docxFixture());
    expect(layout.title).toBe("Testauftrag");
    expect(layout.fields).toEqual([
      { id: "Deckblatt › Projektname", chapter: "Deckblatt", label: "Projektname", kind: "cell" },
      { id: "Deckblatt › Datum", chapter: "Deckblatt", label: "Datum", kind: "cell" },
      {
        id: "1. Ausgangslage › Ausgangslage",
        chapter: "1. Ausgangslage",
        label: "Ausgangslage",
        kind: "text",
      },
      {
        id: "1. Ausgangslage › Handlungsbedarf",
        chapter: "1. Ausgangslage",
        label: "Handlungsbedarf",
        kind: "text",
      },
      // A chapter without labels is a field of its own.
      { id: "2. Ziele", chapter: "2. Ziele", label: "2. Ziele", kind: "text" },
      {
        id: "3. Freigabe › Freigabeentscheid",
        chapter: "3. Freigabe",
        label: "Freigabeentscheid",
        kind: "cell",
      },
      { id: "3. Freigabe › Unterschrift", chapter: "3. Freigabe", label: "Unterschrift", kind: "cell" },
    ]);
  });

  it("refuses files that are not usable Word templates, with a reason for the person", () => {
    const refuses = (bytes: Uint8Array, reason: RegExp) => {
      expect(() => analyzeTemplate(bytes)).toThrow(DocxError);
      expect(() => analyzeTemplate(bytes)).toThrow(reason);
    };
    refuses(strToU8("kein Word"), /keine Word-Datei/);
    refuses(zipSync({ "a.txt": strToU8("x") }), /keine Word-Datei/);
    refuses(docxFixture({ mainType: "application/vnd.ms-word.document.macroEnabled.main+xml" }), /Makros/);
    refuses(docxFixture({ extra: { "word/vbaProject.bin": "x" } }), /Makros/);
    refuses(docxFixture({ body: `<!DOCTYPE x>${FIXTURE_BODY}` }), /kein gültiges XML|Dokumenttyp/);
    refuses(docxFixture({ body: "<w:p><w:r><w:t>Nur Text</w:t></w:r></w:p>" }), /keine Felder/);
    refuses(new Uint8Array(6 * 1024 * 1024).fill(0x50), /grösser als 5 MB/);
  });
});

describe("Word templates: filled", () => {
  it("puts each value in its field and leaves the rest of the template as it is", () => {
    const values = new Map(
      Object.entries({
        "Deckblatt › Projektname": "Kundenportal Self-Service",
        "1. Ausgangslage › Ausgangslage": "Erster Absatz.\nZweiter Absatz mit «Zeichen» & <Klammern>.",
        "1. Ausgangslage › Handlungsbedarf": "- Erstens\n- Zweitens",
        "2. Ziele": "Anliegen online erfassen.",
        // Signatures stay for people: a value the template has no field for is ignored.
        "Ein Feld, das es nicht gibt": "nichts",
      }).map(([k, v]) => [fieldKey(k), v]),
    );
    const out = fillTemplate(docxFixture(), values, props);
    const xml = documentXml(out);
    expect(paragraphs(xml)).toEqual([
      "Testauftrag",
      "Vorlage für Tests",
      "Projektname",
      "Kundenportal Self-Service",
      "Datum",
      "",
      "Ablage",
      "Projektraum",
      "1. Ausgangslage",
      "Ausgangslage",
      "Erster Absatz.",
      "Zweiter Absatz mit «Zeichen» & <Klammern>.",
      "Handlungsbedarf",
      "Erstens",
      "Zweitens",
      "2. Ziele",
      "Anliegen online erfassen.",
      "3. Freigabe",
      "Freigabeentscheid",
      "",
      "Unterschrift",
      "",
    ]);
    // Bullets use the template's list style; the cell keeps the template's run format.
    expect(xml).toContain('<w:pStyle w:val="ListBullet"/>');
    expect(xml).toMatch(/<w:sz w:val="18"\/><\/w:rPr><w:t xml:space="preserve">Kundenportal Self-Service/);
    expect(xml).toContain("&amp; &lt;Klammern&gt;");
    const core = strFromU8(unzipSync(out)["docProps/core.xml"]!);
    expect(core).toContain("<dc:title>Testauftrag · Kundenportal</dc:title>");
    expect(core).toContain("2026-10-11T12:00:00Z");
    // The result is again a template the app can read.
    expect(analyzeTemplate(out).fields.map((f) => f.id)).toContain("Deckblatt › Datum");
  });

  it("turns a Word template (.dotx) into a document", () => {
    const dotx = docxFixture({
      mainType: "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml",
    });
    const types = strFromU8(unzipSync(fillTemplate(dotx, new Map(), props))["[Content_Types].xml"]!);
    expect(types).toContain("wordprocessingml.document.main+xml");
    expect(types).not.toContain("template.main+xml");
  });
});

describe("Word templates: where a field's content comes from", () => {
  const field = (chapter: string, label: string, kind: TemplateField["kind"] = "cell"): TemplateField => ({
    id: `${chapter} › ${label}`,
    chapter,
    label,
    kind,
  });
  const source = (f: TemplateField) => withSources([f])[0]!;

  it("takes facts from the app, signatures from people and the rest from the agent", () => {
    expect(source(field(COVER, "Projektname"))).toMatchObject({
      source: "engine",
      fact: "Name des Vorhabens",
    });
    expect(source(field(COVER, "Projektleitung")).fact).toBe("Personen mit der Rolle «Projektleitung»");
    expect(source(field("6. Organisation", "IT- und Lösungsvertretung")).fact).toBe(
      "Personen mit der Rolle «Architektur» und «Infrastruktur / Technische Koordination»",
    );
    // Document facts only on the cover: «Datum» in a chapter is the agent's.
    expect(source(field("2. Verzeichnis", "Datum")).source).toBe("agent");
    // Approvals are people's, even where a role's name stands.
    expect(source(field("10. Freigabe", "Projektleitung")).source).toBe("person");
    expect(source(field(COVER, "Schutz- bzw. Vertraulichkeitsklasse")).source).toBe("person");
    expect(source(field("9. Abnahme", "Ort und Datum")).source).toBe("person");
    expect(source(field("9. Überprüfung, Tests und Abnahme", "Abnahme und Freigabe", "text")).source).toBe(
      "agent",
    );
  });

  it("writes dates the Swiss way and file names that are safe everywhere", () => {
    expect(swissDate("2026-10-11T23:30:00.000Z")).toBe("12.10.2026");
    expect(safeFileName("C:\\Temp\\Vorlage: «Auftrag»?.docx", "x.docx")).toBe("Vorlage «Auftrag».docx");
    expect(safeFileName("..", "x.docx")).toBe("x.docx");
    expect(attachment("KPO Einführungskonzept.docx")).toBe(
      `attachment; filename="KPO Einfuhrungskonzept.docx"; filename*=UTF-8''KPO%20Einf%C3%BChrungskonzept.docx`,
    );
  });
});

// The organisation's templates are not in the repository; set HH_TEMPLATE_DIR to a folder with them.
const dir = process.env.HH_TEMPLATE_DIR;
const real = (name: string) => (dir ? join(dir, name) : "");

describe.skipIf(!dir || !existsSync(real("projektauftrag.docx")))("the pilot's templates (local)", () => {
  it("finds every field of the Projektauftrag and the ISDS-Konzept", () => {
    const pa = analyzeTemplate(readFileSync(real("projektauftrag.docx")));
    expect([pa.title, pa.fields.length]).toEqual(["Projektauftrag", 43]);
    const isds = analyzeTemplate(readFileSync(real("isds.docx")));
    expect([isds.title, isds.fields.length]).toEqual(["ISDS-Konzept", 79]);
    expect(isds.fields.filter((f) => f.kind === "text")).toHaveLength(59);
    const sources = (fields: readonly TemplateField[]) =>
      withSources(fields).reduce<Record<string, number>>(
        (n, f) => ({ ...n, [f.source]: (n[f.source] ?? 0) + 1 }),
        {},
      );
    expect(sources(pa.fields)).toEqual({ engine: 13, agent: 25, person: 5 });
    expect(sources(isds.fields)).toEqual({ engine: 6, agent: 65, person: 8 });
  });
});
