import { expect, test } from "@playwright/test";
import { shot, signInAs } from "./helpers";

test("Portfolio-Gremium finds projects blocked by a veto and drills down", async ({ page }) => {
  await signInAs(page, "u-rita");
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("link", { name: "Portfolio" })
    .click();
  await expect(page.getByRole("heading", { name: "Portfolio", level: 1 })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Alle Vorhaben" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("45 gefunden")).toBeVisible();

  // The go-live check of DAP waits for the veto roles.
  const veto = page
    .getByRole("region", { name: "Handlungsbedarf" })
    .getByRole("button", { name: /Veto offen/ });
  await veto.click();
  await expect(veto).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/signal=veto/);
  const list = page.getByRole("table", { name: "Vorhaben im Portfolio" });
  await expect(list.getByRole("link", { name: "Datenplattform Reporting" })).toBeVisible();
  const rows = list.locator("[data-project]");
  await expect(rows.first()).toBeVisible();
  await expect(list.locator('[data-signal="veto"]')).toHaveCount(await rows.count());
  await shot(page, "08-portfolio");

  // Into the project and back: the filter is still set.
  await list.getByRole("link", { name: "Datenplattform Reporting" }).click();
  await expect(page.getByRole("heading", { name: "Datenplattform Reporting" })).toBeVisible();
  await page.getByRole("link", { name: "← Portfolio" }).click();
  await expect(page).toHaveURL(/signal=veto/);
  await expect(veto).toHaveAttribute("aria-pressed", "true");

  // A number in the phase table filters by phase and gate state.
  await page.getByRole("button", { name: /^Einführung, Gate blockiert: \d+ Vorhaben anzeigen$/ }).click();
  await expect(page.getByRole("button", { name: "Filter «Phase: Einführung» entfernen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Filter «Gate: Blockiert» entfernen" })).toBeVisible();
  await expect(veto).toHaveAttribute("aria-pressed", "false");
  await expect(list.getByRole("link", { name: "Datenplattform Reporting" })).toBeVisible();
  await page.getByRole("button", { name: "Filter «Gate: Blockiert» entfernen" }).click();
  await expect(page).not.toHaveURL(/gate=/);
  await expect(page).toHaveURL(/phase=einf/);
});

test("Members see the portfolio of their own projects only", async ({ page }) => {
  await signInAs(page, "u-anna");
  await page.goto("/portfolio");
  await expect(page.getByText("Du siehst die Vorhaben, in denen du eine Rolle hast.")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Alle Vorhaben" })).toHaveCount(0);
  await expect(page.getByText("3 gefunden")).toBeVisible();
  await expect(
    page
      .getByRole("table", { name: "Vorhaben im Portfolio" })
      .getByRole("link", { name: "ERP-Upgrade Finanzen" }),
  ).toHaveCount(0);
});
