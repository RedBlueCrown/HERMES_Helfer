import { describe, expect, it } from "vitest";
import {
  MODEL,
  NO_FLAGS,
  PROJECT_ROLES,
  changeImpact,
  changeRequestRegister,
  checkConfirmRecheck,
  checkDecideChangeRequest,
  checkSetChangeReserve,
  checkSubmitChangeRequest,
  checkWithdrawChangeRequest,
  describeEvent,
  eventCategory,
  gateCriteria,
  gateStatus,
  impactContext,
  impactSummary,
  missingRoles,
  myTasks,
  nextCrNumber,
  nextStep,
  openParticipation,
  projectSignals,
  projectSummary,
  projectView,
  reserveStatus,
  validateDecision,
  type Actor,
  type CrFlags,
  type Decision,
  type ImpactRow,
  type PhaseId,
  type ProjectRole,
} from "../src";
import { Stream, completeMandatory, viewer } from "./helpers";

const actor = (userId: string, ...roles: string[]): Actor => ({
  userId,
  displayName: userId,
  roles,
  channel: "web",
});

const submit = (st: Stream, crId: string, flags: Partial<CrFlags> = {}, effortDays = 6, by = "nina") =>
  st.add(
    {
      type: "ChangeRequestSubmitted",
      data: {
        crId,
        number: nextCrNumber(st.state()),
        title: `Änderung ${crId}`,
        requestedBy: "Fachstelle",
        effortDays,
        flags: { ...NO_FLAGS, ...flags },
        content: { summary: "Kurzbeschreibung", sections: [], openPoints: [] },
        findings: [],
        producer: { kind: "human" },
      },
    },
    actor(by, "FACH"),
  );

const decide = (st: Stream, crId: string, decision: Decision = "freigegeben", conditions = 0) =>
  st.add(
    {
      type: "ChangeRequestDecided",
      data: {
        crId,
        decision,
        reason: "Im Rahmen der Reserve.",
        konsent: decision !== "zurückgewiesen",
        conditions: Array.from({ length: conditions }, (_, i) => ({
          id: `${crId}-a${i}`,
          text: "Schulung ergänzen",
          ownerRole: "PL" as ProjectRole,
          due: "bis zum nächsten Gate",
        })),
      },
    },
    actor("thomas", "PA"),
  );

const recheck = (st: Stream, crId: string, role: "ISM" | "DS") =>
  st.add(
    { type: "ChangeRecheckConfirmed", data: { crId, role, outcome: "keine Anpassung", note: "" } },
    actor(role === "ISM" ? "marco" : "sandra", role),
  );

/** All roles held by different people, as in a real project. */
const team = (phase: PhaseId) =>
  new Stream(phase)
    .member("anna", "PL")
    .member("thomas", "PA")
    .member("nina", "FACH")
    .member("marco", "ISM")
    .member("sandra", "DS")
    .member("rest", ...PROJECT_ROLES.filter((r) => !["PL", "PA", "FACH", "ISM", "DS"].includes(r)));

const level = (rows: ImpactRow[], id: ImpactRow["id"]) => rows.find((r) => r.id === id)!;

