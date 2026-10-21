import { describe, expect, it } from "vitest";
import {
  MODEL,
  MINUTES_ITEMS_MAX,
  checkCompleteMinutesAction,
  checkRecordMinutes,
  describeEvent,
  eventCategory,
  eventRefs,
  memberByName,
  minutesRegister,
  myTasks,
  nextMinutesNumber,
  normalizeText,
  openActions,
  projectView,
  quoteInText,
  validateMinutes,
  type Actor,
  type MinutesAction,
} from "../src";
import { Stream, viewer } from "./helpers";

const actor = (userId: string, ...roles: string[]): Actor => ({
  userId,
  displayName: userId,
  roles,
  channel: "web",
});

const NOW = new Date("2026-10-20T12:00:00Z");

function withMinutes(actions: MinutesAction[], opts: { ai?: boolean; heldOn?: string } = {}) {
  const st = new Stream("konzept").member("u-pl", "PL").member("u-anna", "BC").member("u-ben", "TEST");
  st.add(
    {
      type: "MinutesRecorded",
      data: {
        minutesId: "m1",
        number: nextMinutesNumber(st.state()),
        title: "Projektsitzung",
        heldOn: opts.heldOn ?? "2026-10-14",
        decisions: [{ id: "d1", text: "Wir setzen auf Variante B.", quote: "Variante B ist beschlossen" }],
        actions,
        questions: [{ id: "q1", text: "Wer betreibt die Schnittstelle?" }],
        producer: opts.ai ? { kind: "ai", agent: "A9", provider: "mock", model: "mock" } : { kind: "human" },
      },
    },
    actor("u-anna", "BC"),
  );
  return st;
}

describe("meeting minutes (Protokolle)", () => {
  it("records decisions, action items and open questions, and numbers the minutes", () => {
    const st = withMinutes(
      [
        {
          id: "a1",
          text: "Testdaten bereitstellen",
          ownerId: "u-ben",
          ownerName: "u-ben",
          due: "2026-10-30",
        },
        { id: "a2", text: "Lieferant anfragen", ownerName: "Einkauf" },
      ],
      { ai: true },
    );
    const s = st.state();
    expect(s.minutes.m1).toMatchObject({ number: 1, title: "Projektsitzung", heldOn: "2026-10-14" });
    expect(nextMinutesNumber(s)).toBe(2);
    expect(openActions(s).map((x) => x.action.id)).toEqual(["a1", "a2"]);
    const reg = minutesRegister(s, MODEL, viewer("u-ben"), NOW);
    expect(reg.counts).toEqual({ total: 1, openActions: 2, overdue: 0 });
    expect(reg.items[0]).toMatchObject({ label: "P-01", producer: { kind: "ai", agent: "A9" } });
    expect(projectView(s, MODEL, viewer("u-ben"), NOW).minutes).toEqual({ total: 1, openActions: 2 });
  });

  it("puts an open action item on its owner's task list, and only there", () => {
    const st = withMinutes([
      { id: "a1", text: "Testdaten bereitstellen", ownerId: "u-ben", ownerName: "u-ben", due: "2026-10-16" },
    ]);
    const s = st.state();
    const tasks = projectView(s, MODEL, viewer("u-ben"), NOW).myTasks;
    const task = tasks.find((t) => t.kind === "minutes-action");
    expect(task).toMatchObject({
      title: "Pendenz: Testdaten bereitstellen",
      detail: "Aus P-01 «Projektsitzung» vom 14.10.2026, fällig am 16.10.2026 (überfällig).",
      minutesId: "m1",
      actionId: "a1",
    });
    expect(myTasks(s, MODEL, viewer("u-anna"), NOW).some((t) => t.kind === "minutes-action")).toBe(false);
  });

  it("lets the owner or the project lead report an action item done, once", () => {
    const st = withMinutes([
      { id: "a1", text: "Testdaten bereitstellen", ownerId: "u-ben", ownerName: "u-ben" },
      { id: "a2", text: "Lieferant anfragen", ownerName: "Einkauf" },
    ]);
    let s = st.state();
    expect(checkCompleteMinutesAction(s, MODEL, viewer("u-ben"), "m1", "a1").ok).toBe(true);
    expect(checkCompleteMinutesAction(s, MODEL, viewer("u-pl"), "m1", "a1").ok).toBe(true);
    expect(checkCompleteMinutesAction(s, MODEL, viewer("u-anna"), "m1", "a1")).toMatchObject({
      code: "forbidden",
    });
    // Someone outside the project: the project lead reports it.
    expect(checkCompleteMinutesAction(s, MODEL, viewer("u-ben"), "m1", "a2")).toMatchObject({
      code: "forbidden",
    });
    expect(checkCompleteMinutesAction(s, MODEL, viewer("u-pl"), "m1", "a2").ok).toBe(true);
    expect(checkCompleteMinutesAction(s, MODEL, viewer("u-pl"), "m1", "nope")).toMatchObject({
      code: "invalid_state",
    });

    st.add(
      {
        type: "MinutesActionCompleted",
        data: { minutesId: "m1", actionId: "a1", note: "Daten liegen bereit" },
      },
      actor("u-ben", "TEST"),
    );
    s = st.state();
    expect(s.minutes.m1!.actions[0]).toMatchObject({
      doneBy: { userId: "u-ben" },
      note: "Daten liegen bereit",
    });
    expect(checkCompleteMinutesAction(s, MODEL, viewer("u-ben"), "m1", "a1")).toMatchObject({
      code: "invalid_state",
    });
    expect(myTasks(s, MODEL, viewer("u-ben"), NOW).some((t) => t.kind === "minutes-action")).toBe(false);
    expect(openActions(s).map((x) => x.action.id)).toEqual(["a2"]);
  });

  it("lets members record minutes, nobody outside the project", () => {
    const s = withMinutes([]).state();
    expect(checkRecordMinutes(s, MODEL, viewer("u-anna")).ok).toBe(true);
    expect(checkRecordMinutes(s, MODEL, viewer("u-pmo", "HH.PMO"))).toMatchObject({ code: "forbidden" });
  });

  it("describes the minutes in the history, without the notes", () => {
    const st = withMinutes([{ id: "a1", text: "Testdaten bereitstellen", ownerName: "Einkauf" }], {
      ai: true,
    });
    st.add({ type: "MinutesActionCompleted", data: { minutesId: "m1", actionId: "a1", note: "" } });
    const s = st.state();
    const [recorded, done] = st.events.slice(-2);
    expect(eventCategory(recorded!)).toBe("protokoll");
    expect(describeEvent(recorded!, MODEL, eventRefs(s))).toBe(
      "P-01 «Projektsitzung» vom 14.10.2026 erfasst: 1 Entscheid, 1 Pendenz, 1 offene Frage (Vorschlag des Protokoll-Agenten).",
    );
    expect(describeEvent(done!, MODEL, eventRefs(s))).toBe(
      "Pendenz «Testdaten bereitstellen» aus P-01 erledigt.",
    );
  });

  it("checks what people enter", () => {
    const s = withMinutes([]).state();
    const ok = {
      title: "Projektsitzung",
      heldOn: "2026-10-14",
      decisions: [{ text: "Variante B" }],
      actions: [],
      questions: [],
    };
    expect(validateMinutes(s, ok)).toBeNull();
    expect(validateMinutes(s, { ...ok, title: "PS" })).toMatch(/benennen/);
    expect(validateMinutes(s, { ...ok, heldOn: "2026-02-30" })).toMatch(/Datum/);
    expect(validateMinutes(s, { ...ok, heldOn: "2026-13-45" })).toMatch(/Datum/);
    expect(validateMinutes(s, { ...ok, decisions: [] })).toMatch(/mindestens einen/);
    expect(validateMinutes(s, { ...ok, decisions: [{ text: " a " }] })).toMatch(/3 Zeichen/);
    expect(
      validateMinutes(s, {
        ...ok,
        decisions: Array.from({ length: MINUTES_ITEMS_MAX + 1 }, () => ({ text: "Abc" })),
      }),
    ).toMatch(/Höchstens/);
    expect(validateMinutes(s, { ...ok, actions: [{ text: "Abc", ownerId: "u-fremd" }] })).toMatch(/Mitglied/);
    expect(validateMinutes(s, { ...ok, actions: [{ text: "Abc", due: "Ende Monat" }] })).toMatch(
      /JJJJ-MM-TT/,
    );
  });
});

