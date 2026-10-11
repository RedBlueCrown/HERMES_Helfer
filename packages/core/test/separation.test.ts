import { describe, expect, it } from "vitest";
import {
  CONTROL_ROLES,
  MODEL,
  NO_FLAGS,
  PROJECT_ROLES,
  STATUS_CRITERION_IDS,
  assignableRoles,
  changeRequestRegister,
  checkAcknowledgeStatusReport,
  checkAssignRole,
  checkConfirmRecheck,
  checkDecideChangeRequest,
  checkDecideGate,
  checkDecideSkill,
  checkRemoveRole,
  decisionRolesFor,
  gateCriteria,
  missingRoleDetails,
  myTasks,
  nextCrNumber,
  projectSignals,
  projectSummary,
  projectView,
  roleConflict,
  withPolicy,
  type Actor,
  type ProjectRole,
  type StatusCriterion,
} from "../src";
import { Stream, viewer } from "./helpers";

const RELAXED = withPolicy(MODEL, { separationOfDuties: false });

const actor = (userId: string, ...roles: string[]): Actor => ({
  userId,
  displayName: userId,
  roles,
  channel: "web",
});

const team = () =>
  new Stream("init")
    .member("anna", "PL")
    .member("thomas", "PA")
    .member("lisa", "PA")
    .member("nina", "FACH")
    .member("marco", "ISM")
    .member("sandra", "DS");

const submit = (st: Stream, crId: string, by: string, daten = false) =>
  st.add(
    {
      type: "ChangeRequestSubmitted",
      data: {
        crId,
        number: nextCrNumber(st.state()),
        title: `Änderung ${crId}`,
        requestedBy: "Fachstelle",
        effortDays: 3,
        flags: { ...NO_FLAGS, daten },
        content: { summary: "Kurzbeschreibung", sections: [], openPoints: [] },
        findings: [],
        producer: { kind: "human" },
      },
    },
    actor(by),
  );

const accept = (st: Stream, crId: string) =>
  st.add(
    {
      type: "ChangeRequestDecided",
      data: {
        crId,
        decision: "freigegeben",
        reason: "Im Rahmen der Reserve.",
        konsent: true,
        conditions: [],
      },
    },
    actor("lisa", "PA"),
  );

