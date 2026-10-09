import { describe, expect, it } from "vitest";
import { MODEL, PARTICIPANT_CATALOG, PARTICIPATION_RULES, PHASE_PARTICIPANTS, PROJECT_ROLES } from "../src";

describe("HERMES model", () => {
  it("has 5 phases, 48 deliverables and 46 skills", () => {
    expect(MODEL.phases.map((p) => p.id)).toEqual(["init", "konzept", "real", "einf", "skal"]);
    expect(MODEL.phases.flatMap((p) => p.deliverables)).toHaveLength(48);
    expect(MODEL.phases.flatMap((p) => p.skills)).toHaveLength(46);
  });

  it("links deliverables only to skills of the same phase, and uses every skill", () => {
    for (const ph of MODEL.phases) {
      for (const d of ph.deliverables) {
        for (const sid of d.skills) expect(MODEL.skill(sid).phase).toBe(ph.id);
        if (!d.preExisting) expect(d.skills.length).toBeGreaterThan(0);
      }
      for (const s of ph.skills) expect(MODEL.deliverablesOfSkill(s.id).length).toBeGreaterThan(0);
    }
  });

  it("uses only known roles, agents and references", () => {
    for (const s of MODEL.phases.flatMap((p) => p.skills)) {
      for (const r of s.mayStart) expect(PROJECT_ROLES).toContain(r);
      for (const a of s.approvers) expect(PROJECT_ROLES).toContain(a.role);
      if (s.agent) expect(MODEL.agent(s.agent).active).toBe(true);
      else expect(s.mode).toBe("manual");
      for (const pre of s.requiresApproved ?? []) expect(MODEL.findSkill(pre)).toBeDefined();
      expect(s.sections.length).toBeGreaterThan(0);
    }
    for (const owner of [
      ...MODEL.phases.flatMap((p) => p.skills),
      ...MODEL.phases.flatMap((p) => p.deliverables),
    ]) {
      if (owner.checklist) expect(MODEL.findSkill(owner.checklist.availableAfterSkill)).toBeDefined();
    }
  });

  it("references only known participants in rules", () => {
    for (const rule of PARTICIPATION_RULES) {
      for (const ids of Object.values(rule.add)) {
        for (const id of ids ?? []) expect(PARTICIPANT_CATALOG[id]).toBeDefined();
      }
    }
    for (const list of Object.values(PHASE_PARTICIPANTS))
      for (const p of list) expect(PROJECT_ROLES).toContain(p.ownerRole);
  });

  it("contains no texts of the prototype's former organisation", () => {
    const text =
      JSON.stringify(MODEL.phases) + JSON.stringify(PHASE_PARTICIPANTS) + JSON.stringify(PARTICIPANT_CATALOG);
    expect(text).not.toMatch(
      /LLV|Landesverwaltung|Liechtenstein|Amtsstelle|Fachamt|Amtsleitung|Meisterplan|Bürger|\beID\b/,
    );
  });
});