describe("impact of a change request", () => {
  it("estimates eight dimensions from the effort and what the request touches", () => {
    const s = team("init").state();
    const rows = changeImpact(
      { effortDays: 6, flags: { ...NO_FLAGS, oberflaeche: true } },
      impactContext(s),
      MODEL,
    );
    expect(rows.map((r) => r.id)).toEqual([
      "budget",
      "termin",
      "architektur",
      "sicherheit",
      "test",
      "schulung",
      "betrieb",
      "abnahme",
    ]);
    // No reserve recorded: the cost is not covered.
    expect(level(rows, "budget")).toMatchObject({ level: "hoch" });
    expect(level(rows, "budget").text).toContain("7'200 CHF");
    expect(level(rows, "termin")).toMatchObject({ level: "niedrig" });
    expect(level(rows, "termin").text).toContain("2 Arbeitstage");
    expect(level(rows, "sicherheit")).toMatchObject({ level: "niedrig", text: "keine Neuprüfung nötig" });
    expect(level(rows, "schulung").text).toBe("Schulungsunterlagen anpassen");
    expect(impactSummary(rows)).toBe("Hohe Auswirkung auf: Budget");
  });

  it("counts accepted requests against the reserve", () => {
    const st = team("konzept").add({ type: "ChangeReserveSet", data: { amountChf: 40_000 } });
    submit(st, "cr-a", {}, 6);
    decide(st, "cr-a");
    const s = st.state();
    expect(reserveStatus(s)).toEqual({ reserveChf: 40_000, usedChf: 7_200, remainingChf: 32_800 });
    const rows = changeImpact({ effortDays: 9, flags: NO_FLAGS }, impactContext(s), MODEL);
    expect(level(rows, "budget")).toMatchObject({ level: "mittel" });
    expect(level(rows, "budget").text).toContain("Reserve danach 22'000 CHF");
    // The accepted request itself is not counted twice.
    expect(
      level(changeImpact({ effortDays: 6, flags: NO_FLAGS }, impactContext(s, "cr-a"), MODEL), "budget").text,
    ).toContain("Reserve danach 32'800 CHF");
    const big = changeImpact({ effortDays: 40, flags: NO_FLAGS }, impactContext(s), MODEL);
    expect(level(big, "budget")).toMatchObject({ level: "hoch" });
    expect(level(big, "budget").text).toContain("(überschritten)");
  });

  it("rates data, interfaces, special solutions and late changes higher", () => {
    const late = team("real").state();
    const rows = changeImpact(
      {
        effortDays: 12,
        flags: { ...NO_FLAGS, daten: true, schnittstelle: true, sonderloesung: true, extern: true },
      },
      impactContext(late),
      MODEL,
    );
    expect(level(rows, "termin")).toMatchObject({ level: "hoch" });
    expect(level(rows, "termin").text).toContain("verschiebt den Go-live");
    expect(level(rows, "sicherheit").level).toBe("hoch");
    expect(level(rows, "architektur").text).toContain("neue Schnittstelle");
    expect(level(rows, "test")).toMatchObject({ level: "mittel" });
    expect(level(rows, "schulung")).toMatchObject({ level: "mittel", text: "externe Nutzende informieren" });
    expect(level(rows, "betrieb").level).toBe("hoch");
  });
});

describe("change request lifecycle", () => {
  it("accepts a request that touches personal data and holds the gate until ISM and Datenschutz recheck", () => {
    const st = team("init");
    completeMandatory(st, "init");
    for (const p of openParticipation(st.state(), MODEL, "init")) st.involve("init", p.id);
    expect(gateStatus(st.state(), MODEL, "init")).toBe("ready");

    submit(st, "cr-data", { daten: true });
    expect(st.state().changeRequests["cr-data"]?.status).toBe("offen");
    // An open request alone does not hold the gate.
    expect(gateStatus(st.state(), MODEL, "init")).toBe("ready");

    decide(st, "cr-data");
    const s = st.state();
    expect(s.changeRequests["cr-data"]).toMatchObject({ status: "angenommen", recheck: {} });
    expect(gateStatus(s, MODEL, "init")).toBe("open");
    const criterion = gateCriteria(s, MODEL, "init").find((c) => c.id === "neupruefung");
    expect(criterion).toMatchObject({ ok: false, blocking: true });
    expect(criterion?.detail).toContain("Informationssicherheit (ISM) und Datenschutz");
    expect(nextStep(s, MODEL)).toEqual({ kind: "recheck", crIds: ["cr-data"] });

    recheck(st, "cr-data", "ISM");
    expect(gateStatus(st.state(), MODEL, "init")).toBe("open");
    recheck(st, "cr-data", "DS");
    expect(gateStatus(st.state(), MODEL, "init")).toBe("ready");
    expect(gateCriteria(st.state(), MODEL, "init").some((c) => c.id === "neupruefung")).toBe(false);
  });

  it("needs no recheck for rejected requests or requests without personal data", () => {
    const st = team("konzept");
    submit(st, "cr-ui", { oberflaeche: true });
    decide(st, "cr-ui");
    submit(st, "cr-no", { daten: true });
    decide(st, "cr-no", "zurückgewiesen");
    const s = st.state();
    expect(s.changeRequests["cr-ui"]).toMatchObject({ status: "angenommen" });
    expect(s.changeRequests["cr-ui"]?.recheck).toBeUndefined();
    expect(s.changeRequests["cr-no"]).toMatchObject({ status: "abgelehnt" });
    expect(s.changeRequests["cr-no"]?.recheck).toBeUndefined();
  });

  it("turns Auflagen of the decision into conditions due at the gate of the phase", () => {
    const st = team("konzept");
    submit(st, "cr-a");
    decide(st, "cr-a", "mit Auflagen", 1);
    const v = projectView(st.state(), MODEL, viewer("anna"));
    expect(v.conditions[0]).toMatchObject({
      sourceLabel: "Entscheid zu CR-01",
      dueGate: "Phasenfreigabe Realisierung",
      overdue: false,
    });
    const register = changeRequestRegister(st.state(), MODEL, viewer("anna"));
    expect(register.items[0]?.conditions).toHaveLength(1);
  });
});

