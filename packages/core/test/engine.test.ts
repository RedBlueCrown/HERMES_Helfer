import { describe, expect, it } from "vitest";
import {
  MODEL,
  checkConfirmChecklistItem,
  checkDecideGate,
  checkDecideSkill,
  checkMarkNotApplicable,
  checkRelease,
  checkStartSkill,
  canViewDeliverableContent,
  canViewProject,
  deliverableDetailView,
  deliverableStatus,
  describeEvent,
  gateCriteria,
  gateStatus,
  myTasks,
  nextStep,
  openParticipation,
  participantsFor,
  projectListItem,
  projectView,
  skillStatus,
  validateDecision,
} from "../src";
import { PROFILE, Stream, completeMandatory, viewer } from "./helpers";

const d = (id: string) => MODEL.deliverable(id);
const sk = (id: string) => MODEL.skill(id);

describe("deliverable and skill status", () => {
  it("starts with pre-existing deliverables done and the rest open", () => {
    const s = new Stream("init").state();
    expect(deliverableStatus(s, MODEL, d("pia"))).toBe("done");
    expect(deliverableStatus(s, MODEL, d("kickoff"))).toBe("open");
    expect(deliverableStatus(s, MODEL, d("sysanf"))).toBe("planned");
    expect(skillStatus(s, MODEL, sk("init.kick-off"))).toBe("ready");
  });

  it("goes open → running → draft → done for a document without approvers", () => {
    const st = new Stream("init").member("anna", "PL");
    st.requested("init.kick-off");
    expect(deliverableStatus(st.state(), MODEL, d("kickoff"))).toBe("running");
    st.run("init.kick-off");
    expect(deliverableStatus(st.state(), MODEL, d("kickoff"))).toBe("draft");
    st.release("kickoff");
    expect(deliverableStatus(st.state(), MODEL, d("kickoff"))).toBe("done");
  });

  it("needs the named role's decision for a skill with approvers, and no release", () => {
    const st = new Stream("init").run("init.datenklassifizierung");
    expect(deliverableStatus(st.state(), MODEL, d("klass"))).toBe("approval");
    st.decide("init.datenklassifizierung", "ISM");
    expect(deliverableStatus(st.state(), MODEL, d("klass"))).toBe("done");
  });

  it("sends a rejected result back to the agent", () => {
    const st = new Stream("init")
      .run("init.datenklassifizierung")
      .decide("init.datenklassifizierung", "ISM", "zurückgewiesen");
    const s = st.state();
    expect(skillStatus(s, MODEL, sk("init.datenklassifizierung"))).toBe("ready");
    expect(s.skills["init.datenklassifizierung"]?.output).toBeUndefined();
    expect(s.skills["init.datenklassifizierung"]?.lastRejection?.role).toBe("ISM");
  });

  it("puts an edited released document back to draft, and resets approvals of an edited decision", () => {
    const st = new Stream("init").run("init.kick-off").release("kickoff");
    st.add({
      type: "DraftEdited",
      data: { skillId: "init.kick-off", draft: { summary: "neu", sections: [], openPoints: [] } },
    });
    expect(deliverableStatus(st.state(), MODEL, d("kickoff"))).toBe("draft");
    expect(st.state().skills["init.kick-off"]?.output?.version).toBe(2);

    st.run("init.schutzbedarf").decide("init.schutzbedarf", "ISM");
    expect(deliverableStatus(st.state(), MODEL, d("schuban"))).toBe("done");
    st.add({
      type: "DraftEdited",
      data: { skillId: "init.schutzbedarf", draft: { summary: "x", sections: [], openPoints: [] } },
    });
    expect(skillStatus(st.state(), MODEL, sk("init.schutzbedarf"))).toBe("approval");
  });

  it("needs every contributing skill for a shared deliverable", () => {
    const st = new Stream("init").run("init.discovery").run("init.anforderungen");
    expect(deliverableStatus(st.state(), MODEL, d("studie"))).toBe("open");
    st.run("init.technische-koordination");
    expect(deliverableStatus(st.state(), MODEL, d("studie"))).toBe("draft");
  });
});