describe("separation of duties", () => {
  it("keeps the project lead out of the control roles", () => {
    expect(CONTROL_ROLES).toEqual(["PA", "ISM", "DS"]);
    for (const role of CONTROL_ROLES) {
      expect(roleConflict(["PL"], role)).toBe("PL");
      expect(roleConflict([role], "PL")).toBe(role);
    }
    expect(roleConflict(["PL"], "BC")).toBeUndefined();
    // The control roles may be combined: small projects have one person for ISM and data protection.
    expect(roleConflict(["ISM"], "DS")).toBeUndefined();
  });

  it("lets the PMO assign the control roles and the project lead the others", () => {
    const s = team().state();
    const anna = viewer("anna");
    const peter = viewer("peter", "HH.PMO");
    expect(checkAssignRole(s, MODEL, anna, "rolf", "PA")).toMatchObject({
      code: "forbidden",
      reason: "Die Rolle Auftraggeber / Projektausschuss vergibt und entzieht das PMO (Funktionentrennung).",
    });
    expect(checkAssignRole(s, MODEL, anna, "rolf", "FACH").ok).toBe(true);
    expect(checkAssignRole(s, MODEL, peter, "rolf", "ISM").ok).toBe(true);
    expect(checkRemoveRole(s, MODEL, anna, "thomas", "PA")).toMatchObject({ code: "forbidden" });
    expect(checkRemoveRole(s, MODEL, peter, "thomas", "PA").ok).toBe(true);
    expect(checkRemoveRole(s, MODEL, anna, "nina", "FACH").ok).toBe(true);
    expect(checkRemoveRole(s, MODEL, peter, "anna", "PL")).toMatchObject({
      reason: "Mindestens eine Projektleitung muss im Vorhaben bleiben.",
    });

    expect(assignableRoles(s, MODEL, anna)).toEqual(PROJECT_ROLES.filter((r) => !CONTROL_ROLES.includes(r)));
    expect(assignableRoles(s, MODEL, peter)).toEqual([...PROJECT_ROLES]);
    expect(assignableRoles(s, MODEL, viewer("nina"))).toEqual([]);
    expect(projectView(s, MODEL, anna).can.assignRoles).not.toContain("PA");
  });

  it("refuses one person in a control role and the project lead, whoever assigns", () => {
    const s = team().state();
    const peter = viewer("peter", "HH.PMO");
    expect(checkAssignRole(s, MODEL, peter, "anna", "PA")).toMatchObject({
      code: "invalid_state",
      reason:
        "Die Person hat bereits die Rolle Projektleitung. Die Rolle Auftraggeber / Projektausschuss nimmt eine andere Person wahr (Funktionentrennung).",
    });
    expect(checkAssignRole(s, MODEL, peter, "marco", "PL")).toMatchObject({ code: "invalid_state" });
    expect(checkAssignRole(s, MODEL, peter, "anna", "PL")).toMatchObject({
      reason: "Die Person hat diese Rolle bereits.",
    });
  });

  it("four-eyes principle: nobody decides or rechecks their own change request", () => {
    const st = team();
    submit(st, "cr-own", "thomas");
    let s = st.state();
    expect(checkDecideChangeRequest(s, MODEL, viewer("thomas"), "cr-own")).toMatchObject({
      code: "forbidden",
      reason:
        "Über einen eigenen Change Request entscheidet ein anderes Mitglied des Projektausschusses (Vier-Augen-Prinzip).",
    });
    expect(checkDecideChangeRequest(s, MODEL, viewer("lisa"), "cr-own").ok).toBe(true);
    expect(myTasks(s, MODEL, viewer("thomas")).some((t) => t.kind === "decide-cr")).toBe(false);
    expect(myTasks(s, MODEL, viewer("lisa"))).toContainEqual({ kind: "decide-cr", crId: "cr-own" });

    submit(st, "cr-data", "marco", true);
    accept(st, "cr-data");
    s = st.state();
    expect(checkConfirmRecheck(s, MODEL, viewer("marco"), "cr-data", "ISM")).toMatchObject({
      code: "forbidden",
      reason:
        "Die Neuprüfung eines eigenen Change Requests bestätigt eine andere Person mit der Rolle Informationssicherheit (ISM) (Vier-Augen-Prinzip).",
    });
    expect(checkConfirmRecheck(s, MODEL, viewer("sandra"), "cr-data", "DS").ok).toBe(true);
    expect(myTasks(s, MODEL, viewer("marco")).some((t) => t.kind === "recheck")).toBe(false);
    const roles = changeRequestRegister(s, MODEL, viewer("marco")).items.find((c) => c.id === "cr-data")!
      .recheck!.roles;
    expect(roles.find((r) => r.role === "ISM")).toMatchObject({
      canConfirm: false,
      blocked: expect.stringContaining("Vier-Augen-Prinzip"),
    });
    // Only who holds the role is told why: the others see the open recheck.
    expect(roles.find((r) => r.role === "DS")!.blocked).toBeUndefined();

    // The test environment relaxes the rule.
    expect(checkDecideChangeRequest(s, RELAXED, viewer("thomas"), "cr-own").ok).toBe(true);
    expect(checkConfirmRecheck(s, RELAXED, viewer("marco"), "cr-data", "ISM").ok).toBe(true);
  });

  it("does not let a control role act next to the lead role, also when given before the rule applied", () => {
    const st = team().member("anna", "PA", "ISM");
    submit(st, "cr-1", "nina");
    const green = { ampel: "gruen", suggested: "gruen", problem: "", measure: "" } as const;
    st.add({
      type: "StatusReportPublished",
      data: {
        reportId: "s1",
        number: 1,
        criteria: Object.fromEntries(STATUS_CRITERION_IDS.map((c) => [c, green])) as Record<
          StatusCriterion,
          typeof green
        >,
        overview: "Planmässig.",
        outlook: "Gate im nächsten Monat.",
        figures: {},
        phase: "init",
        mandatory: { done: 0, total: 4 },
        risks: [],
        producer: { kind: "human" },
      },
    });
    const s = st.state();
    const anna = viewer("anna");
    const clash = {
      code: "forbidden",
      reason: expect.stringContaining("Du hast in diesem Vorhaben auch die Rolle Projektleitung."),
    };
    expect(checkDecideChangeRequest(s, MODEL, anna, "cr-1")).toMatchObject(clash);
    expect(checkAcknowledgeStatusReport(s, MODEL, anna, "s1")).toMatchObject(clash);
    expect(checkDecideGate(s, MODEL, anna, "init")).toMatchObject({
      reason:
        "Die Projektleitung entscheidet nicht über das Gate des eigenen Vorhabens (Funktionentrennung).",
    });
    const tasks = myTasks(s, MODEL, anna).map((t) => t.kind);
    expect(tasks).not.toContain("decide-cr");
    expect(tasks).not.toContain("acknowledge-report");

    expect(checkDecideChangeRequest(s, RELAXED, anna, "cr-1").ok).toBe(true);
    expect(checkAcknowledgeStatusReport(s, RELAXED, anna, "s1").ok).toBe(true);
  });

  it("keeps approvals of the lead's own project with the control roles", () => {
    const st = team().member("anna", "ISM");
    st.run("init.datenklassifizierung");
    const s = st.state();
    const skill = MODEL.skill("init.datenklassifizierung");
    const role: ProjectRole = "ISM";
    expect(decisionRolesFor(s, MODEL, viewer("anna"), skill)).toEqual([]);
    expect(checkDecideSkill(s, MODEL, viewer("anna"), skill, role)).toMatchObject({ code: "forbidden" });
    expect(checkDecideSkill(s, MODEL, viewer("marco"), skill, role).ok).toBe(true);
    expect(decisionRolesFor(s, RELAXED, viewer("anna"), skill).map((a) => a.role)).toEqual(["ISM"]);
  });

  it("never lets the project lead cast a veto, whatever role they hold", () => {
    const st = new Stream("einf")
      .member("anna", "PL", "FACH", "APM")
      .member("nina", "FACH")
      .member("thomas", "PA")
      .run("einf.go-live-check");
    const s = st.state();
    const skill = MODEL.skill("einf.go-live-check");
    expect(decisionRolesFor(s, MODEL, viewer("anna"), skill)).toEqual([]);
    expect(checkDecideSkill(s, MODEL, viewer("anna"), skill, "FACH")).toMatchObject({
      code: "forbidden",
      reason:
        "«Go-live-Check» hat ein Vetorecht: Den Entscheid trifft eine andere Person als die Projektleitung (Funktionentrennung).",
    });
    expect(checkDecideSkill(s, MODEL, viewer("nina"), skill, "FACH").ok).toBe(true);
    // Only the project lead holds APM: the role counts as missing, and the project lead fills it.
    expect(missingRoleDetails(s, MODEL, "einf")).toEqual([
      { role: "APM", decisions: ["«Go-live-Readiness-Bericht» (Veto)"], held: true },
    ]);
    expect(myTasks(s, MODEL, viewer("anna"))).toContainEqual({ kind: "assign-role", role: "APM" });
    expect(decisionRolesFor(s, RELAXED, viewer("anna"), skill).map((a) => a.role)).toEqual(["FACH", "APM"]);
  });

  it("counts a role as missing when nobody may take a waiting decision, and asks the PMO for control roles", () => {
    // Sandra, the only Datenschutz member, submitted the request: her part of the recheck needs another person.
    const st = team();
    submit(st, "cr-data", "sandra", true);
    accept(st, "cr-data");
    const s = st.state();
    expect(missingRoleDetails(s, MODEL, "init")).toEqual([
      { role: "DS", decisions: ["Neuprüfung CR-01"], held: true },
    ]);
    expect(projectSignals(projectSummary(s, MODEL), new Date())).toContain("rollen-fehlen");
    expect(gateCriteria(s, MODEL, "init").find((c) => c.id === "rollen")).toMatchObject({
      ok: false,
      detail: "fehlt: Datenschutz (Neuprüfung CR-01)",
    });
    // Datenschutz is a control role: the PMO assigns it, so the PMO gets the task, not the project lead.
    expect(myTasks(s, MODEL, viewer("anna")).some((t) => t.kind === "assign-role")).toBe(false);
    const pmo = viewer("peter", "HH.PMO");
    expect(myTasks(s, MODEL, pmo)).toContainEqual({ kind: "assign-role", role: "DS" });
    expect(projectView(s, MODEL, pmo).myTasks.find((t) => t.kind === "assign-role")?.detail).toBe(
      "Es wartet: Neuprüfung CR-01. Wer die Rolle hat, darf hier nicht entscheiden (Funktionentrennung oder eigener Change Request); es braucht eine weitere Person mit dieser Rolle.",
    );

    // The only member of the Projektausschuss submitted a request: another member decides it.
    const solo = new Stream("init")
      .member("anna", "PL")
      .member("thomas", "PA")
      .member("marco", "ISM")
      .member("sandra", "DS");
    submit(solo, "cr-own", "thomas");
    expect(missingRoleDetails(solo.state(), MODEL, "init")).toEqual([
      { role: "PA", decisions: ["Entscheid CR-01"], held: true },
    ]);
    // The test environment relaxes the rules, so nothing is missing there.
    expect(missingRoleDetails(solo.state(), RELAXED, "init")).toEqual([]);
  });

  it("does not let the project lead decide the gate through a global role either", () => {
    const s = team().state();
    const lead = viewer("anna", "HH.Portfolio");
    expect(checkDecideGate(s, MODEL, lead, "init")).toMatchObject({
      reason:
        "Die Projektleitung entscheidet nicht über das Gate des eigenen Vorhabens (Funktionentrennung).",
    });
    expect(checkDecideGate(s, MODEL, viewer("rolf", "HH.Portfolio"), "init")).not.toMatchObject({
      code: "forbidden",
    });
  });
});
