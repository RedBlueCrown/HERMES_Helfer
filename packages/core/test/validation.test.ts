import { describe, expect, it } from "vitest";
import {
  CR_RECHECK_NAMES,
  MIN_REASON,
  MIN_SUMMARY,
  MIN_TITLE,
  MODEL,
  NO_FLAGS,
  STATUS_CRITERION_IDS,
  changeImpact,
  impactContext,
  recheckNames,
  recheckResults,
  validateChangeRequest,
  validateRecheck,
  validateRisk,
  validateRiskAssessment,
  validateStatusReport,
  validateWithdrawal,
  type StatusCriterion,
  type StatusEntryInput,
  type StatusSuggestion,
} from "../src";
import { Stream } from "./helpers";

describe("what people enter: the same rules in the API and the web app", () => {
  it("change requests need a title and a summary, a withdrawal a reason, an added measure its text", () => {
    expect([MIN_TITLE, MIN_SUMMARY, MIN_REASON]).toEqual([4, 10, 5]);
    expect(validateChangeRequest({ title: "CSV", summary: "Ein Export der offenen Posten." })).toBe(
      "Bitte einen Titel erfassen (mindestens 4 Zeichen).",
    );
    expect(validateChangeRequest({ title: "Export", summary: "kurz" })).toBe(
      "Bitte die Änderung kurz beschreiben (mindestens 10 Zeichen).",
    );
    expect(validateChangeRequest({ title: "Export", summary: "Ein Export der offenen Posten." })).toBeNull();
    expect(validateWithdrawal("   ")).toMatch(/begründen/);
    expect(validateWithdrawal("Nicht mehr nötig.")).toBeNull();
    expect(validateRecheck("Massnahme ergänzt", "")).toBe("Bitte die ergänzte Massnahme nennen.");
    expect(validateRecheck("keine Anpassung", "")).toBeNull();
  });

  it("a risk assessment changes something; closing, reopening and work on a measure say why or what", () => {
    expect(validateRisk({ title: " ab " })).toMatch(/mindestens 4 Zeichen/);
    const s = new Stream("init").add({
      type: "RiskRecorded",
      data: {
        riskId: "r1",
        number: 1,
        title: "Lieferverzug",
        description: "",
        probability: "mittel",
        impact: "hoch",
        ownerRole: "PL",
        mitigation: "",
        producer: { kind: "human" },
      },
    });
    const r = s.state().risks.r1!;
    const same = { probability: r.probability, impact: r.impact, ownerRole: r.ownerRole, mitigation: "" };
    expect(validateRiskAssessment(r, { ...same, status: "offen", note: "" })).toBe(
      "Es hat sich nichts geändert.",
    );
    expect(validateRiskAssessment(r, { ...same, status: "offen", note: "Erneut geprüft." })).toBeNull();
    expect(validateRiskAssessment(r, { ...same, status: "geschlossen", note: "" })).toMatch(/geschlossen/);
    expect(validateRiskAssessment(r, { ...same, status: "in Bearbeitung", note: "" })).toMatch(/Massnahme/);
    expect(
      validateRiskAssessment(r, {
        ...same,
        status: "in Bearbeitung",
        mitigation: "Vertrag ergänzen",
        note: "",
      }),
    ).toBeNull();

    s.add({
      type: "RiskAssessed",
      data: { riskId: "r1", ...same, status: "geschlossen", note: "Geliefert.", producer: { kind: "human" } },
    });
    const closed = s.state().risks.r1!;
    expect(validateRiskAssessment(closed, { ...same, status: "offen", note: "" })).toBe(
      "Bitte begründen, warum das Risiko wieder offen ist.",
    );
  });

  it("a status report names problem and measure for yellow and red, and why it is better than suggested", () => {
    const green: StatusEntryInput = { ampel: "gruen", problem: "", measure: "" };
    const criteria = Object.fromEntries(STATUS_CRITERION_IDS.map((c) => [c, green])) as Record<
      StatusCriterion,
      StatusEntryInput
    >;
    const ok = (ampel: StatusSuggestion["ampel"]): StatusSuggestion => ({
      ampel,
      reasons: ["ok"],
      facts: [{ text: "ok", quotes: [] }],
    });
    const suggestion = Object.fromEntries(STATUS_CRITERION_IDS.map((c) => [c, ok("gruen")])) as Record<
      StatusCriterion,
      StatusSuggestion
    >;
    const overview = "Planmässig unterwegs.";
    expect(validateStatusReport({ overview, criteria }, suggestion)).toBeNull();
    expect(validateStatusReport({ overview: "kurz", criteria }, suggestion)).toMatch(/Übersicht/);
    expect(
      validateStatusReport(
        {
          overview,
          criteria: { ...criteria, kosten: { ampel: "gelb", problem: "Mehrkosten", measure: "" } },
        },
        suggestion,
      ),
    ).toBe("«Kosten» ist Gelb: Bitte Problem und Massnahme nennen.");
    const red = { ...suggestion, risiken: ok("rot") };
    expect(validateStatusReport({ overview, criteria }, red)).toMatch(
      /«Risiken»: Bitte begründen, warum die Lage besser ist als vorgeschlagen \(Vorschlag Rot\)/,
    );
    // The reason is the project lead's own field: a problem text does not count.
    const withProblem = { ...criteria, risiken: { ...green, problem: "Lieferverzug abgewendet." } };
    expect(validateStatusReport({ overview, criteria: withProblem }, red)).toMatch(/Bitte begründen/);
    const withReason = { ...criteria, risiken: { ...green, deviationReason: "Lieferant hat geliefert." } };
    expect(validateStatusReport({ overview, criteria: withReason }, red)).toBeNull();
  });
});

describe("recheck after a change request", () => {
  it("covers the results of the current and earlier phases only", () => {
    expect(CR_RECHECK_NAMES).toBe("SchuBAn, Datenschutz-Vorabklärung, ISDS-Konzept und DSFA");
    expect(recheckResults(MODEL, "init")).toEqual(["schuban", "dsvor"]);
    expect(recheckResults(MODEL, "konzept")).toEqual(["schuban", "dsvor", "isds"]);
    expect(recheckResults(MODEL, "real")).toEqual(["schuban", "dsvor", "isds", "dsfa"]);
    expect(recheckResults(MODEL, "real", ["dsfa"])).toEqual(["schuban", "dsvor", "isds"]);
    expect(recheckNames(["schuban", "dsvor"])).toBe("SchuBAn und Datenschutz-Vorabklärung");
    expect(recheckNames(["isds"])).toBe("ISDS-Konzept");

    const rows = changeImpact(
      { effortDays: 3, flags: { ...NO_FLAGS, daten: true } },
      impactContext(new Stream("init").state()),
      MODEL,
    );
    expect(rows.find((x) => x.id === "sicherheit")?.text).toBe(
      "SchuBAn und Datenschutz-Vorabklärung neu prüfen (ISM und Datenschutz); das Gate bleibt bis dahin zu",
    );
  });
});