describe("change request permissions and tasks", () => {
  it("lets members submit, the requester or PL withdraw, and only the Projektausschuss decide", () => {
    const st = team("konzept");
    const s0 = st.state();
    expect(checkSubmitChangeRequest(s0, MODEL, viewer("nina")).ok).toBe(true);
    expect(checkSubmitChangeRequest(s0, MODEL, viewer("peter", "HH.PMO"))).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    submit(st, "cr-a", {}, 6, "nina");
    const s = st.state();
    expect(checkWithdrawChangeRequest(s, viewer("nina"), "cr-a").ok).toBe(true);
    expect(checkWithdrawChangeRequest(s, viewer("anna"), "cr-a").ok).toBe(true);
    expect(checkWithdrawChangeRequest(s, viewer("marco"), "cr-a").ok).toBe(false);
    expect(checkDecideChangeRequest(s, viewer("anna"), "cr-a")).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(checkDecideChangeRequest(s, viewer("thomas"), "cr-a").ok).toBe(true);
    expect(checkSetChangeReserve(s, MODEL, viewer("anna")).ok).toBe(true);
    expect(checkSetChangeReserve(s, MODEL, viewer("thomas")).ok).toBe(false);

    decide(st, "cr-a");
    expect(checkDecideChangeRequest(st.state(), viewer("thomas"), "cr-a")).toMatchObject({
      ok: false,
      code: "invalid_state",
    });
    expect(checkWithdrawChangeRequest(st.state(), viewer("nina"), "cr-a").ok).toBe(false);
  });

  it("asks ISM and Datenschutz only for their own part of the recheck", () => {
    const st = team("konzept");
    submit(st, "cr-d", { daten: true });
    expect(checkConfirmRecheck(st.state(), viewer("marco"), "cr-d", "ISM").ok).toBe(false); // not accepted yet
    decide(st, "cr-d");
    const s = st.state();
    expect(checkConfirmRecheck(s, viewer("marco"), "cr-d", "ISM").ok).toBe(true);
    expect(checkConfirmRecheck(s, viewer("marco"), "cr-d", "DS")).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(myTasks(s, MODEL, viewer("sandra"))).toContainEqual({ kind: "recheck", crId: "cr-d", role: "DS" });
    recheck(st, "cr-d", "ISM");
    expect(checkConfirmRecheck(st.state(), viewer("marco"), "cr-d", "ISM").ok).toBe(false);
  });

  it("gives the Projektausschuss a task per open request", () => {
    const st = team("konzept");
    submit(st, "cr-a");
    expect(myTasks(st.state(), MODEL, viewer("thomas"))).toContainEqual({ kind: "decide-cr", crId: "cr-a" });
    const task = projectView(st.state(), MODEL, viewer("thomas")).myTasks.find((t) => t.kind === "decide-cr");
    expect(task?.title).toBe("CR-01 entscheiden: Änderung cr-a");
  });

  it("names ISM as missing when nobody can do the recheck", () => {
    const st = new Stream("konzept").member("anna", "PL").member("thomas", "PA");
    submit(st, "cr-d", { daten: true }, 6, "anna");
    decide(st, "cr-d");
    expect(missingRoles(st.state(), MODEL, "konzept")).toEqual(expect.arrayContaining(["ISM", "DS"]));
  });

  it("requires a reason for every decision on a change request", () => {
    const input = { decision: "freigegeben" as const, reason: "", konsent: true, conditions: [] };
    const ctx = { veto: false, konsentRequired: true, openChecklistItems: 0, reasonRequired: true };
    expect(validateDecision(input, ctx)).toMatch(/Begründung/);
    expect(validateDecision({ ...input, reason: "Im Rahmen der Reserve." }, ctx)).toBeNull();
    expect(validateDecision({ ...input, reason: "Im Rahmen der Reserve.", konsent: false }, ctx)).toMatch(
      /Konsent/,
    );
  });
});

