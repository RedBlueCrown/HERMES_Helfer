// Runs the evaluation of the agents (todo-later H11) and prints the report.
//
//   npm run eval -w @hermes-helfer/api                    offline model (as in CI)
//   npm run eval -w @hermes-helfer/api -- --provider azure --repeat 3 --out eval-report.json
//   npm run eval -w @hermes-helfer/api -- --provider claude --out claude.json --html claude.html
//   npm run eval -w @hermes-helfer/api -- --from azure.json --from claude.json --html vergleich.html
//
// With --provider azure the settings AZURE_OPENAI_* come from the environment,
// as for the API, and the sign-in from the Azure CLI (az login). With --provider
// claude the key comes from ANTHROPIC_API_KEY in the environment; only on a
// developer's machine, as the Claude API processes the cases outside the EU (they
// are fictional). --html writes a page with every answer and its checks, one
// column per model, earlier reports (--from) included; with --from alone nothing
// runs. The report files hold the model's answers to the fictional cases; they
// are not committed.
// Exit code 1 when a call failed, a critical check failed, or the quality rate
// is below --min-quality (default 0.8).
//
// --print-files: the job in Azure has no disk to keep files on, so it prints the
// report and the page compressed into its log, in lines «EVAL-JSON i/n …» and
// «EVAL-HTML i/n …»; scripts/check-agents.sh puts them together again. Fictional
// cases only, as everywhere in the evaluation.

import type { TokenCredential } from "@azure/identity";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { createProvider } from "../agents/create-provider";
import { loadConfig, runsInAzure } from "../config";
import { azureCredential } from "../util/azure-credential";
import { EVAL_CASES } from "./cases";
import { reportHtml } from "./html-report";
import { formatReport, runEval, verdict, type EvalReport } from "./run-eval";

const { values } = parseArgs({
  options: {
    provider: { type: "string" },
    repeat: { type: "string", default: "1" },
    case: { type: "string", multiple: true },
    out: { type: "string" },
    html: { type: "string" },
    from: { type: "string", multiple: true },
    "print-files": { type: "boolean", default: false },
    "min-quality": { type: "string", default: "0.8" },
  },
});

const repeat = Number(values.repeat);
const minQuality = Number(values["min-quality"]);
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) throw new Error("--repeat: 1 to 20");
if (!(minQuality >= 0 && minQuality <= 1)) throw new Error("--min-quality: 0 to 1");

const reports: EvalReport[] = [];
for (const file of values.from ?? []) reports.push(JSON.parse(await readFile(file, "utf8")) as EvalReport);

if (values.provider || !reports.length) {
  const ALIASES: Record<string, string> = { azure: "azure-openai", claude: "anthropic", offline: "mock" };
  const provider = values.provider && (ALIASES[values.provider] ?? values.provider);
  // The settings below leave out what tells the API it runs in Azure, so check here.
  if (provider === "anthropic" && runsInAzure(process.env)) {
    throw new Error("--provider claude is for a developer's machine, not for Azure.");
  }
  // Only the model's settings matter: the evaluation serves no requests and signs no one in,
  // so the API's other settings (and its guards for them) stay out, also in its container.
  // The offline model answers at once here; the API's latency only imitates the real one.
  const MODEL_SETTINGS = /^(AI_|AZURE_OPENAI_|ANTHROPIC_|MOCK_AI_)|^AZURE_CLIENT_ID$/;
  const config = loadConfig({
    MOCK_AI_LATENCY_MS: "0",
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => MODEL_SETTINGS.test(k))),
    NODE_ENV: "development",
    AUTH_MODE: "dev",
    ...(provider ? { AI_PROVIDER: provider } : {}),
  });
  let credential: Promise<TokenCredential> | undefined;
  const model = await createProvider(
    config,
    () => (credential ??= azureCredential({ managedIdentityOnly: false, clientId: config.AZURE_CLIENT_ID })),
  );
  const cases = values.case?.length ? EVAL_CASES.filter((c) => values.case!.includes(c.id)) : EVAL_CASES;
  if (!cases.length) throw new Error(`Unknown case; known: ${EVAL_CASES.map((c) => c.id).join(", ")}`);

  const report = await runEval(model, cases, { repeat });
  console.log(formatReport(report, minQuality));
  if (values.out) {
    await writeFile(values.out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Bericht mit den Antworten: ${values.out}`);
  }
  reports.push(report);
  process.exitCode = verdict(report, minQuality).passed ? 0 : 1;
}

if (values.html) {
  await writeFile(values.html, reportHtml(reports, minQuality));
  console.log(`Seite zum Lesen und Bewerten: ${values.html}`);
}

/** A file as lines «EVAL-<kind> i/n <base64 of gzip>», short enough for any log. */
function printFile(kind: string, content: string): void {
  const data = gzipSync(content).toString("base64");
  const size = 3000;
  const n = Math.ceil(data.length / size);
  for (let i = 0; i < n; i++)
    console.log(`EVAL-${kind} ${i + 1}/${n} ${data.slice(i * size, (i + 1) * size)}`);
}

if (values["print-files"]) {
  printFile("JSON", `${JSON.stringify(reports.at(-1), null, 2)}\n`);
  printFile("HTML", reportHtml(reports, minQuality));
}
