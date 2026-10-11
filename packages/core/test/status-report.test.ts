import { describe, expect, it } from "vitest";
import {
  MODEL,
  NO_FLAGS,
  PROJECT_ROLES,
  STATUS_CRITERION_IDS,
  checkAcknowledgeStatusReport,
  checkPublishStatusReport,
  describeEvent,
  eventCategory,
  eventRefs,
  myTasks,
  nextCrNumber,
  nextRiskNumber,
  nextStatusReportNumber,
  openParticipation,
  overallAmpel,
  projectSignals,
  projectSummary,
  projectView,
  statusReportRegister,
  suggestStatus,
  type Actor,
  type Ampel,
  type StatusCriterion,
  type StatusEntry,
} from "../src";
import { Stream, viewer } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
const at = (st: Stream, days = 0) => new Date(Date.parse(st.events.at(-1)!.at) + days * DAY);
const actor = (userId: string, ...roles: string[]): Actor => ({
  userId,
  displayName: userId,
  roles,
  channel: "web",
});

const team = () =>
  new Stream("konzept")
    .member("anna", "PL")
    .member("thomas", "PA")
    .member("rest", ...PROJECT_ROLES.filter((r) => !["PL", "PA"].includes(r)));

const criteria = (colours: Partial<Record<StatusCriterion, Ampel>> = {}) =>
  Object.fromEntries(
    STATUS_CRITERION_IDS.map((id) => {
      const ampel = colours[id] ?? "gruen";
      const entry: StatusEntry = {
        ampel,
        suggested: "gruen",
        problem: ampel === "gruen" ? "" : "Problem",
        measure: ampel === "gruen" ? "" : "Massnahme",
      };
      return [id, entry];
    }),
  ) as Record<StatusCriterion, StatusEntry>;

const publish = (
  st: Stream,
  reportId: string,
  colours: Partial<Record<StatusCriterion, Ampel>> = {},
  entries: Partial<Record<StatusCriterion, StatusEntry>> = {},
) =>
  st.add(
    {
      type: "StatusReportPublished",
      data: {
        reportId,
        number: nextStatusReportNumber(st.state()),
        criteria: { ...criteria(colours), ...entries },
        overview: "Übersicht",
        outlook: "Ausblick",
        figures: { budgetChf: 100_000, spentChf: 40_000, progressPct: 40 },
        phase: st.state().phase,
        mandatory: { done: 1, total: 6 },
        risks: [],
        producer: { kind: "human" },
      },
    },
    actor("anna", "PL"),
  );

