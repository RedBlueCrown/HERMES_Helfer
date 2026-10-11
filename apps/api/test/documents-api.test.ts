// The organisation's Word templates over HTTP: the PMO keeps them, agents draft
// their fields, and whoever may read a result downloads it as a Word document.

import { strFromU8, unzipSync } from "fflate";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { DOCX_MIME } from "../src/documents/docx";
import { docxFixture, empty, p, row, table } from "./docx-fixture";
import { testServer } from "./helpers";

type Server = Awaited<ReturnType<typeof testServer>>;
let server: Server | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
});

/** A Projektauftrag in the layout of the pilot's templates, with every kind of field. */
const AUFTRAG = docxFixture({
  body: [
    p("Projektauftrag", { style: "Title" }),
    table(
      row("Projektname"),
      row("Projektleitung"),
      row("Dokumentenstatus"),
      row("Datum"),
      row("Schutz- bzw. Vertraulichkeitsklasse"),
    ),
    p("1. Ausgangslage und Ziele", { style: "Heading1" }),
    p("Ausgangslage", { bold: true }),
    empty,
    p("Projektziele", { bold: true }),
    empty,
    p("2. Projektorganisation", { style: "Heading1" }),
    table(row("Fachvertretung"), row("Weitere Rollen und Zuständigkeiten")),
    p("3. Risiken und Qualität", { style: "Heading1" }),
    p("Risiken", { bold: true }),
    empty,
    p("4. Freigabe", { style: "Heading1" }),
    table(row("Freigabeentscheid"), row("Unterschrift")),
  ].join(""),
});
const AGENT_FIELDS = [
  "1. Ausgangslage und Ziele › Ausgangslage",
  "1. Ausgangslage und Ziele › Projektziele",
  "3. Risiken und Qualität › Risiken",
];

const upload = (
  s: Server,
  user: string,
  deliverableId: string,
  bytes: Uint8Array,
  name = "Vorlage Auftrag.docx",
) =>
  s.app.inject({
    method: "PUT",
    url: `/api/templates/${deliverableId}`,
    payload: Buffer.from(bytes),
    headers: { "x-dev-user": user, "content-type": DOCX_MIME, "x-file-name": encodeURIComponent(name) },
  });
const documentXml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)["word/document.xml"]!);
const auditLines = (lines: string[], type: string) =>
  lines.filter((l) => l.includes(`"type":"${type}"`)).map((l) => JSON.parse(l) as Record<string, unknown>);