describe("change requests in views, the record and the portfolio", () => {
  it("lists requests newest first with impact, status and actions", () => {
    const st = team("konzept").add({ type: "ChangeReserveSet", data: { amountChf: 30_000 } });
    submit(st, "cr-1", { daten: true }, 9);
    submit(st, "cr-2", { oberflaeche: true }, 3);
    decide(st, "cr-1");
    const r = changeRequestRegister(st.state(), MODEL, viewer("thomas"));
    expect(r.items.map((x) => x.label)).toEqual(["CR-02", "CR-01"]);
    expect(r.reserve).toMatchObject({ reserveChf: 30_000, usedChf: 10_800, remainingChf: 19_200 });
    expect(r.items[0]).toMatchObject({
      status: "offen",
      statusLabel: "Wartet auf Entscheid",
      costChf: 3_600,
    });
    expect(r.items[0]?.canDecide.ok).toBe(true);
    expect(r.items[1]?.recheck).toMatchObject({ done: false });
    expect(r.items[1]?.recheck?.deliverables.map((d) => d.id)).toEqual(["schuban", "dsvor", "isds", "dsfa"]);
    expect(projectView(st.state(), MODEL, viewer("anna")).changeRequests).toEqual({
      total: 2,
      open: 1,
      openRechecks: 1,
    });
  });

  it("describes the events in German", () => {
    const st = team("konzept");
    submit(st, "cr-1", {}, 4);
    decide(st, "cr-1");
    const numbersById = new Map([["cr-1", st.state().changeRequests["cr-1"]!.number]]);
    const [submitted, decided] = st.events.slice(-2);
    expect(eventCategory(submitted!)).toBe("aenderung");
    expect(describeEvent(submitted!, MODEL, numbersById)).toBe(
      "CR-01 «Änderung cr-1» erfasst (4 Personentage).",
    );
    expect(describeEvent(decided!, MODEL, numbersById)).toBe(
      "CR-01 freigegeben durch den Projektausschuss (Konsent festgestellt): Im Rahmen der Reserve.",
    );
  });

  it("shows open requests and open rechecks in the portfolio", () => {
    const st = team("konzept");
    submit(st, "cr-1");
    submit(st, "cr-2", { daten: true });
    decide(st, "cr-2");
    const p = projectSummary(st.state(), MODEL);
    expect(p).toMatchObject({ openChangeRequests: 1, openRechecks: 1 });
    expect(projectSignals(p, new Date(st.events.at(-1)!.at))).toEqual(["neupruefung", "cr-offen"]);
  });
});
