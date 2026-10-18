import { expect, test } from "@playwright/test";
import { shot, signInAs } from "./helpers";

// Runs against the API of the test environment (playwright.config.ts): empty, and
// without separation of duties, so one person can try every role.
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
  await expect(roles).toContainText("Die Funktionentrennung ist ausgeschaltet.");
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

  // For practice, the Projektablage is a folder in a private OneDrive.
  const folder = "https://onedrive.live.com/?id=4A2B%21105&cid=4A2B3C4D5E6F7A8B";
  await page.getByRole("button", { name: "Projektablage verknüpfen" }).click();
  const storage = page.getByRole("dialog");
  const link = storage.getByRole("textbox", { name: "Link zum Ordner" });
  await link.fill("https://dropbox.example/ordner");
  await expect(storage).toContainText("Links auf «dropbox.example» sind hier nicht vorgesehen.");
  await expect(storage.getByRole("button", { name: "Speichern" })).toBeDisabled();
  await link.fill(folder);
  await shot(page, "16-projektablage");
  await storage.getByRole("button", { name: "Speichern" }).click();
  const open = page.getByRole("link", { name: "Projektablage" });
  await expect(open).toHaveAttribute("href", folder);
  await expect(open).toHaveAttribute("target", "_blank");
  await expect(open).toHaveAttribute("rel", "noopener noreferrer");
  await shot(page, "17-projektablage-verknuepft");
  await page.getByRole("tab", { name: "Verlauf" }).click();
  await expect(page.getByText("Projektablage verknüpft (onedrive.live.com).")).toBeVisible();
});