describe("gates", () => {
  it("is ready only when all mandatory results and participants are done, then advances the phase", () => {
    const st = new Stream("init");
    expect(gateStatus(st.state(), MODEL, "init")).toBe("open");
    completeMandatory(st, "init");
    expect(gateStatus(st.state(), MODEL, "init")).toBe("open"); // participants still missing
    for (const p of openParticipation(st.state(), MODEL, "init")) st.involve("init", p.id);
    expect(gateStatus(st.state(), MODEL, "init")).toBe("ready");

    st.add({
      type: "GateDecisionRecorded",
      data: { phase: "init", decision: "freigegeben", reason: "", konsent: false, conditions: [] },
    });
    const s = st.state();
    expect(s.phase).toBe("konzept");
    expect(gateStatus(s, MODEL, "init")).toBe("passed");
    expect(gateStatus(s, MODEL, "konzept")).toBe("open");
    expect(deliverableStatus(s, MODEL, d("kickoff"))).toBe("done");
  });

  it("stays in the phase when the gate is rejected", () => {
    const st = new Stream("init");
    st.add({
      type: "GateDecisionRecorded",
      data: {
        phase: "init",
        decision: "zurückgewiesen",
        reason: "Studie unvollständig",
        konsent: false,
        conditions: [],
      },
    });
    expect(st.state().phase).toBe("init");
    expect(st.state().gateDecisions.init).toHaveLength(1);
  });

  it("blocks the gate while a veto decision is pending", () => {
    const st = new Stream("konzept").run("konzept.security-engineering").run("konzept.isds");
    expect(deliverableStatus(st.state(), MODEL, d("isds"))).toBe("veto");
    expect(gateStatus(st.state(), MODEL, "konzept")).toBe("blocked");
    const veto = gateCriteria(st.state(), MODEL, "konzept").find((c) => c.id === "veto");
    expect(veto?.ok).toBe(false);
  });

  it("reports roles that nobody holds", () => {
    const st = new Stream("init").member("anna", "PL");
    const roles = gateCriteria(st.state(), MODEL, "init").find((c) => c.id === "rollen");
    expect(roles?.ok).toBe(false);
    expect(roles?.detail).toContain("Informationssicherheit");
  });

  it("creates Auflagen from a gate decision with conditions", () => {
    const st = new Stream("init");
    st.add({
      type: "GateDecisionRecorded",
      data: {
        phase: "init",
        decision: "mit Auflagen",
        reason: "Restrisiken ergänzen",
        konsent: false,
        conditions: [{ id: "c1", text: "Restrisiken ergänzen", ownerRole: "ISM", due: "2 Wochen" }],
      },
    });
    expect(st.state().conditions.c1?.source).toBe("gate:init");
    st.add({
      type: "ConditionCompleted",
      data: { conditionId: "c1", text: "Restrisiken ergänzen", note: "" },
    });
    expect(st.state().conditions.c1?.doneAt).toBeDefined();
  });
});

describe("participation", () => {
  it("adds mandatory roles from the project profile", () => {
    const base = participantsFor(MODEL, PROFILE, "init");
    expect(base.find((p) => p.id === "ism")?.required).toBe(false);
    const strict = participantsFor(
      MODEL,
      { ...PROFILE, schutzbedarf: "hoch", personendaten: true, lieferant: true },
      "init",
    );
    expect(strict.find((p) => p.id === "ism")?.required).toBe(true);
    expect(strict.find((p) => p.id === "ism")?.triggers).toContain("Schutzbedarf hoch");
    expect(strict.find((p) => p.id === "ds")?.required).toBe(true);
    expect(strict.find((p) => p.id === "besch")).toMatchObject({
      required: true,
      triggers: ["Externer Lieferant"],
    });
  });
});

describe("checklists and preconditions", () => {
  it("keeps the readiness deliverable in 'confirm' until all access tests are confirmed", () => {
    const st = new Stream("real").run("real.technische-koordination");
    expect(deliverableStatus(st.state(), MODEL, d("readiness"))).toBe("confirm");
    for (const item of d("readiness").checklist!.items) st.confirm("readiness", item.id);
    expect(deliverableStatus(st.state(), MODEL, d("readiness"))).toBe("draft");
  });

  it("only allows the go-live approval after all criteria, and Betrieb only after go-live", () => {
    const st = new Stream("einf").member("anna", "PL").member("nina", "FACH");
    const pl = viewer("anna");
    expect(checkStartSkill(st.state(), MODEL, pl, sk("einf.betrieb"))).toMatchObject({
      ok: false,
      code: "invalid_state",
    });
    expect(
      checkConfirmChecklistItem(st.state(), MODEL, viewer("nina"), "einf.go-live-check", "fach").ok,
    ).toBe(false);

    st.run("einf.go-live-check");
    expect(
      checkConfirmChecklistItem(st.state(), MODEL, viewer("nina"), "einf.go-live-check", "fach").ok,
    ).toBe(true);
    const open = sk("einf.go-live-check").checklist!.items.length;
    const ctx = {
      veto: true,
      konsentRequired: false,
      openChecklistItems: open,
      checklistTitle: "Go-live-Kriterien",
    };
    expect(
      validateDecision(
        { decision: "freigegeben", reason: "Alles bereit", konsent: false, conditions: [] },
        ctx,
      ),
    ).toMatch(/Checkliste/);
    expect(
      validateDecision(
        { decision: "freigegeben", reason: "Alles bereit", konsent: false, conditions: [] },
        { ...ctx, openChecklistItems: 0 },
      ),
    ).toBeNull();

    for (const item of sk("einf.go-live-check").checklist!.items) st.confirm("einf.go-live-check", item.id);
    st.decide("einf.go-live-check", "FACH").decide("einf.go-live-check", "APM");
    expect(checkStartSkill(st.state(), MODEL, pl, sk("einf.betrieb")).ok).toBe(true);
  });
});