describe("Word templates of the PMO", () => {
  it("keeps every version of a template, refuses unusable files and is for the PMO only", async () => {
    const lines: string[] = [];
    server = await testServer({
      logger: pino({ level: "info" }, { write: (l: string) => void lines.push(l) }),
    });

    expect((await upload(server, "u-anna", "auftrag", AUFTRAG)).statusCode).toBe(403);
    expect((await server.as("u-anna").get("/api/templates")).statusCode).toBe(403);
    expect((await upload(server, "u-peter", "gibt-es-nicht", AUFTRAG)).statusCode).toBe(404);

    const notWord = await upload(server, "u-peter", "auftrag", new TextEncoder().encode("kein Word"));
    expect(notWord.statusCode).toBe(400);
    expect(notWord.json().error).toMatchObject({
      code: "invalid_template",
      message: expect.stringMatching(/keine Word-Datei/),
    });
    const noFields = await upload(server, "u-peter", "auftrag", docxFixture({ body: p("Nur Text") }));
    expect(noFields.json().error.message).toMatch(/keine Felder/);
    // Up to 5 MB arrive (more than other requests may send), larger files are refused before reading.
    const big = new Uint8Array(4 * 1024 * 1024).fill(0x50);
    expect((await upload(server, "u-peter", "auftrag", big)).json().error.code).toBe("invalid_template");
    const tooBig = await upload(server, "u-peter", "auftrag", new Uint8Array(5 * 1024 * 1024 + 1));
    expect(tooBig.statusCode).toBe(413);
    const json = await server.as("u-peter").put("/api/templates/auftrag", { file: "x" });
    expect(json.statusCode).toBe(400);
    expect(json.json().error.message).toMatch(/Word-Datei/);

    const first = await upload(server, "u-peter", "auftrag", AUFTRAG);
    expect(first.statusCode).toBe(201);
    const kept = first.json();
    expect(kept).toMatchObject({
      deliverableId: "auftrag",
      version: 1,
      fileName: "Vorlage Auftrag.docx",
      title: "Projektauftrag",
      uploadedBy: { userId: "u-peter", displayName: "Peter Graf" },
    });
    expect(
      Object.fromEntries((kept.fields as { id: string; source: string }[]).map((f) => [f.id, f.source])),
    ).toEqual({
      "Deckblatt › Projektname": "engine",
      "Deckblatt › Projektleitung": "engine",
      "Deckblatt › Dokumentenstatus": "engine",
      "Deckblatt › Datum": "engine",
      "Deckblatt › Schutz- bzw. Vertraulichkeitsklasse": "person",
      [AGENT_FIELDS[0]!]: "agent",
      [AGENT_FIELDS[1]!]: "agent",
      "2. Projektorganisation › Fachvertretung": "engine",
      "2. Projektorganisation › Weitere Rollen und Zuständigkeiten": "engine",
      [AGENT_FIELDS[2]!]: "agent",
      "4. Freigabe › Freigabeentscheid": "person",
      "4. Freigabe › Unterschrift": "person",
    });

    const second = await upload(server, "u-peter", "auftrag", AUFTRAG, "Projektauftrag v2.docx");
    expect(second.json()).toMatchObject({ version: 2, fileName: "Projektauftrag v2.docx" });
    const items = (await server.as("u-peter").get("/api/templates")).json().items as {
      deliverableId: string;
      template?: { version: number };
      skill?: { id: string };
    }[];
    expect(items.find((i) => i.deliverableId === "auftrag")).toMatchObject({
      template: { version: 2 },
      skill: { id: "init.projektgrundlagen" },
    });
    expect(items.find((i) => i.deliverableId === "kickoff")?.template).toBeUndefined();

    const file = await server.as("u-peter").get("/api/templates/auftrag/file");
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-disposition"]).toContain("filename*=UTF-8''Projektauftrag%20v2.docx");
    expect(new Uint8Array(file.rawPayload)).toEqual(AUFTRAG);
    expect((await server.as("u-anna").get("/api/templates/auftrag/file")).statusCode).toBe(403);

    // The audit log names who kept which version, never the file's content.
    expect(auditLines(lines, "template_uploaded")).toEqual([
      expect.objectContaining({ deliverableId: "auftrag", version: 1, userId: "u-peter" }),
      expect.objectContaining({ deliverableId: "auftrag", version: 2, userId: "u-peter" }),
    ]);
  });
});

