// Runs the evaluation of the agents (todo-later H11) and prints the report.
//
//   npm run eval -w @hermes-helfer/api                    offline model (as in CI)
//   npm run eval -w @hermes-helfer/api -- --provider azure --repeat 3 --out eval-report.json
//
// With --provider azure the settings AZURE_OPENAI_* come from the environment,
// as for the API, and the sign-in from the Azure CLI (az login). The report
// file holds the model's answers to the fictional cases; it is not committed.
// Exit code 1 when a call failed, a critical check failed, or the quality rate
// is below --min-quality (default 0.8).

import type { TokenCredential } from "@azure/identity";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createProvider } from "../agents/create-provider";
import { loadConfig } from "../config";
import { azureCredential } from "../util/azure-credential";
import { EVAL_CASES } from "./cases";
import { formatReport, runEval, verdict } from "./run-eval";

const { values } = parseArgs({
  options: {
    provider: { type: "string" },
    repeat: { type: "string", default: "1" },
    case: { type: "string", multiple: true },
    out: { type: "string" },
    "min-quality": { type: "string", default: "0.8" },
  },
});

const provider = values.provider === "azure" ? "azure-openai" : values.provider;
// Only the model's settings matter: the evaluation serves no requests, so it needs no sign-in.
// The offline model answers at once here; the API's latency only imitates the real one.
const config = loadConfig({
  MOCK_AI_LATENCY_MS: "0",
  ...process.env,
  NODE_ENV: "development",
  AUTH_MODE: "dev",
  ...(provider ? { AI_PROVIDER: provider } : {}),
});
let credential: Promise<TokenCredential> | undefined;
const model = createProvider(
  config,
  () => (credential ??= azureCredential({ managedIdentityOnly: false, clientId: config.AZURE_CLIENT_ID })),
);

const repeat = Number(values.repeat);
const minQuality = Number(values["min-quality"]);
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) throw new Error("--repeat: 1 to 20");
if (!(minQuality >= 0 && minQuality <= 1)) throw new Error("--min-quality: 0 to 1");
const cases = values.case?.length ? EVAL_CASES.filter((c) => values.case!.includes(c.id)) : EVAL_CASES;
if (!cases.length) throw new Error(`Unknown case; known: ${EVAL_CASES.map((c) => c.id).join(", ")}`);

const report = await runEval(model, cases, { repeat });
console.log(formatReport(report, minQuality));
if (values.out) {
  await writeFile(values.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Bericht mit den Antworten: ${values.out}`);
}
process.exitCode = verdict(report, minQuality).passed ? 0 : 1;