describe("permissions", () => {
  const st = new Stream("init")
    .member("anna", "PL")
    .member("nina", "FACH")
    .member("jonas", "BC")
    .member("marco", "ISM");

  it("lets the PL start any skill and others only their own", () => {
    const s = st.state();
    expect(checkStartSkill(s, MODEL, viewer("anna"), sk("init.kick-off")).ok).toBe(true);
    expect(checkStartSkill(s, MODEL, viewer("nina"), sk("init.kick-off"))).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(checkStartSkill(s, MODEL, viewer("nina"), sk("init.datenklassifizierung")).ok).toBe(true);
    expect(checkStartSkill(s, MODEL, viewer("jonas"), sk("init.discovery")).ok).toBe(true);
  });

  it("restricts project visibility and restricted content", () => {
    const s = st.state();
    expect(canViewProject(s, viewer("stranger"))).toBe(false);
    expect(canViewProject(s, viewer("pmo", "HH.PMO"))).toBe(true);
    // Governance roles and contributors see restricted content; others only its status.
    expect(canViewDeliverableContent(s, MODEL, viewer("marco"), d("schuban"))).toBe(true);
    expect(canViewDeliverableContent(s, MODEL, viewer("nina"), d("schuban"))).toBe(true);
    expect(canViewDeliverableContent(s, MODEL, viewer("jonas"), d("schuban"))).toBe(false);
    expect(canViewDeliverableContent(s, MODEL, viewer("jonas"), d("studie"))).toBe(true);
  });

  it("allows decisions only to holders of the pending role", () => {
    const s = new Stream("init").member("marco", "ISM").member("anna", "PL").run("init.schutzbedarf").state();
    expect(checkDecideSkill(s, MODEL, viewer("marco"), sk("init.schutzbedarf"), "ISM").ok).toBe(true);
    expect(checkDecideSkill(s, MODEL, viewer("anna"), sk("init.schutzbedarf"), "ISM")).toMatchObject({
      code: "forbidden",
    });
  });

  it("allows 'nicht zutreffend' only for situational deliverables, by the PL", () => {
    const s = new Stream("konzept").member("anna", "PL").member("nina", "FACH").state();
    expect(checkMarkNotApplicable(s, MODEL, viewer("anna"), d("poc")).ok).toBe(true);
    expect(checkMarkNotApplicable(s, MODEL, viewer("anna"), d("sysanf"))).toMatchObject({
      code: "invalid_state",
    });
    expect(checkMarkNotApplicable(s, MODEL, viewer("nina"), d("poc"))).toMatchObject({ code: "forbidden" });
  });

  it("lets only the PL release drafts and only PA or Portfolio decide gates", () => {
    const stream = new Stream("init").member("anna", "PL").member("thomas", "PA").run("init.kick-off");
    expect(checkRelease(stream.state(), MODEL, viewer("anna"), d("kickoff")).ok).toBe(true);
    expect(checkRelease(stream.state(), MODEL, viewer("thomas"), d("kickoff")).ok).toBe(false);
    completeMandatory(stream, "init");
    for (const p of openParticipation(stream.state(), MODEL, "init")) stream.involve("init", p.id);
    const s = stream.state();
    expect(checkDecideGate(s, MODEL, viewer("thomas"), "init").ok).toBe(true);
    expect(checkDecideGate(s, MODEL, viewer("rita", "HH.Portfolio"), "init").ok).toBe(true);
    expect(checkDecideGate(s, MODEL, viewer("anna"), "init")).toMatchObject({ code: "forbidden" });
  });
});

describe("decision validation", () => {
  const ctx = { veto: false, konsentRequired: true, openChecklistItems: 0 };
  it("requires reasons, conditions and Konsent where needed", () => {
    expect(
      validateDecision({ decision: "freigegeben", reason: "", konsent: false, conditions: [] }, ctx),
    ).toMatch(/Konsent/);
    expect(
      validateDecision({ decision: "freigegeben", reason: "", konsent: true, conditions: [] }, ctx),
    ).toBeNull();
    expect(
      validateDecision({ decision: "zurückgewiesen", reason: "nein", konsent: false, conditions: [] }, ctx),
    ).toMatch(/Begründung/);
    expect(
      validateDecision(
        { decision: "mit Auflagen", reason: "mit Auflage", konsent: true, conditions: [] },
        ctx,
      ),
    ).toMatch(/Auflage/);
    expect(
      validateDecision(
        {
          decision: "mit Auflagen",
          reason: "mit Auflage",
          konsent: true,
          conditions: [{ text: "Tests", ownerRole: "TEST", due: "1 Woche" }],
        },
        ctx,
      ),
    ).toBeNull();
    expect(
      validateDecision(
        { decision: "freigegeben", reason: "", konsent: true, conditions: [] },
        { ...ctx, veto: true },
      ),
    ).toMatch(/Veto/);
  });
});