describe("evidence of the Protokoll agent", () => {
  const text = `Anna: Ich finde, «Variante B» ist beschlossen.\nBen:  Ich stelle  die Testdaten
bis 30.10. bereit – versprochen.`;

  it("finds a quote in the text as a reader would, and nothing invented", () => {
    expect(quoteInText("„Variante B“ ist beschlossen", text)).toBe(true);
    expect(quoteInText("ich stelle die testdaten bis 30.10. bereit - versprochen", text)).toBe(true);
    expect(quoteInText('"Ich stelle die Testdaten"', text)).toBe(true);
    // Left out in the middle, or not in the text at all.
    expect(quoteInText("Ich stelle … bereit", text)).toBe(false);
    expect(quoteInText("Variante C ist beschlossen", text)).toBe(false);
    // Too short to name a passage.
    expect(quoteInText("Anna", text)).toBe(false);
    expect(normalizeText("A   B")).toBe("a b");
  });

  it("matches a name in the text to exactly one member", () => {
    const st = new Stream("konzept");
    for (const [id, name] of [
      ["u-anna", "Anna Keller"],
      ["u-ben", "Ben Huber"],
      ["u-anna2", "Anna Meier"],
    ] as const) {
      st.add({ type: "MemberRoleAssigned", data: { userId: id, displayName: name, role: "BC" } });
    }
    const s = st.state();
    expect(memberByName(s, "Keller")).toBe("u-anna");
    expect(memberByName(s, "A. Keller")).toBe("u-anna");
    expect(memberByName(s, "ben huber")).toBe("u-ben");
    // Two Annas, or nobody: the person picks.
    expect(memberByName(s, "Anna")).toBeUndefined();
    expect(memberByName(s, "Einkauf")).toBeUndefined();
    expect(memberByName(s, "")).toBeUndefined();
  });
});
