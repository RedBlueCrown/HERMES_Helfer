import type { KnowledgeAnswer } from "@hermes-helfer/core";
import { afterEach, describe, expect, it } from "vitest";
import { NOTHING_FOUND } from "../src/agents/knowledge-agent";
import { MockProvider } from "../src/agents/mock-provider";
import type { AiProvider, KnowledgeReply, KnowledgeRequest } from "../src/agents/provider";
import { testServer } from "./helpers";

type Server = Awaited<ReturnType<typeof testServer>>;
let server: Server | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
});

const CANARY = "VERTRAULICH-GESUNDHEITSDATEN";

/** The offline model, with its answers to knowledge questions replaced and every request kept. */
function model(answer?: (req: KnowledgeRequest) => KnowledgeReply) {
  const mock = new MockProvider(0);
  const requests: KnowledgeRequest[] = [];
  const provider: AiProvider = {
    info: mock.info,
    draft: (r, c) => mock.draft(r, c),
    critique: (r) => mock.critique(r),
    draftChangeRequest: (r, c) => mock.draftChangeRequest(r, c),
    reviewRisks: (r, c) => mock.reviewRisks(r, c),
    draftStatusReport: (r, c) => mock.draftStatusReport(r, c),
    extractMinutes: (r, c) => mock.extractMinutes(r, c),
    answerQuestion: async (r, c) => {
      requests.push(r);
      return answer ? { reply: answer(r) } : mock.answerQuestion(r, c);
    },
  };
  return { provider, requests };
}

const ask = async (s: Server, user: string, question: string) => {
  const res = await s.as(user).post("/api/knowledge/ask", { question });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as KnowledgeAnswer;
};

/** A released Datenschutz-Vorabklärung in KPO: confidential, for the Datenschutz role and the governance. */
async function releaseConfidential(s: Server) {
  const kpo = (await s.repo.findByCode("KPO"))!;
  const skill = s.repo.model.skill("init.datenschutz");
  await s.repo.append(
    kpo.projectId,
    kpo.lastSeq,
    [
      { type: "SkillRunRequested", data: { runId: "run-ds", skillId: skill.id } },
      {
        type: "SkillRunCompleted",
        data: {
          runId: "run-ds",
          skillId: skill.id,
          draft: {
            summary: `${CANARY}: Das Kundenportal verarbeitet Gesundheitsdaten für die Rückerstattung.`,
            sections: skill.sections.map((heading) => ({ heading, body: `${heading}: Gesundheitsdaten.` })),
            openPoints: [],
          },
          findings: [],
          producer: { kind: "human" },
        },
      },
      {
        type: "SkillDecisionRecorded",
        data: {
          skillId: skill.id,
          role: "DS",
          decision: "freigegeben",
          reason: "",
          konsent: false,
          conditions: [],
        },
      },
      { type: "DeliverableReleased", data: { deliverableId: "dsvor" } },
    ],
    { userId: "u-sandra", displayName: "Sandra Roth", roles: ["DS"], channel: "web" },
    "c-ds",
  );
}

describe("Wissen agent (A13)", () => {
  it("answers from what the person may read and names its sources", async () => {
    server = await testServer();
    const a = await ask(server, "u-anna", "Was wurde zur Migration entschieden?");
    expect(a.found).toBe(true);
    expect(a.answer).toMatch(/\[Q1\]/);
    expect(a.sources[0]).toMatchObject({ id: "Q1", projectCode: "CRM", kind: "entscheid" });
    expect(a.sources[0]!.excerpt).toMatch(/zwei Etappen/);
    expect(a.producer).toMatchObject({ kind: "ai", agent: "A13" });
  });

  it("never gives the model a confidential result the person may not read", async () => {
    const { provider, requests } = model();
    server = await testServer({ provider });
    await releaseConfidential(server);
    // Nina (Fachvertretung in KPO) may not read the Datenschutz-Vorabklärung; Sandra (Datenschutz) may.
    const nina = await ask(server, "u-nina", "Werden Gesundheitsdaten verarbeitet?");
    expect(JSON.stringify(requests)).not.toContain(CANARY);
    expect(JSON.stringify(nina)).not.toContain(CANARY);
    const sandra = await ask(server, "u-sandra", "Werden Gesundheitsdaten verarbeitet?");
    expect(sandra.sources.map((s) => s.kind)).toContain("ergebnis");
    expect(JSON.stringify(requests.at(-1))).toContain(CANARY);
    // The PMO sees every project, but not confidential content.
    requests.length = 0;
    await ask(server, "u-peter", "Werden Gesundheitsdaten verarbeitet?");
    expect(JSON.stringify(requests)).not.toContain(CANARY);
  });

  it("searches only the projects the person sees", async () => {
    const { provider, requests } = model();
    server = await testServer({ provider });
    // Anna is in KPO, CRM and INT, not in ERP; Peter (PMO) sees all.
    const anna = await ask(server, "u-anna", "Welche Rollen gibt es im ERP-Upgrade Finanzen?");
    expect(requests.flatMap((r) => r.passages.map((p) => p.source)).some((s) => s.startsWith("ERP"))).toBe(
      false,
    );
    expect(anna.sources.every((s) => s.projectCode !== "ERP")).toBe(true);
    const peter = await ask(server, "u-peter", "Welche Rollen gibt es im ERP-Upgrade Finanzen?");
    expect(peter.sources[0]?.projectCode).toBe("ERP");
    expect(peter.searched.projects).toBeGreaterThan(anna.searched.projects);
  });

  it("drops sources it was not given, and gives no answer without a source", async () => {
    const invented = model(() => ({
      found: true,
      answer: "Das Budget ist freigegeben [Q42].",
      citations: ["Q42"],
    }));
    server = await testServer({ provider: invented.provider });
    const a = await ask(server, "u-anna", "Was wurde zur Migration entschieden?");
    expect(a).toMatchObject({ found: false, answer: NOTHING_FOUND, sources: [] });

    const mixed = model((r) => ({
      found: true,
      answer: `Zwei Etappen [${r.passages[0]!.id}], sagt auch [Q42].`,
      citations: [r.passages[0]!.id, "Q42"],
    }));
    await server.app.close();
    server = await testServer({ provider: mixed.provider });
    const b = await ask(server, "u-anna", "Was wurde zur Migration entschieden?");
    expect(b.found).toBe(true);
    expect(b.answer).toBe("Zwei Etappen [Q1], sagt auch.");
    expect(b.sources.map((s) => s.id)).toEqual(["Q1"]);
  });

  it("asks no model when nothing fits, and logs no question", async () => {
    const { provider, requests } = model();
    const lines: string[] = [];
    const { pino } = await import("pino");
    server = await testServer({
      provider,
      logger: pino({ level: "info" }, { write: (l: string) => lines.push(l) }),
    });
    const a = await ask(server, "u-anna", "Wie wird das Wetter morgen?");
    expect(a).toMatchObject({ found: false, sources: [] });
    expect(requests).toHaveLength(0);
    await ask(server, "u-anna", "Was wurde zur Migration entschieden?");
    const log = lines.join("\n");
    expect(log).toContain('"skillId":"wissen.frage"');
    expect(log).toContain('"sourceProjects":["CRM"]');
    expect(log).not.toContain("Migration");
  });

  it("refuses an empty or over-long question", async () => {
    server = await testServer();
    expect((await server.as("u-anna").post("/api/knowledge/ask", { question: "?" })).statusCode).toBe(422);
    expect(
      (await server.as("u-anna").post("/api/knowledge/ask", { question: "x".repeat(501) })).statusCode,
    ).toBe(422);
  });
});