describe("tasks and next step", () => {
  it("starts with the kick-off and moves on to decisions and releases", () => {
    const st = new Stream("init").member("anna", "PL").member("marco", "ISM");
    expect(nextStep(st.state(), MODEL)).toEqual({
      kind: "run",
      skillId: "init.kick-off",
      deliverableId: "kickoff",
    });
    st.run("init.datenklassifizierung");
    const tasks = myTasks(st.state(), MODEL, viewer("marco"));
    expect(tasks).toContainEqual({
      kind: "decide-skill",
      skillId: "init.datenklassifizierung",
      role: "ISM",
      veto: false,
    });
    st.run("init.kick-off");
    expect(myTasks(st.state(), MODEL, viewer("anna"))).toContainEqual({
      kind: "release",
      deliverableId: "kickoff",
    });
  });

  it("asks the PL to fill decision roles that nobody holds", () => {
    const st = new Stream("init").member("anna", "PL");
    expect(myTasks(st.state(), MODEL, viewer("anna"))).toContainEqual({ kind: "assign-role", role: "ISM" });
  });

  it("reports the gate as next step once everything is done", () => {
    const st = completeMandatory(new Stream("init"), "init");
    for (const p of openParticipation(st.state(), MODEL, "init")) st.involve("init", p.id);
    expect(nextStep(st.state(), MODEL)).toEqual({ kind: "gate" });
  });
});

describe("views and descriptions", () => {
  it("builds project, list and detail views for every phase without errors", () => {
    for (const phase of MODEL.phases.map((p) => p.id)) {
      const st = new Stream(phase).member("anna", "PL").member("thomas", "PA");
      const s = st.state();
      const v = projectView(s, MODEL, viewer("anna"));
      expect(v.phases).toHaveLength(5);
      expect(v.phases.find((p) => p.current)?.id).toBe(phase);
      expect(projectListItem(s, MODEL, viewer("anna")).projectLeads).toEqual(["anna"]);
      for (const deliv of MODEL.phase(phase).deliverables) {
        expect(deliverableDetailView(s, MODEL, viewer("anna"), deliv).id).toBe(deliv.id);
      }
    }
  });

  it("offers the right row action to the right person", () => {
    const st = new Stream("init").member("anna", "PL").member("nina", "FACH");
    const row = (who: string, id: string) =>
      projectView(st.state(), MODEL, viewer(who)).phases[0]!.deliverables.find((x) => x.id === id)!;
    expect(row("anna", "kickoff").action).toMatchObject({
      kind: "start",
      label: "Entwurf erstellen",
      enabled: true,
    });
    expect(row("nina", "kickoff").action).toMatchObject({ kind: "start", enabled: false });
    st.run("init.kick-off");
    expect(row("anna", "kickoff").action).toMatchObject({ kind: "release", label: "Freigeben" });
    expect(row("nina", "kickoff").action).toBeNull();
  });

  it("hides restricted content in the detail view", () => {
    const st = new Stream("init")
      .member("laura", "APM")
      .member("nina", "FACH")
      .member("marco", "ISM")
      .run("init.schutzbedarf");
    const forApm = deliverableDetailView(st.state(), MODEL, viewer("laura"), d("schuban"));
    expect(forApm.contentVisible).toBe(false);
    expect(forApm.skills[0]?.output?.draft).toBeNull();
    expect(forApm.skills[0]?.output?.findings).toEqual([]);
    // The Fachstelle fills in the SchuBAn, so it needs the content.
    const forFach = deliverableDetailView(st.state(), MODEL, viewer("nina"), d("schuban"));
    expect(forFach.skills[0]?.output?.draft?.sections.length).toBeGreaterThan(0);
    const forIsm = deliverableDetailView(st.state(), MODEL, viewer("marco"), d("schuban"));
    expect(forIsm.skills[0]?.output?.draft?.sections.length).toBeGreaterThan(0);
  });

  it("describes events in German", () => {
    const st = new Stream("init").run("init.kick-off").release("kickoff");
    const texts = st.events.map((e) => describeEvent(e, MODEL));
    expect(texts[0]).toBe("Vorhaben «Testvorhaben» angelegt (Phase Initialisierung).");
    expect(texts).toContain("«Kick-off-Roundtable mit allen Beteiligten» freigegeben.");
  });
});
