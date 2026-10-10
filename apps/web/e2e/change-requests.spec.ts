import { expect, test, type Page } from "@playwright/test";
import { shot, signInAs } from "./helpers";

const openRegister = async (page: Page, user: string) => {
  await signInAs(page, user);
  await page.goto("/vorhaben/ERP");
  await page.getByRole("tab", { name: /Change Requests/ }).click();
  return page.getByRole("region", { name: "Change Requests" });
};

test("A change request from the wish to the recheck: agent, Projektausschuss, ISM and Datenschutz", async ({
  page,
}) => {
  // Fachvertretung: describe the wish, let the agent work it out, estimate the effort, submit.
  const register = await openRegister(page, "u-nina");
  await expect(register.getByRole("table", { name: "Register der Change Requests" })).toContainText(
    "CR-02 Export der offenen Posten als CSV für die Revision",
  );
  await register.getByRole("button", { name: "Neuer Change Request" }).click();
  const form = page.getByRole("dialog");
  await form.getByRole("textbox", { name: "Titel" }).fill("Adressexport für den Mahnversand");
  await form.getByRole("textbox", { name: /Beantragt von/ }).fill("Debitorenbuchhaltung");
  await form
    .getByRole("textbox", { name: /Wunsch/ })
    .fill(
      "Die Debitorenbuchhaltung möchte die Adressen säumiger Kunden exportieren, um Mahnungen zu versenden.",
    );
  await form.getByRole("button", { name: "Mit dem Agenten ausarbeiten" }).click();
  await expect(form.getByText("Vom Agenten ausgearbeitet, bitte prüfen")).toBeVisible();
  await expect(form.getByRole("checkbox", { name: /Personendaten oder Datenumfang/ })).toBeChecked();
  await expect(form.getByText(/Agent: Der Wunsch nennt Daten/)).toBeVisible();
  await form.getByRole("spinbutton", { name: /Aufwand in Personentagen/ }).fill("5");
  const preview = form.getByRole("table", { name: "Auswirkungen" });
  await expect(preview.locator('[data-impact="sicherheit"]')).toContainText("hoch");
  await shot(page, "13-change-request-agent");
  await form.getByRole("button", { name: "Einreichen" }).click();
  await expect(register).toContainText("CR-03 Adressexport für den Mahnversand");

  // Projektausschuss: decides with Konsent and a reason.
  await signInAs(page, "u-thomas");
  await page.goto("/vorhaben/ERP");
  await page
    .getByRole("region", { name: "Meine Aufgaben" })
    .getByRole("button", { name: /CR-03 entscheiden/ })
    .click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "CR-03 Adressexport für den Mahnversand" })).toBeVisible();
  await drawer
    .getByRole("textbox", { name: /Begründung/ })
    .fill("Mahnwesen ist gesetzlich nötig; Reserve reicht.");
  await drawer.getByRole("checkbox", { name: /Konsent festgestellt/ }).check();
  await drawer.getByRole("button", { name: "Entscheid erfassen" }).click();
  await expect(drawer).toContainText("Freigegeben durch Thomas Meier");
  await expect(drawer.getByRole("region", { name: "Neuprüfung" })).toContainText("Neuprüfung offen");
  await shot(page, "14-change-request-entscheid");

  // ISM and Datenschutz recheck SchuBAn, ISDS and DSFA; until then the gate stays closed.
  await signInAs(page, "u-marco");
  await page.goto("/vorhaben/ERP");
  await page
    .getByRole("region", { name: "Meine Aufgaben" })
    .getByRole("button", { name: /Neuprüfung nach CR-03/ })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Keine Anpassung nötig" }).click();
  await expect(page.getByRole("dialog")).toContainText(/Informationssicherheit \(ISM\): keine Anpassung/);

  await signInAs(page, "u-sandra");
  await page.goto("/vorhaben/ERP");
  await page
    .getByRole("region", { name: "Meine Aufgaben" })
    .getByRole("button", { name: /Neuprüfung nach CR-03/ })
    .click();
  const last = page.getByRole("dialog");
  await last.getByRole("textbox", { name: "Massnahme oder Notiz" }).fill("Export nur pseudonymisiert");
  await last.getByRole("button", { name: "Massnahme ergänzt" }).click();
  await expect(last.getByRole("region", { name: "Neuprüfung" })).toContainText("Neuprüfung abgeschlossen");
});
