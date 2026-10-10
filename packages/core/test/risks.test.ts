import { describe, expect, it } from "vitest";
import {
  MODEL,
  NO_FLAGS,
  PROJECT_ROLES,
  checkAssessRisk,
  checkRecordRisk,
  checkReviewRisks,
  describeEvent,
  eventCategory,
  eventRefs,
  myTasks,
  nextCrNumber,
  nextRiskNumber,
  projectSignals,
  projectSummary,
  projectView,
  riskMatrix,
  riskRegister,
  riskScore,
  riskTriggers,
  scoreLevel,
  similarOpenRisk,
  type Actor,
  type Level,
  type PhaseId,
  type ProjectRole,
  type RiskStatus,
} from "../src";
import { PROFILE, Stream, completeMandatory, viewer } from "./helpers";

const actor = (userId: string, ...roles: string[]): Actor => ({
  userId,
  displayName: userId,
  roles,
  channel: "web",
});

const record = (
  st: Stream,
  riskId: string,
  probability: Level,
  impact: Level,
  ownerRole: ProjectRole = "FACH",
  opts: { title?: string; mitigation?: string; ai?: boolean } = {},
) =>
  st.add(
    {
      type: "RiskRecorded",
      data: {
        riskId,
        number: nextRiskNumber(st.state()),
        title: opts.title ?? `Risiko ${riskId}`,
        description: "",
        probability,
        impact,
        ownerRole,
        mitigation: opts.mitigation ?? "",
        producer: opts.ai ? { kind: "ai", agent: "A12", provider: "mock", model: "mock" } : { kind: "human" },
      },
    },
    actor("nina", "FACH"),
  );

const assess = (
  st: Stream,
  riskId: string,
  probability: Level,
  impact: Level,
  status: RiskStatus = "offen",
  note = "",
) => {
  const r = st.state().risks[riskId]!;
  return st.add(
    {
      type: "RiskAssessed",
      data: {
        riskId,
        probability,
        impact,
        status,
        ownerRole: r.ownerRole,
        mitigation: r.mitigation || "Massnahme",
        note,
        producer: { kind: "human" },
      },
    },
    actor("anna", "PL"),
  );
};

/** All roles held by different people. */
const team = (phase: PhaseId = "konzept") =>
  new Stream(phase)
    .member("anna", "PL")
    .member("thomas", "PA")
    .member("nina", "FACH")
    .member("marco", "ISM")
    .member("rest", ...PROJECT_ROLES.filter((r) => !["PL", "PA", "FACH", "ISM"].includes(r)));

describe("risk score", () => {
  it("multiplies probability and impact and rates from 6 high, from 3 medium", () => {
    expect(riskScore("hoch", "hoch")).toBe(9);
    expect(riskScore("mittel", "hoch")).toBe(6);
    expect(scoreLevel(6)).toBe("hoch");
    expect(scoreLevel(riskScore("mittel", "mittel"))).toBe("mittel");
    expect(scoreLevel(riskScore("niedrig", "hoch"))).toBe("mittel");
    expect(scoreLevel(riskScore("niedrig", "mittel"))).toBe("niedrig");
  });
});

