import { describe, expect, it } from "vitest";
import {
  DUE_OPTIONS,
  INACTIVE_AFTER_DAYS,
  MODEL,
  PROJECT_ROLES,
  compareByAttention,
  conditionDue,
  isConditionOverdue,
  openParticipation,
  overdueConditions,
  portfolioOverview,
  projectListItem,
  projectSignals,
  projectSummary,
  projectView,
  type PhaseId,
  type ProjectListItem,
  type ProjectRole,
} from "../src";
import { Stream, completeMandatory, viewer } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
/** Time of the stream's last event, plus some days. */
const after = (st: Stream, days: number) => new Date(Date.parse(st.events.at(-1)!.at) + days * DAY);

/** A project in which every role is held, so no role is missing. */
const staffed = (phase: PhaseId) => new Stream(phase).member("anna", ...PROJECT_ROLES);

const skillAuflage = (st: Stream, due: string, id = "c1", skillId = "init.datenklassifizierung") =>
  st.add({
    type: "SkillDecisionRecorded",
    data: {
      skillId,
      role: "ISM",
      decision: "mit Auflagen",
      reason: "Begründung",
      konsent: false,
      conditions: [{ id, text: "Restrisiken ergänzen", ownerRole: "ISM", due }],
    },
  });

const gateDecision = (
  st: Stream,
  phase: PhaseId,
  decision: "freigegeben" | "mit Auflagen" | "zurückgewiesen",
  conditions: { id: string; text: string; ownerRole: ProjectRole; due: string }[] = [],
) =>
  st.add({
    type: "GateDecisionRecorded",
    data: { phase, decision, reason: "Begründung", konsent: true, conditions },
  });

const readyGate = (st: Stream, phase: PhaseId) => {
  completeMandatory(st, phase);
  for (const p of openParticipation(st.state(), MODEL, phase)) st.involve(phase, p.id);
  return st;
};

describe("due dates of Auflagen", () => {
  it("turns every offered option into a date or a gate", () => {
    const st = new Stream("init").run("init.datenklassifizierung");
    DUE_OPTIONS.forEach((due, i) => skillAuflage(st, due, `c${i}`));
    const s = st.state();
    const created = Date.parse(s.conditions.c0!.createdAt);
    expect(conditionDue(MODEL, s.conditions.c0!)).toEqual({
      kind: "date",
      at: new Date(created + 7 * DAY).toISOString(),
    });
    expect(conditionDue(MODEL, s.conditions.c1!)).toEqual({
      kind: "date",
      at: new Date(Date.parse(s.conditions.c1!.createdAt) + 14 * DAY).toISOString(),
    });
    // Within a phase: due at that phase's gate.
    expect(conditionDue(MODEL, s.conditions.c2!)).toEqual({ kind: "gate", phase: "init" });
  });

  it("makes Auflagen of a gate decision due at the following gate, and has no rule for other texts", () => {
    const st = gateDecision(new Stream("init"), "init", "mit Auflagen", [
      { id: "g1", text: "Exit-Klausel prüfen", ownerRole: "PL", due: "bis zum nächsten Gate" },
      { id: "g2", text: "Altbestand", ownerRole: "PL", due: "irgendwann" },
    ]);
    const s = st.state();
    expect(conditionDue(MODEL, s.conditions.g1!)).toEqual({ kind: "gate", phase: "konzept" });
    expect(conditionDue(MODEL, s.conditions.g2!)).toEqual({ kind: "none" });
    expect(isConditionOverdue(s, MODEL, s.conditions.g2!, after(st, 365))).toBe(false);

    const last = gateDecision(new Stream("skal"), "skal", "mit Auflagen", [
      { id: "g3", text: "Wirkung messen", ownerRole: "PL", due: "bis zum nächsten Gate" },
    ]);
    expect(conditionDue(MODEL, last.state().conditions.g3!)).toEqual({ kind: "none" });
  });

  it("is overdue after its date or once its gate is passed, and never when done", () => {
    const st = new Stream("init").run("init.datenklassifizierung");
    skillAuflage(st, "1 Woche", "week");
    skillAuflage(st, "bis zum nächsten Gate", "gate");
    const s = st.state();
    const week = conditionDue(MODEL, s.conditions.week!);
    if (week.kind !== "date") throw new Error("expected a due date");
    const due = Date.parse(week.at);
    expect(isConditionOverdue(s, MODEL, s.conditions.week!, new Date(due))).toBe(false);
    expect(isConditionOverdue(s, MODEL, s.conditions.week!, new Date(due + 1))).toBe(true);
    expect(isConditionOverdue(s, MODEL, s.conditions.gate!, after(st, 365))).toBe(false);

    gateDecision(st, "init", "freigegeben");
    expect(isConditionOverdue(st.state(), MODEL, st.state().conditions.gate!, after(st, 0))).toBe(true);

    st.add({ type: "ConditionCompleted", data: { conditionId: "week", text: "", note: "" } });
    expect(isConditionOverdue(st.state(), MODEL, st.state().conditions.week!, after(st, 365))).toBe(false);
  });

  it("shows due dates and overdue Auflagen in the project view and the tasks", () => {
    const st = staffed("init").run("init.datenklassifizierung");
    skillAuflage(st, "1 Woche");
    const v = projectView(st.state(), MODEL, viewer("anna"), after(st, 8));
    expect(v.conditions[0]).toMatchObject({ due: "1 Woche", overdue: true });
    expect(v.conditions[0]?.dueAt).toBeDefined();
    expect(v.myTasks.find((t) => t.kind === "condition")?.detail).toBe("Frist: 1 Woche · überfällig");
    expect(projectView(st.state(), MODEL, viewer("anna"), after(st, 1)).conditions[0]?.overdue).toBe(false);
  });
});

