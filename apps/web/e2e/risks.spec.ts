import { expect, test } from "@playwright/test";
import { shot, signInAs } from "./helpers";

test("Risks: the Risiko agent proposes, the PL accepts, the responsible role takes on the measure", async ({
  page,
}) => {
  // Project lead: an empty register; the agent reviews the project and proposes.
  await signInAs(page, "u-anna");
  await page.goto("/vorhaben/KPO");
  await page.getByRole("tab", { name: /Risiken/ }).click();
  const register = page.getByRole("region", { name: "Risiken" });
  await expect(register).toContainText("Noch keine Risiken erfasst.");
  await register.getByRole("button", { name: "Risiken prüfen lassen" }).click();

  const review = page.getByRole("dialog");
  await expect(review.getByRole("heading", { name: "Risikoprüfung durch den Agenten" })).toBeVisible();
  const vendor = review.getByRole("checkbox", { name: "Übernehmen: Lieferverzug des externen Lieferanten" });
  await expect(vendor).toBeVisible();
  await expect(review.getByRole("region", { name: "Geprüfte Hinweise" })).toContainText(
    "Ein externer Lieferant ist beteiligt.",
  );
  await vendor.check();
  const cloud = review.getByRole("checkbox", {
    name: "Übernehmen: Personendaten in der Cloud ohne geklärten Speicherort",
  });
  await cloud.check();
  // The PL adjusts a proposal before accepting it.
  const cloudCard = review.locator('[data-proposal="Personendaten in der Cloud ohne geklärten Speicherort"]');
  await cloudCard.getByRole("radiogroup", { name: "Eintritt" }).getByRole("radio", { name: "hoch" }).check();
  await shot(page, "16-risiken-agent");
  await review.getByRole("button", { name: "Ausgewählte übernehmen (2)" }).click();
  await expect(review.getByText("Übernommen", { exact: true })).toHaveCount(2);
  await review.getByRole("button", { name: "Schliessen" }).last().click();

  // Accepted in the order of the proposals; the register lists the most serious first.
  const table = register.getByRole("table", { name: "Register der Risiken" });
  await expect(table.locator('[data-risk="R-01"]')).toContainText("Lieferverzug des externen Lieferanten");
  await expect(table.locator('[data-risk="R-02"]')).toContainText("Personendaten in der Cloud");
  await expect(table.locator('[data-risk="R-02"]')).toContainText("9 · hoch");
  await expect(table.locator("[data-risk]").first()).toHaveAttribute("data-risk", "R-02");
  await expect(page.getByRole("tab", { name: /Risiken/ })).toContainText("2");

  // Datenschutz holds the high risk on personal data: a task until someone works on the measure.
  await signInAs(page, "u-sandra");
  await page.goto("/vorhaben/KPO");
  await page
    .getByRole("region", { name: "Meine Aufgaben" })
    .getByRole("button", { name: /Hohes Risiko R-02/ })
    .click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: /R-02 Personendaten in der Cloud/ })).toBeVisible();
  await expect(drawer).toContainText("vom Risiko-Agenten vorgeschlagen");
  const form = drawer.getByRole("form", { name: "Neu beurteilen" });
  await form
    .getByRole("radiogroup", { name: "Status" })
    .getByRole("radio", { name: "in Bearbeitung" })
    .check();
  await form.getByRole("textbox", { name: "Notiz" }).fill("Vertrag zur Auftragsbearbeitung in Abklärung.");
  await form.getByRole("button", { name: "Beurteilung speichern" }).click();
  await expect(drawer.getByRole("region", { name: "Verlauf des Risikos" })).toContainText(
    "Vertrag zur Auftragsbearbeitung in Abklärung.",
  );
  await shot(page, "17-risiko-beurteilen");
  await drawer.getByRole("button", { name: "Schliessen" }).click();
  await expect(page.getByRole("region", { name: "Meine Aufgaben" })).not.toContainText("Hohes Risiko R-02");

  // The record names the agent; the portfolio flags the project.
  await page.getByRole("tab", { name: "Verlauf" }).click();
  await expect(page.getByRole("region", { name: "Verlauf" })).toContainText(
    "R-01 «Lieferverzug des externen Lieferanten» erfasst (Eintritt mittel, Auswirkung hoch, verantwortlich Projektleitung; vom Risiko-Agenten vorgeschlagen).",
  );
  await signInAs(page, "u-peter");
  await page.goto("/portfolio?scope=all&signal=risiko-hoch&q=Kundenportal");
  await expect(
    page
      .getByRole("table", { name: "Vorhaben im Portfolio" })
      .getByRole("link", { name: "Kundenportal Self-Service" }),
  ).toBeVisible();
});

test("Risk review: an item that fails does not undo or repeat the others", async ({ page }) => {
  // After the first test: R-01 (supplier) is open; the agent proposes it again with a higher probability.
  await signInAs(page, "u-anna");
  await page.goto("/vorhaben/KPO");
  await page.getByRole("tab", { name: /Risiken/ }).click();
  const register = page.getByRole("region", { name: "Risiken" });
  await register.getByRole("button", { name: "Risiken prüfen lassen" }).click();
  const review = page.getByRole("dialog");
  await review
    .getByRole("checkbox", { name: "Übernehmen: Geringe Akzeptanz bei externen Nutzenden" })
    .check();
  await review
    .getByRole("checkbox", { name: "Übernehmen: R-01 Lieferverzug des externen Lieferanten" })
    .check();

  // Meanwhile R-01 is assessed in another window: the proposal now rests on an old version.
  const headers = { "x-dev-user": "u-anna" };
  const risks = await (await page.request.get("/api/projects/KPO/risks", { headers })).json();
  const r01 = risks.items.find((r: { label: string }) => r.label === "R-01");
  const assessed = await page.request.post(`/api/projects/KPO/risks/${r01.id}/assessment`, {
    headers,
    data: {
      probability: r01.probability,
      impact: r01.impact,
      status: "in Bearbeitung",
      ownerRole: r01.ownerRole,
      mitigation: "Liefertermine vertraglich festhalten.",
      note: "Vertrag liegt beim Lieferanten.",
      basedOn: r01.version,
    },
  });
  expect(assessed.status()).toBe(200);

  await review.getByRole("button", { name: "Ausgewählte übernehmen (2)" }).click();
  await expect(review.getByText("Übernommen", { exact: true })).toHaveCount(1);
  await expect(review).toContainText("Das Risiko wurde inzwischen geändert.");
  // Trying again repeats only what failed: the accepted risk is not recorded twice.
  await review.getByRole("button", { name: "Ausgewählte übernehmen (1)" }).click();
  await expect(review).toContainText("Das Risiko wurde inzwischen geändert.");
  await review.getByRole("button", { name: "Schliessen" }).last().click();
  const table = register.getByRole("table", { name: "Register der Risiken" });
  await expect(table.getByText("Geringe Akzeptanz bei externen Nutzenden")).toHaveCount(1);
  await expect(table.locator('[data-risk="R-01"]')).toContainText("in Bearbeitung");
});