describe("risk lifecycle", () => {
  it("records, reassesses and closes a risk, keeping every assessment", () => {
    const st = team();
    record(st, "r1", "mittel", "mittel", "FACH", { mitigation: "Testfenster reservieren" });
    let r = st.state().risks["r1"]!;
    expect(r).toMatchObject({ number: 1, status: "offen", phase: "konzept", probability: "mittel" });
    expect(r.history).toHaveLength(1);

    assess(st, "r1", "hoch", "mittel", "in Bearbeitung", "Fachtester fehlen im Q4");
    r = st.state().risks["r1"]!;
    expect(r).toMatchObject({ probability: "hoch", status: "in Bearbeitung" });
    expect(r.history).toHaveLength(2);
    expect(riskRegister(st.state(), MODEL, viewer("anna")).items[0]).toMatchObject({
      label: "R-01",
      score: 6,
      level: "hoch",
      trend: "steigend",
    });

    assess(st, "r1", "niedrig", "mittel", "geschlossen", "Testfenster bestätigt");
    const reg = riskRegister(st.state(), MODEL, viewer("anna"));
    expect(reg.counts).toEqual({ open: 0, high: 0, closed: 1 });
    expect(reg.items[0]).toMatchObject({ open: false, trend: "sinkend", status: "geschlossen" });
    expect(reg.items[0]!.history.map((h) => h.status)).toEqual(["offen", "in Bearbeitung", "geschlossen"]);
  });

  it("lists open risks by score, then closed ones, and counts open risks in the matrix", () => {
    const st = team();
    record(st, "a", "niedrig", "mittel");
    record(st, "b", "hoch", "hoch");
    record(st, "c", "mittel", "hoch");
    record(st, "d", "mittel", "mittel");
    assess(st, "d", "mittel", "mittel", "geschlossen", "erledigt");
    const reg = riskRegister(st.state(), MODEL, viewer("anna"));
    expect(reg.items.map((r) => r.label)).toEqual(["R-02", "R-03", "R-01", "R-04"]);
    expect(reg.counts).toEqual({ open: 3, high: 2, closed: 1 });
    // matrix[probability][impact], order niedrig, mittel, hoch
    expect(riskMatrix(st.state())).toEqual([
      [0, 1, 0],
      [0, 0, 1],
      [0, 0, 1],
    ]);
    expect(projectView(st.state(), MODEL, viewer("anna")).risks).toEqual({ total: 4, open: 3, high: 2 });
  });
});

