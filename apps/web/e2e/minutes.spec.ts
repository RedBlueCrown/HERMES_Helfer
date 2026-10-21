import { expect, test } from "@playwright/test";
import { shot, signInAs } from "./helpers";

test("Minutes: the Protokoll agent proposes from the notes, a member accepts, the owner reports it done", async ({
  page,
}) => {
  // A member pastes the notes; the agent proposes items with their passage of the text.
  await signInAs(page, "u-jonas");
  await page.goto("/vorhaben/KPO");
  await page.getByRole("tab", { name: /Protokolle/ }).click();
  const register = page.getByRole("region", { name: "Protokolle" });
  await expect(register).toContainText("Noch keine Protokolle erfasst.");
  await register.getByRole("button", { name: "Protokoll erfassen" }).click();

  const drawer = page.getByRole("dialog");
  await drawer.getByRole("textbox", { name: "Besprechung" }).fill("Projektsitzung Anmeldung");
  await drawer
    .getByRole("textbox", { name: /Notizen oder Transkript/ })
    .fill(
      [
        "Projektsitzung Kundenportal",
        "Anna Keller: Entscheid: Wir starten mit dem Self-Service für Adressänderungen.",
        "Pendenz: Testkonzept für das Portal entwerfen, verantwortlich: Tim Brunner, bis 30.10.",
        "Pendenz: Offerte des Hosting-Anbieters einholen; verantwortlich: Einkauf",
        "Frage: Braucht es eine Zwei-Faktor-Authentisierung?",
      ].join("\n"),
    );
  await drawer.getByRole("button", { name: "Mit dem Agenten auswerten" }).click();
  await expect(drawer.getByRole("region", { name: "Pendenzen" })).toContainText(
    "«Pendenz: Testkonzept für das Portal entwerfen, verantwortlich: Tim Brunner, bis 30.10.»",
  );
  // Not every proposal is taken: the offer stays out of the minutes.
  const offer = drawer
    .getByRole("region", { name: "Pendenzen" })
    .getByRole("checkbox", { name: "Übernehmen" })
    .nth(1);
  await offer.uncheck();
  await shot(page, "22-protokoll-agent");
  await drawer.getByRole("button", { name: "Protokoll übernehmen (3)" }).click();

  const minutes = register.locator('[data-minutes="P-01"]');
  await expect(minutes).toContainText("P-01 Projektsitzung Anmeldung");
  await expect(minutes).toContainText("Vorschlag des Protokoll-Agenten");
  await expect(minutes).not.toContainText("Hosting");

  // The person responsible finds the action item under «Meine Aufgaben» and reports it done.
  await signInAs(page, "u-tim");
  await page.goto("/vorhaben/KPO");
  const tasks = page.getByRole("complementary", { name: "Hinweise" });
  await tasks.getByRole("button", { name: /Pendenz: Testkonzept für das Portal entwerfen/ }).click();
  const row = page
    .getByRole("region", { name: "Protokolle" })
    .locator('[data-action="Testkonzept für das Portal entwerfen"]');
  await row.getByRole("button", { name: "Erledigt" }).click();
  await expect(row).toContainText("erledigt");
  await expect(tasks).not.toContainText("Pendenz: Testkonzept");

  // The history names the minutes, not the notes.
  await page.getByRole("tab", { name: "Verlauf" }).click();
  await expect(
    page.getByText(/P-01 «Projektsitzung Anmeldung» vom .* erfasst: 1 Entscheid, 1 Pendenz, 1 offene Frage/),
  ).toBeVisible();
});
