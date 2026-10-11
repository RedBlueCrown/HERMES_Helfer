import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers";

test("Separation of duties: the PL assigns the team, the PMO the control roles, never to the PL", async ({
  page,
}) => {
  await signInAs(page, "u-anna");
  await page.goto("/vorhaben/KPO");
  await page.getByRole("tab", { name: "Beteiligte und Rollen" }).click();
  const roles = page.getByRole("region", { name: "Rollen im Vorhaben" });
  await expect(roles).toContainText("vergibt das PMO, und nie an die Projektleitung (Funktionentrennung)");
  await expect(roles.getByRole("button", { name: "Mich selbst" })).toHaveCount(0);
  await expect(
    roles.getByRole("button", { name: /Rolle Fachvertretung von Nina Huber entfernen/ }),
  ).toBeVisible();
  await expect(
    roles.getByRole("button", { name: /Rolle Auftraggeber \/ Projektausschuss von Thomas Meier entfernen/ }),
  ).toHaveCount(0);
  await roles.getByRole("combobox").click();
  await expect(page.getByRole("option", { name: "Testverantwortung" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Auftraggeber / Projektausschuss" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The PMO assigns the control roles, but not to the project lead.
  await signInAs(page, "u-peter");
  await page.goto("/vorhaben/KPO");
  await page.getByRole("tab", { name: "Beteiligte und Rollen" }).click();
  await roles.getByRole("textbox", { name: "Kennung (Entra ID)" }).fill("u-anna");
  await roles.getByRole("textbox", { name: "Name" }).fill("Anna Keller");
  await roles.getByRole("combobox").click();
  await page.getByRole("option", { name: "Informationssicherheit (ISM)" }).click();
  await roles.getByRole("button", { name: "Rolle vergeben" }).click();
  await expect(page.getByRole("listitem", { name: "Nicht möglich" })).toContainText(
    "Die Person hat bereits die Rolle Projektleitung.",
  );
});