describe("suggested traffic light", () => {
  it("is green everywhere for a project without problems, with the reasons", () => {
    const st = team();
    for (const x of openParticipation(st.state(), MODEL, "konzept")) st.involve("konzept", x.id);
    const sug = suggestStatus(st.state(), MODEL, at(st));
    expect(Object.values(sug).map((x) => x.ampel)).toEqual(Array(6).fill("gruen"));
    expect(sug.risiken.reasons).toEqual(["Keine hohen Risiken offen."]);
    expect(sug.ergebnisse.reasons[0]).toMatch(/von \d+ Pflichtergebnissen freigegeben/);
  });

  it("follows the project's data: rejected gate, costs over the reserve, missing roles, open requests, high risks", () => {
    const st = new Stream("konzept").member("anna", "PL").member("thomas", "PA");
    st.add({ type: "ChangeReserveSet", data: { amountChf: 5_000 } });
    for (const [crId, decide] of [
      ["cr-1", true],
      ["cr-2", false],
    ] as const) {
      st.add({
        type: "ChangeRequestSubmitted",
        data: {
          crId,
          number: nextCrNumber(st.state()),
          title: `Änderung ${crId}`,
          requestedBy: "Fachstelle",
          effortDays: 5,
          flags: NO_FLAGS,
          content: { summary: "Kurz", sections: [], openPoints: [] },
          findings: [],
          producer: { kind: "human" },
        },
      });
      if (decide) {
        st.add({
          type: "ChangeRequestDecided",
          data: { crId, decision: "freigegeben", reason: "ok", konsent: true, conditions: [] },
        });
      }
    }
    st.add({
      type: "GateDecisionRecorded",
      data: {
        phase: "konzept",
        decision: "zurückgewiesen",
        reason: "Nacharbeit",
        konsent: false,
        conditions: [],
      },
    });
    st.add({
      type: "RiskRecorded",
      data: {
        riskId: "r1",
        number: nextRiskNumber(st.state()),
        title: "Lieferverzug",
        description: "",
        probability: "hoch",
        impact: "hoch",
        ownerRole: "PL",
        mitigation: "Eskalation",
        producer: { kind: "human" },
      },
    });
    const sug = suggestStatus(st.state(), MODEL, at(st));
    expect(sug.termine.ampel).toBe("rot");
    expect(sug.termine.reasons[0]).toContain("zurückgewiesen");
    // 6'000 CHF accepted against a reserve of 5'000.
    expect(sug.kosten).toMatchObject({
      ampel: "rot",
      reasons: [
        "Die angenommenen Change Requests übersteigen die Reserve um 1'000 CHF.",
        "Offene Change Requests (6'000 CHF) übersteigen die verbleibende Reserve.",
      ],
    });
    expect(sug.personal.ampel).toBe("gelb");
    expect(sug.personal.reasons[0]).toMatch(/^Für offene Entscheide fehlt: .*\(«/);
    expect(sug.ziele.ampel).toBe("gelb");
    expect(sug.risiken).toEqual({
      ampel: "rot",
      reasons: ["R-01 «Lieferverzug»: Eintritt und Auswirkung hoch."],
      // For the agents: the engine's fact, and the title people typed as a quote beside it.
      facts: [{ text: "R-01: Eintritt und Auswirkung hoch.", quotes: ["Lieferverzug"] }],
    });
    expect(overallAmpel(Object.values(sug).map((x) => x.ampel))).toBe("rot");
  });
});

describe("status report lifecycle", () => {
  it("is due after 30 days, published by the PL, and taken note of by the Projektausschuss", () => {
    const st = team();
    const pl = viewer("anna");
    expect(myTasks(st.state(), MODEL, pl, at(st, 29)).some((t) => t.kind === "status-report")).toBe(false);
    expect(myTasks(st.state(), MODEL, pl, at(st, 30))).toContainEqual({ kind: "status-report" });
    expect(checkPublishStatusReport(st.state(), MODEL, pl).ok).toBe(true);
    expect(checkPublishStatusReport(st.state(), MODEL, viewer("thomas"))).toMatchObject({
      code: "forbidden",
    });

    publish(st, "s1", { kosten: "gelb" });
    const now = at(st, 1);
    expect(myTasks(st.state(), MODEL, pl, now).some((t) => t.kind === "status-report")).toBe(false);
    expect(myTasks(st.state(), MODEL, viewer("thomas"), now)).toContainEqual({
      kind: "acknowledge-report",
      reportId: "s1",
    });
    const reg = statusReportRegister(st.state(), MODEL, viewer("thomas"), now);
    expect(reg.items[0]).toMatchObject({ title: "Statusbericht 1", overall: "gelb", overallLabel: "Gelb" });
    expect(reg.items[0]!.criteria.find((c) => c.id === "kosten")).toMatchObject({
      code: "KOS",
      ampel: "gelb",
      deviates: true,
    });
    expect(reg.items[0]!.canAcknowledge.ok).toBe(true);
    expect(checkAcknowledgeStatusReport(st.state(), MODEL, viewer("anna"), "s1")).toMatchObject({
      code: "forbidden",
    });

    st.add({ type: "StatusReportAcknowledged", data: { reportId: "s1", note: "" } }, actor("thomas", "PA"));
    expect(
      myTasks(st.state(), MODEL, viewer("thomas"), now).some((t) => t.kind === "acknowledge-report"),
    ).toBe(false);
    expect(checkAcknowledgeStatusReport(st.state(), MODEL, viewer("thomas"), "s1")).toMatchObject({
      code: "invalid_state",
    });
    expect(projectView(st.state(), MODEL, pl, now).statusReport).toMatchObject({
      latest: { number: 1, overall: "gelb" },
      due: false,
    });
    // Of the earlier reports, only the red ones can still be taken note of.
    publish(st, "s2", { kosten: "gelb" });
    publish(st, "s3", { kosten: "rot" });
    publish(st, "s4");
    const thomas = viewer("thomas");
    expect(checkAcknowledgeStatusReport(st.state(), MODEL, thomas, "s2")).toMatchObject({
      reason: "Es gibt einen neueren Statusbericht.",
    });
    expect(checkAcknowledgeStatusReport(st.state(), MODEL, thomas, "s3").ok).toBe(true);
    expect(
      myTasks(st.state(), MODEL, thomas, now)
        .filter((t) => t.kind === "acknowledge-report")
        .map((t) => (t.kind === "acknowledge-report" ? t.reportId : "")),
    ).toEqual(["s4", "s3"]);
  });

  it("describes the reports in German", () => {
    const st = team();
    publish(st, "s1", { termine: "gelb", risiken: "rot" });
    st.add({ type: "StatusReportAcknowledged", data: { reportId: "s1", note: "Eskalation geplant." } });
    const refs = eventRefs(st.state());
    const [published, acknowledged] = st.events.slice(-2);
    expect(eventCategory(published!)).toBe("status");
    expect(describeEvent(published!, MODEL, refs)).toBe(
      "Statusbericht 1 veröffentlicht: Gesamtstatus Rot (Termine Gelb, Risiken Rot).",
    );
    expect(describeEvent(acknowledged!, MODEL, refs)).toBe(
      "Statusbericht 1 vom Projektausschuss zur Kenntnis genommen: Eskalation geplant.",
    );
  });

  it("keeps the project lead's reason for a colour better than suggested, and flags it in the portfolio", () => {
    const st = team();
    const better: StatusEntry = {
      ampel: "gruen",
      suggested: "rot",
      reasons: ["R-01 «Lieferverzug»: Eintritt und Auswirkung hoch."],
      problem: "",
      measure: "",
      deviationReason: "Der Lieferant hat geliefert.",
    };
    publish(st, "s1");
    expect(projectSignals(projectSummary(st.state(), MODEL), at(st, 1))).not.toContain("status-abweichung");
    publish(st, "s2", {}, { risiken: better });
    const view = statusReportRegister(st.state(), MODEL, viewer("thomas"), at(st, 1)).items[0]!;
    expect(view.criteria.find((c) => c.id === "risiken")).toMatchObject({
      ampel: "gruen",
      suggested: "rot",
      deviates: true,
      reasons: better.reasons,
      deviationReason: "Der Lieferant hat geliefert.",
    });
    expect(describeEvent(st.events.at(-1)!, MODEL, eventRefs(st.state()))).toBe(
      "Statusbericht 2 veröffentlicht: Gesamtstatus Grün. Besser als vorgeschlagen, mit Begründung: Risiken (Vorschlag Rot).",
    );
    expect(projectSignals(projectSummary(st.state(), MODEL), at(st, 1))).toContain("status-abweichung");
  });

  it("shows red reports and due reports in the portfolio", () => {
    const st = team();
    publish(st, "s1", { kosten: "rot" });
    const p = projectSummary(st.state(), MODEL);
    expect(p.status).toMatchObject({ overall: "rot", number: 1 });
    expect(projectSignals(p, at(st, 1))).toContain("status-rot");
    expect(projectSignals(p, at(st, 1))).not.toContain("statusbericht-faellig");
    expect(projectSignals(p, at(st, 30))).toContain("statusbericht-faellig");
    // A green report right after does not hide the red one until someone took note of it.
    publish(st, "s2");
    expect(projectSignals(projectSummary(st.state(), MODEL), at(st, 1))).toContain("status-rot");
    st.add({ type: "StatusReportAcknowledged", data: { reportId: "s1", note: "" } }, actor("thomas", "PA"));
    expect(projectSignals(projectSummary(st.state(), MODEL), at(st, 1))).not.toContain("status-rot");
  });
});
