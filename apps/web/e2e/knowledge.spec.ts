import { expect, test } from "@playwright/test";
import { shot, signInAs } from "./helpers";

test("Wissen: the agent answers across the projects one may read and names its sources", async ({ page }) => {
  await signInAs(page, "u-anna");
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("link", { name: "Wissen" })
    .click();
  await page.getByRole("textbox", { name: "Deine Frage" }).fill("Was wurde zur Migration entschieden?");
  await page.getByRole("button", { name: "Fragen", exact: true }).click();

  const answer = page.getByRole("region", { name: "Antwort" });
  await expect(answer).toContainText("zwei Etappen");
  await expect(answer.getByRole("link", { name: "Quelle Q1" })).toBeVisible();
  const source = answer.locator("#quelle-Q1");
  await expect(source).toContainText("CRM");
  await expect(source).toContainText("Entscheid");
  await shot(page, "23-wissen");

  // A question the documents do not answer gets no answer and no source.
  await page.getByRole("textbox", { name: "Deine Frage" }).fill("Wie wird das Wetter morgen?");
  await page.getByRole("button", { name: "Fragen", exact: true }).click();
  await expect(answer).toContainText("nichts gefunden");
  await expect(answer.getByRole("heading", { name: "Quellen" })).toHaveCount(0);

  // The source leads to its project.
  await page.getByRole("textbox", { name: "Deine Frage" }).fill("Was wurde zur Migration entschieden?");
  await page.getByRole("button", { name: "Fragen", exact: true }).click();
  await answer.getByRole("link", { name: "Vorhaben öffnen" }).click();
  await expect(page.getByRole("heading", { name: "CRM-Ablösung Vertrieb" })).toBeVisible();
});