describe("risk permissions and tasks", () => {
  it("lets members record, the PL or the responsible role assess, and only the PL ask the agent", () => {
    const st = team();
    record(st, "r1", "mittel", "hoch", "FACH");
    const s = st.state();
    expect(checkRecordRisk(s, MODEL, viewer("marco")).ok).toBe(true);
    expect(checkRecordRisk(s, MODEL, viewer("pmo", "HH.PMO")).ok).toBe(false);
    expect(checkAssessRisk(s, MODEL, viewer("anna"), "r1").ok).toBe(true);
    expect(checkAssessRisk(s, MODEL, viewer("nina"), "r1").ok).toBe(true);
    expect(checkAssessRisk(s, MODEL, viewer("marco"), "r1")).toMatchObject({ ok: false, code: "forbidden" });
    expect(checkAssessRisk(s, MODEL, viewer("anna"), "nope")).toMatchObject({
      ok: false,
      code: "invalid_state",
    });
    expect(checkReviewRisks(s, MODEL, viewer("anna")).ok).toBe(true);
    expect(checkReviewRisks(s, MODEL, viewer("nina"))).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("gives the responsible role a task for a high risk until someone works on it", () => {
    const st = team();
    record(st, "r1", "mittel", "hoch", "FACH");
    record(st, "r2", "mittel", "mittel", "FACH");
    const tasks = () => myTasks(st.state(), MODEL, viewer("nina")).filter((t) => t.kind === "risk");
    expect(tasks()).toEqual([{ kind: "risk", riskId: "r1" }]);
    const view = projectView(st.state(), MODEL, viewer("nina")).myTasks.find((t) => t.kind === "risk");
    expect(view).toMatchObject({ title: "Hohes Risiko R-01: Risiko r1", riskId: "r1" });
    expect(view!.detail).toContain("Massnahme festlegen");
    expect(myTasks(st.state(), MODEL, viewer("anna")).some((t) => t.kind === "risk")).toBe(false);
    assess(st, "r1", "mittel", "hoch", "in Bearbeitung");
    expect(tasks()).toEqual([]);
  });
});

describe("risks in the record and the portfolio", () => {
  it("describes the events in German", () => {
    const st = team();
    record(st, "r1", "mittel", "hoch", "PL", { ai: true });
    assess(st, "r1", "hoch", "hoch", "in Bearbeitung", "Lieferant meldet Verzug");
    assess(st, "r1", "niedrig", "hoch", "geschlossen", "Release geliefert");
    const refs = eventRefs(st.state());
    const [recorded, assessed, closed] = st.events.slice(-3);
    expect(eventCategory(recorded!)).toBe("risiko");
    expect(describeEvent(recorded!, MODEL, refs)).toBe(
      "R-01 «Risiko r1» erfasst (Eintritt mittel, Auswirkung hoch, verantwortlich Projektleitung; vom Risiko-Agenten vorgeschlagen).",
    );
    expect(describeEvent(assessed!, MODEL, refs)).toBe(
      "R-01 neu beurteilt: Eintritt hoch, Auswirkung hoch, in Bearbeitung: Lieferant meldet Verzug",
    );
    expect(describeEvent(closed!, MODEL, refs)).toBe("R-01 geschlossen: Release geliefert");
  });

  it("flags projects with open high risks", () => {
    const st = team();
    record(st, "r1", "mittel", "mittel");
    const now = new Date(Date.parse(st.events.at(-1)!.at));
    expect(projectSignals(projectSummary(st.state(), MODEL), now)).not.toContain("risiko-hoch");
    record(st, "r2", "hoch", "mittel");
    const p = projectSummary(st.state(), MODEL);
    expect(p).toMatchObject({ openRisks: 2, highRisks: 1 });
    expect(projectSignals(p, now)).toContain("risiko-hoch");
    assess(st, "r2", "hoch", "mittel", "geschlossen", "erledigt");
    expect(projectSignals(projectSummary(st.state(), MODEL), now)).not.toContain("risiko-hoch");
  });
});

describe("facts for the Risiko agent", () => {
  it("names the profile, missing roles and participants, change requests and a blocked gate", () => {
    const st = new Stream("konzept", { ...PROFILE, lieferant: true, cloud: true, personendaten: true })
      .member("anna", "PL")
      .member("thomas", "PA");
    st.add(
      {
        type: "ChangeRequestSubmitted",
        data: {
          crId: "cr-1",
          number: nextCrNumber(st.state()),
          title: "Export für die Revision",
          requestedBy: "Revision",
          effortDays: 10,
          flags: { ...NO_FLAGS, daten: true },
          content: { summary: "Export", sections: [], openPoints: [] },
          findings: [],
          producer: { kind: "human" },
        },
      },
      actor("anna", "PL"),
    );
    const ids = riskTriggers(st.state(), MODEL, new Date()).map((t) => t.id);
    expect(ids).toEqual(
      expect.arrayContaining(["rolle:ISM", "beteiligung", "cr:cr-1", "profil:lieferant", "profil:cloud"]),
    );
    const cr = riskTriggers(st.state(), MODEL, new Date()).find((t) => t.id === "cr:cr-1")!;
    expect(cr.text).toContain("CR-01 «Export für die Revision» wartet auf den Entscheid (10 Personentage");
  });

  it("names nothing for a finished project", () => {
    const st = new Stream("skal", { ...PROFILE, lieferant: true }).member("anna", ...PROJECT_ROLES);
    completeMandatory(st, "skal");
    st.add({
      type: "GateDecisionRecorded",
      data: { phase: "skal", decision: "freigegeben", reason: "ok", konsent: true, conditions: [] },
    });
    expect(riskTriggers(st.state(), MODEL, new Date())).toEqual([]);
  });

  it("finds an open risk with a similar title", () => {
    const st = team();
    record(st, "r1", "mittel", "hoch", "PL", { title: "Lieferantenverzug beim Release" });
    record(st, "r2", "mittel", "mittel", "FACH", { title: "Engpass bei Fachtestern im Q4" });
    expect(similarOpenRisk(st.state(), "Verzug des Lieferanten beim Release-Upgrade")?.id).toBe("r1");
    expect(similarOpenRisk(st.state(), "Engpässe bei den Fachtestern")?.id).toBe("r2");
    expect(similarOpenRisk(st.state(), "Unklare Rechtsgrundlage")).toBeUndefined();
  });
});
