import type { MinutesProposal, MinutesRegisterView } from "@hermes-helfer/core";
import { afterEach, describe, expect, it } from "vitest";
import { MockProvider } from "../src/agents/mock-provider";
import type { AiProvider } from "../src/agents/provider";
import { testServer } from "./helpers";

type Server = Awaited<ReturnType<typeof testServer>>;
let server: Server | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
});

const NOTES = `Projektsitzung Kundenportal, Teilnehmende: Anna Keller, Jonas Wyss, Tim Brunner.
Anna Keller: Entscheid: Wir starten mit dem Self-Service für Adressänderungen.
Tim: Pendenz: Testkonzept für das Portal entwerfen, verantwortlich: Tim Brunner, bis 30.10.
Pendenz: Offerte des Hosting-Anbieters einholen; verantwortlich: Einkauf
Frage: Braucht es für die Anmeldung eine Zwei-Faktor-Authentisierung?`;

const extract = (s: Server, user: string, text = NOTES) =>
  s
    .as(user)
    .post("/api/projects/KPO/minutes/extract", { title: "Projektsitzung", heldOn: "2026-10-14", text });

const register = async (s: Server, user: string) =>
  (await s.as(user).get("/api/projects/KPO/minutes")).json() as MinutesRegisterView;

describe("Protokoll agent (A9) and minutes", () => {
  it("proposes decisions, action items and open questions with their passage, and stores nothing", async () => {
    server = await testServer();
    const res = await extract(server, "u-jonas");
    expect(res.statusCode).toBe(200);
    const p = res.json() as MinutesProposal;
    expect(p.decisions).toEqual([
      {
        text: "Wir starten mit dem Self-Service für Adressänderungen.",
        quote: "Anna Keller: Entscheid: Wir starten mit dem Self-Service für Adressänderungen.",
      },
    ]);
    expect(p.actions).toEqual([
      expect.objectContaining({
        text: "Testkonzept für das Portal entwerfen",
        ownerId: "u-tim",
        ownerName: "Tim Brunner",
        due: "2026-10-30",
      }),
      expect.objectContaining({ text: "Offerte des Hosting-Anbieters einholen", ownerName: "Einkauf" }),
    ]);
    expect(p.actions[1]).not.toHaveProperty("ownerId");
    expect(p.questions).toHaveLength(1);
    expect(p.producer).toMatchObject({ kind: "ai", agent: "A9" });
    // Nothing is in the project before a member records it.
    expect((await register(server, "u-jonas")).items).toEqual([]);
  });

  it("drops what the model proposes without a passage of the text", async () => {
    const mock = new MockProvider(0);
    const provider: AiProvider = {
      info: mock.info,
      draft: (r, c) => mock.draft(r, c),
      critique: (r) => mock.critique(r),
      draftChangeRequest: (r, c) => mock.draftChangeRequest(r, c),
      reviewRisks: (r, c) => mock.reviewRisks(r, c),
      draftStatusReport: (r, c) => mock.draftStatusReport(r, c),
      extractMinutes: async () => ({
        extract: {
          decisions: [
            {
              text: "Self-Service für Adressänderungen",
              quote: "Wir starten mit dem Self-Service für Adressänderungen.",
            },
            { text: "Budget um 500'000 CHF erhöht", quote: "Das Budget wird um 500'000 CHF erhöht." },
          ],
          actions: [
            {
              text: "Testkonzept entwerfen",
              owner: "Tim",
              due: "Ende Oktober",
              quote: "Testkonzept für das Portal entwerfen",
            },
          ],
          questions: [{ text: "Zwei-Faktor?", quote: "Braucht es … eine Zwei-Faktor-Authentisierung?" }],
        },
      }),
    };
    server = await testServer({ provider });
    const p = (await extract(server, "u-jonas")).json() as MinutesProposal;
    expect(p.decisions.map((d) => d.text)).toEqual(["Self-Service für Adressänderungen"]);
    // «Tim» alone names one member; «Ende Oktober» is no day.
    expect(p.actions).toEqual([
      {
        text: "Testkonzept entwerfen",
        quote: "Testkonzept für das Portal entwerfen",
        ownerId: "u-tim",
        ownerName: "Tim Brunner",
      },
    ]);
    expect(p.questions).toEqual([]);
    expect(p.dropped).toBe(2);
    expect(p.findings.map((f) => f.text)).toContain(
      "2 Vorschläge ohne passende Stelle im Text verworfen: der Agent übernimmt nur, was der Text sagt.",
    );
  });

  it("records the accepted items with the agent's quotes, and whether the person changed them", async () => {
    server = await testServer();
    const p = (await extract(server, "u-jonas")).json() as MinutesProposal;
    const res = await server.as("u-jonas").post("/api/projects/KPO/minutes", {
      title: "Projektsitzung",
      heldOn: "2026-10-14",
      proposalId: p.proposalId,
      decisions: [{ text: p.decisions[0]!.text, source: 0 }],
      // The second action item is left out; the first is taken as proposed.
      actions: [{ text: p.actions[0]!.text, ownerId: "u-tim", due: "2026-10-30", source: 0 }],
      questions: [{ text: p.questions[0]!.text, source: 0 }],
    });
    expect(res.statusCode).toBe(201);
    const [m] = (await register(server, "u-tim")).items;
    expect(m).toMatchObject({ label: "P-01", producer: { kind: "ai", agent: "A9", edited: false } });
    expect(m!.decisions[0]!.quote).toBe(p.decisions[0]!.quote);
    expect(m!.actions[0]).toMatchObject({ ownerId: "u-tim", ownerName: "Tim Brunner", due: "2026-10-30" });
    // The proposal is used up.
    const again = await server.as("u-jonas").post("/api/projects/KPO/minutes", {
      title: "Projektsitzung",
      heldOn: "2026-10-14",
      proposalId: p.proposalId,
      decisions: [{ text: "Nochmals", source: 0 }],
    });
    expect(again.statusCode).toBe(422);

    // Changed text and an item of one's own: still the agent's proposal, marked as edited.
    const q = (await extract(server, "u-jonas")).json() as MinutesProposal;
    await server.as("u-jonas").post("/api/projects/KPO/minutes", {
      title: "Projektsitzung 2",
      heldOn: "2026-10-15",
      proposalId: q.proposalId,
      decisions: [
        { text: "Self-Service zuerst für Adressänderungen", source: 0 },
        { text: "Eigener Eintrag" },
      ],
    });
    const latest = (await register(server, "u-jonas")).items[0]!;
    expect(latest.producer).toMatchObject({ kind: "ai", edited: true });
    expect(latest.decisions[1]).not.toHaveProperty("quote");
  });

  it("never lets the client set a quote or name an item the agent did not propose", async () => {
    server = await testServer();
    const p = (await extract(server, "u-jonas")).json() as MinutesProposal;
    const res = await server.as("u-jonas").post("/api/projects/KPO/minutes", {
      title: "Projektsitzung",
      heldOn: "2026-10-14",
      proposalId: p.proposalId,
      decisions: [{ text: "Erfunden", source: 5 }],
    });
    expect(res.statusCode).toBe(422);
    const manual = await server.as("u-jonas").post("/api/projects/KPO/minutes", {
      title: "Projektsitzung",
      heldOn: "2026-10-14",
      decisions: [{ text: "Von Hand erfasst", quote: "untergeschoben" }],
    });
    expect(manual.statusCode).toBe(201);
    const [m] = (await register(server, "u-jonas")).items;
    expect(m!.producer).toEqual({ kind: "human" });
    expect(m!.decisions[0]).not.toHaveProperty("quote");
    // Another person cannot use the proposal.
    const q = (await extract(server, "u-jonas")).json() as MinutesProposal;
    const other = await server.as("u-tim").post("/api/projects/KPO/minutes", {
      title: "Projektsitzung",
      heldOn: "2026-10-14",
      proposalId: q.proposalId,
      decisions: [{ text: "x x x", source: 0 }],
    });
    expect(other.statusCode).toBe(422);
  });

  it("puts open action items on the owner's tasks; the owner or the PL reports them done", async () => {
    server = await testServer();
    await server.as("u-jonas").post("/api/projects/KPO/minutes", {
      title: "Projektsitzung",
      heldOn: "2026-10-14",
      actions: [{ text: "Testkonzept entwerfen", ownerId: "u-tim", due: "2026-10-30" }],
    });
    const tim = (await server.as("u-tim").get("/api/projects/KPO")).json() as {
      myTasks: { kind: string; title: string; minutesId?: string; actionId?: string }[];
    };
    const task = tim.myTasks.find((t) => t.kind === "minutes-action")!;
    expect(task.title).toBe("Pendenz: Testkonzept entwerfen");
    const url = `/api/projects/KPO/minutes/${task.minutesId}/actions/${task.actionId}/done`;
    expect((await server.as("u-jonas").post(url, {})).statusCode).toBe(403);
    expect((await server.as("u-tim").post(url, { note: "Entwurf liegt vor" })).statusCode).toBe(200);
    expect((await server.as("u-anna").post(url, {})).statusCode).toBe(409);
    const [m] = (await register(server, "u-tim")).items;
    expect(m!.actions[0]).toMatchObject({
      done: true,
      note: "Entwurf liegt vor",
      doneBy: { userId: "u-tim" },
    });
  });

  it("refuses people outside the project, empty notes and invalid minutes", async () => {
    server = await testServer();
    // Rita sees every project (Portfolio) but is no member of KPO.
    expect((await extract(server, "u-rita")).statusCode).toBe(403);
    expect((await extract(server, "u-jonas", "zu kurz")).statusCode).toBe(422);
    const bad = await server.as("u-jonas").post("/api/projects/KPO/minutes", {
      title: "Projektsitzung",
      heldOn: "2026-10-14",
      actions: [{ text: "Abc", ownerId: "u-fremd" }],
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.message).toMatch(/Mitglied/);

    // An impossible day is a wrong input, not a server error; an empty one means none.
    for (const heldOn of ["2026-13-45", "2026-02-30", ""]) {
      const res = await server.as("u-jonas").post("/api/projects/KPO/minutes", {
        title: "Projektsitzung",
        heldOn,
        decisions: [{ text: "Abc" }],
      });
      expect(res.statusCode, heldOn).toBe(422);
    }
    const noDay = await server.as("u-jonas").post("/api/projects/KPO/minutes", {
      title: "Projektsitzung",
      heldOn: "2026-10-14",
      actions: [{ text: "Abc", due: "" }],
    });
    expect(noDay.statusCode).toBe(201);
  });

  it("keeps neither the notes nor the items in the log", async () => {
    const lines: string[] = [];
    const { pino } = await import("pino");
    const logger = pino({ level: "info" }, { write: (l: string) => lines.push(l) });
    server = await testServer({ logger });
    await extract(server, "u-jonas");
    const log = lines.join("\n");
    expect(log).toContain("protokoll.auswertung");
    expect(log).not.toContain("Adressänderungen");
    expect(log).not.toContain("Hosting-Anbieters");
  });
});
