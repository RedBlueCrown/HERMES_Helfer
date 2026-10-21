import { describe, expect, it } from "vitest";
import { MODEL, chunks, knowledgePassages, searchPassages, terms, type Passage } from "../src";
import { Stream, viewer } from "./helpers";

const passage = (projectCode: string, title: string, text: string): Passage => ({
  key: `${projectCode}:${title}`,
  projectCode,
  projectName: `Vorhaben ${projectCode}`,
  kind: "ergebnis",
  title,
  text,
});

describe("knowledge across projects (A13)", () => {
  it("builds passages only from what the person may read", () => {
    const st = new Stream("konzept").member("u-pl", "PL").member("u-ds", "DS");
    st.add({
      type: "MinutesRecorded",
      data: {
        minutesId: "m1",
        number: 1,
        title: "Projektsitzung",
        heldOn: "2026-10-14",
        decisions: [{ id: "d1", text: "Variante B wird umgesetzt." }],
        actions: [{ id: "a1", text: "Offerte einholen", ownerName: "Einkauf", due: "2026-10-30" }],
        questions: [],
        producer: { kind: "human" },
      },
    });
    const s = st.state();
    const pl = knowledgePassages([s], MODEL, viewer("u-pl"));
    expect(pl.map((p) => p.kind).sort()).toEqual(["entscheid", "pendenz", "rollen"]);
    expect(pl.find((p) => p.kind === "pendenz")!.text).toBe(
      "Offerte einholen, verantwortlich Einkauf, bis 30.10.2026",
    );
    expect(pl.find((p) => p.kind === "rollen")!.text).toMatch(/Projektleitung: u-pl/);
    // Not a member, no global role: nothing.
    expect(knowledgePassages([s], MODEL, viewer("u-fremd"))).toEqual([]);
    // The PMO sees the project.
    expect(knowledgePassages([s], MODEL, viewer("u-pmo", "HH.PMO")).length).toBe(pl.length);
  });

  it("splits long text at sentence ends into parts of limited size", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Satz Nummer ${i} mit etwas Inhalt.`).join(" ");
    const parts = chunks(text, 200);
    expect(parts.length).toBeGreaterThan(4);
    expect(parts.every((p) => p.length <= 200)).toBe(true);
    expect(parts.join(" ")).toBe(text);
    expect(chunks("x".repeat(450), 200)).toHaveLength(3);
  });

  it("finds the passages that answer the question, also by word beginnings", () => {
    const passages = [
      passage(
        "KPO",
        "Projektauftrag › Ausgangslage",
        "Das Kundenportal ersetzt das Formular für Adressänderungen.",
      ),
      passage(
        "CRM",
        "Projektschlussbeurteilung › Lessons Learned",
        "Mit externen Lieferanten früh die Abnahmekriterien vereinbaren.",
      ),
      passage("ERP", "Testkonzept › Teststufen", "Integrationstest mit dem Lieferantenportal im Juni."),
      passage("INT", "Rollen im Vorhaben", "Projektleitung: Anna Keller; Architektur: David Weber."),
    ];
    const hits = searchPassages(passages, "Welche Erfahrungen gibt es mit Lieferanten?");
    expect(hits.map((p) => p.projectCode)).toEqual(["CRM", "ERP"]);
    // «Lessons Learned» in the title counts; the project code too.
    expect(searchPassages(passages, "lessons learned")[0]!.projectCode).toBe("CRM");
    expect(searchPassages(passages, "Wer leitet INT?")[0]!.projectCode).toBe("INT");
    expect(searchPassages(passages, "Wie ist das Wetter?")).toEqual([]);
    expect(terms("Für die Änderungen der Adresse")).toEqual(["anderungen", "adresse"]);
  });

  it("takes at most three passages of one document", () => {
    const long = Array.from({ length: 6 }, (_, i) =>
      passage("KPO", "Testkonzept › Teststufen", `Teststufe ${i}: Lieferanten testen ihre Schnittstelle.`),
    );
    const other = passage("CRM", "Lieferantenmanagement", "Lieferanten liefern Testdaten.");
    const hits = searchPassages([...long, other], "Lieferanten Schnittstelle testen");
    expect(hits.filter((p) => p.projectCode === "KPO")).toHaveLength(3);
    expect(hits.some((p) => p.projectCode === "CRM")).toBe(true);
  });
});