describe("project summary and signals", () => {
  it("summarizes the current phase independently of the viewer", () => {
    const st = new Stream("init").member("anna", "PL");
    const p = projectSummary(st.state(), MODEL);
    expect(p).toMatchObject({
      phase: "init",
      phaseLabel: "Initialisierung",
      gateName: "Projektfreigabe",
      gateStatus: "open",
      portfolioGate: true,
      projectLeads: ["anna"],
      finished: false,
      lastSeq: st.state().lastSeq,
    });
    expect(p.mandatoryTotal).toBeGreaterThan(0);
    expect(p.missingRoles).toEqual(expect.arrayContaining(["PA", "ISM"]));

    const now = after(st, 0);
    expect(projectListItem(st.state(), MODEL, viewer("anna"), now).myRoles).toEqual(["PL"]);
    expect(projectListItem(st.state(), MODEL, viewer("rita", "HH.Portfolio"), now).myRoles).toEqual([]);
    expect(projectSignals(p, now)).toEqual(["rollen-fehlen"]);
  });

  it("flags a gate blocked by an open veto, and counts the veto as an open decision", () => {
    const st = staffed("konzept").run("konzept.security-engineering").run("konzept.isds");
    const p = projectSummary(st.state(), MODEL);
    expect(p.gateStatus).toBe("blocked");
    expect(p.openDecisions).toBeGreaterThanOrEqual(1);
    expect(projectSignals(p, after(st, 0))).toEqual(["veto"]);
  });

  it("flags a rejected gate until the next decision", () => {
    const st = gateDecision(staffed("init"), "init", "zurückgewiesen");
    expect(projectSignals(projectSummary(st.state(), MODEL), after(st, 0))).toEqual(["gate-zurueckgewiesen"]);
    gateDecision(st, "init", "freigegeben");
    expect(projectSignals(projectSummary(st.state(), MODEL), after(st, 0))).toEqual([]);
  });

  it("flags overdue Auflagen with their number", () => {
    const st = staffed("init").run("init.datenklassifizierung");
    skillAuflage(st, "1 Woche", "a");
    skillAuflage(st, "2 Wochen", "b");
    const p = projectSummary(st.state(), MODEL);
    expect(overdueConditions(p, after(st, 1))).toBe(0);
    expect(overdueConditions(p, after(st, 8))).toBe(1);
    expect(overdueConditions(p, after(st, 15))).toBe(2);
    expect(projectSignals(p, after(st, 8))).toContain("auflagen-ueberfaellig");
    // Same rule as for the single Auflage.
    const s = st.state();
    const now = after(st, 8);
    expect(Object.values(s.conditions).filter((c) => isConditionOverdue(s, MODEL, c, now))).toHaveLength(1);
  });

  it("flags projects without activity, but not finished ones", () => {
    const st = staffed("init");
    const p = projectSummary(st.state(), MODEL);
    expect(projectSignals(p, after(st, INACTIVE_AFTER_DAYS - 1))).toEqual([]);
    expect(projectSignals(p, after(st, INACTIVE_AFTER_DAYS))).toEqual(["ohne-aktivitaet"]);

    const done = gateDecision(staffed("skal"), "skal", "freigegeben");
    const f = projectSummary(done.state(), MODEL);
    expect(f.finished).toBe(true);
    expect(projectSignals(f, after(done, 400))).toEqual([]);
    expect(projectListItem(done.state(), MODEL, viewer("anna"), after(done, 0)).gateStatusLabel).toBe(
      "Abgeschlossen",
    );
  });

  it("flags a gate that is ready for its decision", () => {
    const st = readyGate(staffed("init"), "init");
    const p = projectSummary(st.state(), MODEL);
    expect(p.gateStatus).toBe("ready");
    expect(projectSignals(p, after(st, 0))).toEqual(["gate-bereit"]);
  });

  it("sorts the most urgent projects first", () => {
    const item = (code: string, signals: ProjectListItem["signals"], updatedAt: string) =>
      ({ code, signals, updatedAt }) as ProjectListItem;
    const list = [
      item("NONE", [], "2026-01-01"),
      item("READY", ["gate-bereit"], "2026-01-01"),
      item("TWO", ["gate-zurueckgewiesen", "ohne-aktivitaet"], "2026-01-01"),
      item("VETO-NEW", ["veto"], "2026-03-01"),
      item("VETO-OLD", ["veto"], "2026-02-01"),
      item("ONE", ["rollen-fehlen"], "2026-01-01"),
    ];
    expect(list.sort(compareByAttention).map((x) => x.code)).toEqual([
      "VETO-OLD",
      "VETO-NEW",
      "TWO",
      "ONE",
      "READY",
      "NONE",
    ]);
  });
});

