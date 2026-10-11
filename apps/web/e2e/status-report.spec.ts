import { expect, test } from "@playwright/test";
import { shot, signInAs } from "./helpers";

test("Status report: the engine suggests, the PL decides and publishes with the agent's texts, the Projektausschuss takes note", async ({
  page,
}) => {
  await signInAs(page, "u-jonas");
  await page.goto("/vorhaben/ERP");
  await expect(page.getByText(/Statusbericht 1 vom .*: Gelb/)).toBeVisible();
  await page.getByRole("tab", { name: /Statusbericht/ }).click();
  const tab = page.getByRole("region", { name: "Statusbericht" });
  await expect(tab.getByRole("article", { name: "Statusbericht 1" })).toContainText(
    "Zur Kenntnis genommen von Thomas Meier",
  );

  await tab.getByRole("button", { name: "Neuer Statusbericht" }).click();
  const form = page.getByRole("dialog");
  // The high risk without a measure: the engine suggests red, with the reason.
  const risks = form.getByRole("region", { name: "Risiken" });
  await expect(risks).toContainText(
    "R-02 «Engpass bei Fachtestern im Monatsabschluss»: hohes Risiko ohne Massnahme.",
  );
  await expect(risks.getByRole("radio", { name: "Rot" })).toBeChecked();
  // The PL judges staffing better than suggested and says why.
  const staff = form.getByRole("region", { name: "Personalaufwand" });
  await staff.getByRole("radio", { name: "Grün" }).check();
  await staff
    .getByRole("textbox", { name: /Begründung/ })
    .fill("Die Beteiligten sind über die Fachstelle eingebunden; Workshops sind geplant.");
  await form.getByRole("spinbutton", { name: "Budget (CHF)" }).fill("400000");
  await form.getByRole("spinbutton", { name: "Verbraucht (CHF)" }).fill("180000");
  await form.getByRole("button", { name: "Texte mit dem Agenten entwerfen" }).click();
  await expect(form.getByText("Vom Agenten entworfen, bitte prüfen")).toBeVisible();
  await expect(form.getByRole("textbox", { name: "Übersicht und Prognose" })).toHaveValue(/Abweichungen: /);
  await expect(risks.getByRole("textbox", { name: "Massnahme" })).toHaveValue(
    /Eskalation an den Projektausschuss/,
  );
  await shot(page, "18-statusbericht-entwurf");
  await form.getByRole("button", { name: "Veröffentlichen" }).click();

  const latest = tab.getByRole("article", { name: "Statusbericht 2" });
  await expect(latest).toContainText("Gesamtstatus Rot");
  const staffing = latest.locator('[data-criterion="personal"]');
  await expect(staffing).toContainText("Vorschlag: Gelb");
  // The reason is the project lead's own, kept beside the suggestion it departs from.
  await expect(staffing).toContainText(
    "Begründung der Projektleitung: Die Beteiligten sind über die Fachstelle eingebunden",
  );
  await expect(latest).toContainText("400'000 CHF");

  // The Projektausschuss takes note, from its task.
  await signInAs(page, "u-thomas");
  await page.goto("/vorhaben/ERP");
  await page
    .getByRole("region", { name: "Meine Aufgaben" })
    .getByRole("button", { name: /Statusbericht 2 zur Kenntnis nehmen/ })
    .click();
  const report = page
    .getByRole("region", { name: "Statusbericht" })
    .getByRole("article", { name: "Statusbericht 2" });
  await report
    .getByRole("textbox", { name: /Bemerkung/ })
    .fill("Eskalation im nächsten Ausschuss traktandieren.");
  await report.getByRole("button", { name: "Zur Kenntnis genommen" }).click();
  await expect(report).toContainText("Zur Kenntnis genommen von Thomas Meier");
  await shot(page, "19-statusbericht");

  // The portfolio shows the red status.
  await signInAs(page, "u-peter");
  await page.goto("/portfolio?scope=all&signal=status-rot&q=ERP");
  const row = page.getByRole("table", { name: "Vorhaben im Portfolio" }).locator("[data-project]").first();
  await expect(row).toContainText("ERP-Upgrade Finanzen");
  await expect(row.locator('[data-ampel="rot"]')).toBeVisible();
});
