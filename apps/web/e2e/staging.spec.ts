import { expect, test } from "@playwright/test";
import { shot, signInAs } from "./helpers";

// Runs last (files run in name order): it adds a project, which the other files count.
test("First steps in a new environment: the PMO creates a project and takes the roles to try it", async ({
  page,
}) => {
  await signInAs(page, "u-peter");
  await page.goto("/");
  await page.getByRole("button", { name: "Neues Vorhaben" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Kürzel" }).fill("pilot-1");
  await dialog.getByRole("textbox", { name: "Name" }).fill("Pilot im Testtenant");
  await expect(dialog.getByRole("radio", { name: /Ich selbst \(Peter Graf\)/ })).toBeChecked();
  await shot(page, "15-neues-vorhaben");
  await dialog.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Pilot im Testtenant" })).toBeVisible();
  await expect(page).toHaveURL(/\/vorhaben\/PILOT-1$/);

  await page.getByRole("tab", { name: "Beteiligte und Rollen" }).click();
  const roles = page.getByRole("region", { name: "Rollen im Vorhaben" });
  await roles.getByRole("button", { name: "Mich selbst" }).click();
  await roles.getByRole("combobox").click();
  await page.getByRole("option", { name: "Auftraggeber / Projektausschuss" }).click();
  await roles.getByRole("button", { name: "Rolle vergeben" }).click();
  await expect(roles.getByRole("table", { name: "Mitglieder" })).toContainText(
    "Auftraggeber / Projektausschuss",
  );

  // As project lead, start the first draft.
  await page.getByRole("tab", { name: "Lieferergebnisse" }).click();
  const kickoff = page.locator('[data-deliverable="kickoff"]');
  await kickoff.getByRole("button", { name: "Entwurf erstellen" }).click();
  await expect(kickoff).toContainText("Entwurf (KI)");
});