describe("portfolio key figures", () => {
  it("counts projects by phase and gate state, signals and Auflagen", () => {
    const open = staffed("init");
    const veto = staffed("konzept").run("konzept.security-engineering").run("konzept.isds");
    const ready = readyGate(staffed("init"), "init");
    const finished = gateDecision(staffed("skal"), "skal", "freigegeben");
    const late = staffed("init").run("init.datenklassifizierung");
    skillAuflage(late, "1 Woche");

    const now = after(late, 8);
    const items = [open, veto, ready, finished, late].map((st) =>
      projectListItem(st.state(), MODEL, viewer("rita", "HH.Portfolio"), now),
    );
    const o = portfolioOverview(items, MODEL, now);

    expect(o).toMatchObject({ projects: 5, active: 4, finished: 1, portfolioGatesReady: 1 });
    expect(o.asOf).toBe(now.toISOString());
    expect(o.phases.map((p) => p.id)).toEqual(MODEL.phases.map((p) => p.id));
    expect(o.phases.find((p) => p.id === "init")).toMatchObject({ total: 3, open: 2, ready: 1, blocked: 0 });
    expect(o.phases.find((p) => p.id === "konzept")).toMatchObject({ total: 1, blocked: 1 });
    expect(o.phases.find((p) => p.id === "skal")?.total).toBe(0);
    const signals = Object.fromEntries(o.signals.map((x) => [x.id, x.projects]));
    expect(signals).toMatchObject({ veto: 1, "auflagen-ueberfaellig": 1, "gate-bereit": 1 });
    expect(o.openConditions).toBe(1);
    expect(o.overdueConditions).toBe(1);
    expect(o.openDecisions).toBe(items.reduce((n, p) => n + p.openDecisions, 0));
  });

  it("is empty without projects", () => {
    const o = portfolioOverview([], MODEL, new Date("2026-10-10T00:00:00Z"));
    expect(o).toMatchObject({ projects: 0, active: 0, finished: 0, overdueConditions: 0 });
    expect(o.signals.every((x) => x.projects === 0)).toBe(true);
  });
});
