import { expect, test } from "@playwright/test";
import { shot, signInAs } from "./helpers";

test("PL drafts and releases the kick-off, asks the assistant, verifies the audit trail", async ({
  page,
}) => {
  await signInAs(page, "u-anna");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vorhaben" })).toBeVisible();
  const projects = page.getByRole("table", { name: "Vorhaben" });
  await expect(projects.getByRole("link", { name: "Kundenportal Self-Service" })).toBeVisible();
  await expect(projects.getByRole("link", { name: "ERP-Upgrade Finanzen" })).toHaveCount(0);
  await shot(page, "01-vorhaben");

  await projects.getByRole("link", { name: "Kundenportal Self-Service" }).click();
  await expect(page.getByRole("heading", { name: "Kundenportal Self-Service" })).toBeVisible();
  const next = page.getByRole("region", { name: "Als Nächstes" });
  await expect(next).toContainText("Kick-off-Roundtable");

  const row = page.locator('[data-deliverable="kickoff"]');
  await row.getByRole("button", { name: "Entwurf erstellen" }).click();
  await expect(row).toContainText("Entwurf entsteht");
  await expect(row).toContainText("Entwurf (KI)");
  await shot(page, "02-entwurf");

  await row.getByRole("button", { name: "Kick-off-Roundtable mit allen Beteiligten" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "Kick-off-Protokoll" })).toBeVisible();
  await expect(drawer).toContainText("Entwurf (KI)");
  await expect(drawer).toContainText("Aufträge mit Verantwortlichen");
  await shot(page, "03-entwurf-detail");
  await drawer.getByRole("button", { name: "Freigeben" }).click();
  await expect(row).toContainText("Freigegeben");
  await drawer.getByRole("button", { name: "Schliessen" }).click();

  await page.getByRole("button", { name: "Assistent fragen" }).click();
  const chat = page.getByRole("dialog");
  await chat.getByRole("button", { name: "Was ist als Nächstes?" }).click();
  await expect(chat.getByRole("log")).toContainText("Studie mit Lösungsvarianten");
  await chat.getByRole("textbox", { name: "Nachricht an den Assistenten" }).fill("Meine Aufgaben");
  await chat.getByRole("button", { name: "Senden" }).click();
  await expect(chat.getByRole("log")).toContainText("Für dich offen");
  await shot(page, "04-assistent");
  await chat.getByRole("button", { name: "Assistent schliessen" }).click();

  await page.getByRole("tab", { name: "Verlauf" }).click();
  await expect(page.getByRole("region", { name: "Verlauf" })).toContainText(
    "«Kick-off-Roundtable mit allen Beteiligten» freigegeben.",
  );
  await page.getByRole("button", { name: "Integrität prüfen" }).click();
  await expect(page.getByText("Projektakte unverändert")).toBeVisible();
  await shot(page, "05-verlauf");
});

test("ISM lifts the ISDS veto with a reason; others cannot decide", async ({ page }) => {
  await signInAs(page, "u-nina");
  await page.goto("/vorhaben/CRM");
  const isds = page.locator('[data-deliverable="isds"]');
  await expect(isds).toContainText("Veto");
  await expect(isds.getByRole("button", { name: "Prüfen & entscheiden" })).toHaveCount(0);

  await signInAs(page, "u-marco");
  await page.goto("/vorhaben/CRM");
  await expect(page.getByRole("region", { name: "Gate Phasenfreigabe Realisierung" })).toContainText(
    "Blockiert",
  );
  await isds.getByRole("button", { name: "Prüfen & entscheiden" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText("Restrisiken ohne verantwortliche Person");
  await drawer.getByRole("button", { name: "Entscheid erfassen" }).click();
  const serverError = drawer.getByText("Beim Aufheben eines Vetos ist eine Begründung Pflicht.");
  await expect(serverError).toBeVisible();
  await drawer
    .getByRole("textbox", { name: /Begründung/ })
    .fill("Restrisiken mit Verantwortlichen nachgetragen und geprüft.");
  await expect(serverError).toHaveCount(0);
  await shot(page, "06-veto-entscheid");
  await drawer.getByRole("button", { name: "Entscheid erfassen" }).click();
  await expect(isds).not.toContainText("Veto");
});

test("PMO sees all projects with paging", async ({ page }) => {
  await signInAs(page, "u-peter");
  await page.goto("/");
  await page.getByRole("tab", { name: "Alle Vorhaben" }).click();
  await expect(page.getByText("1–25 von 45")).toBeVisible();
  await page.getByRole("button", { name: "Weiter" }).click();
  await expect(page.getByText("26–45 von 45")).toBeVisible();
  await page.getByRole("searchbox", { name: "Vorhaben suchen" }).fill("CRM");
  await expect(page.getByRole("table", { name: "Vorhaben" }).getByRole("link")).toHaveCount(1);
  await shot(page, "07-portfolio-liste");
});