describe("a result as a Word document", () => {
  it("drafts along the template's fields and fills the document with facts and the draft", async () => {
    const lines: string[] = [];
    server = await testServer({
      logger: pino({ level: "info" }, { write: (l: string) => void lines.push(l) }),
    });
    const sha = (await upload(server, "u-peter", "auftrag", AUFTRAG)).json().sha256 as string;

    // Before the draft: the engine's facts are already in, the agent's fields are open.
    let detail = (await server.as("u-anna").get("/api/projects/KPO/deliverables/auftrag")).json();
    expect(detail.skills[0].sections).toEqual(AGENT_FIELDS);
    expect(detail.document).toMatchObject({
      template: { version: 1, fileName: "Vorlage Auftrag.docx", title: "Projektauftrag" },
      fields: 12,
      filled: 6,
      forPeople: 3,
      unplaced: [],
    });

    expect(
      (await server.as("u-anna").post("/api/projects/KPO/skills/init.projektgrundlagen/runs")).statusCode,
    ).toBe(202);
    await server.runs.idle();
    detail = (await server.as("u-anna").get("/api/projects/KPO/deliverables/auftrag")).json();
    const output = detail.skills[0].output;
    expect(output.draft.sections.map((s: { heading: string }) => s.heading)).toEqual(AGENT_FIELDS);
    expect(output.templates).toEqual([{ deliverableId: "auftrag", version: 1, sha256: sha }]);
    // Short findings only where the structure needs it: no «sehr knapp» for table cells.
    expect(output.findings.filter((f: { text: string }) => /fehlt/.test(f.text))).toEqual([]);
    expect(detail.document).toMatchObject({ filled: 9, unplaced: [] });
    // The Projektmanagementplan shares the skill: its draft has the same fields, but no document.
    const pmp = (await server.as("u-anna").get("/api/projects/KPO/deliverables/pmp")).json();
    expect(pmp.skills[0].sections).toEqual(AGENT_FIELDS);
    expect(pmp.document).toBeUndefined();

    const res = await server.as("u-anna").get("/api/projects/KPO/deliverables/auftrag/document");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe(DOCX_MIME);
    expect(res.headers["content-disposition"]).toBe(
      `attachment; filename="KPO Projektauftrag.docx"; filename*=UTF-8''KPO%20Projektauftrag.docx`,
    );
    expect(res.headers["cache-control"]).toBe("no-store");
    const xml = documentXml(new Uint8Array(res.rawPayload));
    for (const text of [
      "Kundenportal Self-Service",
      "Anna Keller",
      "Entwurf (KI)",
      "Nina Huber",
      "Business Analyse: Jonas Wyss",
      "Auftraggeber / Projektausschuss: Thomas Meier",
      "Ausgangslage für «Kundenportal Self-Service»",
      "Risiken für «Kundenportal Self-Service»",
    ]) {
      expect(xml).toContain(text);
    }
    // Roles with a field of their own are not repeated under «Weitere Rollen».
    expect(xml).not.toContain("Projektleitung: Anna Keller");
    const core = strFromU8(unzipSync(new Uint8Array(res.rawPayload))["docProps/core.xml"]!);
    expect(core).toContain("<dc:title>Projektauftrag – Kundenportal Self-Service</dc:title>");
    expect(core).toContain("Status: Entwurf (KI)");

    const [audit] = auditLines(lines, "document_export");
    expect(audit).toMatchObject({
      deliverableId: "auftrag",
      templateVersion: 1,
      templateSha256: sha,
      contentVersion: "init.projektgrundlagen@1",
      userId: "u-anna",
    });
    expect(JSON.stringify(audit)).not.toContain("Kundenportal");
  });

  it("fills what fits from a draft written before the template and names the rest", async () => {
    server = await testServer();
    await server.as("u-anna").post("/api/projects/KPO/skills/init.projektgrundlagen/runs");
    await server.runs.idle();
    await upload(server, "u-peter", "auftrag", AUFTRAG);
    const detail = (await server.as("u-anna").get("/api/projects/KPO/deliverables/auftrag")).json();
    // «Risiken» of the model's sections fits the field of that name.
    expect(detail.document).toMatchObject({
      filled: 7,
      unplaced: [
        "Ausgangslage und Ziele",
        "Lieferobjekte und Abgrenzung",
        "Projektorganisation",
        "Vorgehen und Meilensteine",
        "Kosten und Ressourcen",
        "Qualitätssicherung",
      ],
    });
  });

  it("gives a restricted result's document only to who may read the result", async () => {
    server = await testServer();
    await upload(server, "u-peter", "isds", docxFixture(), "ISDS.docx");
    const get = (user: string) => server!.as(user).get("/api/projects/CRM/deliverables/isds/document");
    expect((await get("u-marco")).statusCode).toBe(200); // ISM
    expect((await get("u-tim")).statusCode).toBe(200); // Infrastruktur works on it
    const nina = await get("u-nina"); // Fachvertretung
    expect(nina.statusCode).toBe(403);
    expect(nina.json().error.message).toMatch(/vertraulich/);
    expect((await get("u-peter")).statusCode).toBe(403); // the PMO without a role in the project
    expect((await get("u-rita")).statusCode).toBe(403);
    const detail = (await server.as("u-nina").get("/api/projects/CRM/deliverables/isds")).json();
    expect(detail.contentVisible).toBe(false);
    expect(detail.document).toBeUndefined();

    const none = await server.as("u-anna").get("/api/projects/KPO/deliverables/kickoff/document");
    expect(none.statusCode).toBe(404);
    expect(none.json().error.message).toMatch(/noch keine Vorlage/);
  });
});
