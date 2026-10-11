import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { readFileSync } from "node:fs";
// The organisation's own templates do not belong in the repository: a small one built in code.
import { docxFixture, empty, p, row, table } from "../../api/test/docx-fixture";
import { shot, signInAs } from "./helpers";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TEMPLATE = docxFixture({
  body: [
    p("Projektauftrag", { style: "Title" }),
    table(row("Projektname"), row("Projektleitung"), row("Dokumentenstatus"), row("Datum")),
    p("1. Ausgangslage und Ziele", { style: "Heading1" }),
    p("Ausgangslage", { bold: true }),
    empty,
    p("Projektziele", { bold: true }),
    empty,
    p("2. Projektorganisation", { style: "Heading1" }),
    table(row("Fachvertretung"), row("Weitere Rollen und Zuständigkeiten")),
    p("3. Freigabe", { style: "Heading1" }),
    table(row("Freigabeentscheid"), row("Unterschrift")),
  ].join(""),
});

test("PMO keeps a Word template; the PL drafts along it and downloads the document", async ({ page }) => {
  await signInAs(page, "u-peter");
  await page.goto("/");
  await page.getByRole("link", { name: "Vorlagen" }).click();
  await expect(page.getByRole("heading", { name: "Vorlagen" })).toBeVisible();
  const auftrag = page.locator('[data-template="auftrag"]');
  await expect(auftrag).toContainText("keine");
  await auftrag.getByRole("button", { name: "Projektauftrag" }).click();

  const drawer = page.getByRole("dialog");
  await drawer
    .getByLabel("Word-Vorlage wählen")
    .setInputFiles({ name: "Projektauftrag Vorlage.docx", mimeType: DOCX, buffer: Buffer.from(TEMPLATE) });
  await expect(drawer).toContainText("«Projektauftrag Vorlage.docx», Version 1");
  await expect(drawer).toContainText("Personen mit der Rolle «Projektleitung»");
  for (const source of ["Agent", "HERMES Helfer", "Person"]) {
    await expect(drawer.getByText(source, { exact: true }).first()).toBeVisible();
  }
  await shot(page, "vorlagen");
  await drawer.getByRole("button", { name: "Schliessen" }).click();
  await expect(auftrag).toContainText("Version 1");

  // The project lead: the agent drafts the template's fields, the app fills in the facts.
  await signInAs(page, "u-anna");
  await page.goto("/vorhaben/KPO");
  await expect(page.getByRole("link", { name: "Vorlagen" })).toHaveCount(0);
  const result = page.locator('[data-deliverable="auftrag"]');
  await result.getByRole("button", { name: "Projektauftrag", exact: true }).click();
  const d = page.getByRole("dialog");
  await d.getByRole("button", { name: "Entwurf erstellen" }).click();
  await expect(d.getByRole("heading", { name: "1. Ausgangslage und Ziele › Ausgangslage" })).toBeVisible();
  const word = d.getByRole("region", { name: "Word-Dokument" });
  await expect(word).toContainText("8 von 8 Feldern sind gefüllt");
  await expect(word).toContainText("2 Felder für Unterschrift, Freigabe und Klassifizierung");
  await shot(page, "word-dokument");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    word.getByRole("button", { name: "Als Word herunterladen" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("KPO Projektauftrag.docx");
  const xml = strFromU8(unzipSync(readFileSync(await download.path()))["word/document.xml"]!);
  for (const text of ["Kundenportal Self-Service", "Anna Keller", "Entwurf (KI)", "Nina Huber"]) {
    expect(xml).toContain(text);
  }
});
