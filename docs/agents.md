# The agents of HERMES Helfer

How the agents are built, how they are tested, which platform suits them on Azure, and how to carry them into another version of HERMES Helfer. Status: 19 October 2026.

![The agents and their interactions](diagrams/agents.png)

Interactive versions, with every box linked to its code: [agents](diagrams/agents.html), [system architecture](diagrams/architecture.html) (drawn with [archify](https://github.com/tt-a1i/archify); sources in `docs/diagrams/*.archify.json`).

## 1. Which agents exist

The target architecture names 13 agents (`packages/core/src/model/agents.ts`). Eleven work today; two are planned.

| Agent | What it does | Started by | Code |
|---|---|---|---|
| A1 Delivery-Assistent | Answers questions about the project. The model picks among ten tools: nine read the engine's facts (next step, tasks, gate, results, change requests, risks, status report …), one starts a draft when the person asks for it. It never decides. | Chat in the web app | `apps/api/src/agents/orchestrator.ts` |
| A2 to A8 drafting agents | Draft the results of 44 skills (Projektauftrag, ISDS-Konzept, Testkonzept …), along the organisation's Word template where one exists. A2 also drafts the texts of a status report. | «Entwurf erstellen», or A1 | `runner.ts`, `prompts.ts`, `status-report-agent.ts` |
| A10 Change-Request | Turns a rough wish into a change request and says which areas it touches. Never estimates effort or cost. | «Mit dem Agenten ausarbeiten» | `change-request-agent.ts` |
| A11 Kritiker | Checks every draft: a deterministic checklist first, then the model's content review. Also checks change requests and status texts. | Automatically, after each draft | `kritiker.ts` |
| A12 Risiko | Proposes new risks and new assessments, each resting on a fact the engine supplied. | «Risiken prüfen lassen» | `risk-agent.ts` |
| A9 Protokoll, A13 Wissen | Planned: decisions and tasks from meeting minutes; finding documents in SharePoint. They need Microsoft Graph (Increment 3). | – | – |

Agents propose; people decide. Drafts and proposals are stored only when a person accepts or releases them, and every decision goes through the engine's permission checks (`packages/core/src/engine/permissions.ts`), for which no agent has a tool.

## 2. How they are programmed

No agent framework: the agents are plain TypeScript in the API process (about 3,700 lines in `apps/api/src/agents`, the offline model included), and they call Azure OpenAI directly over its REST API (`azure-openai-provider.ts`, no SDK). Neither Microsoft Agent Framework nor Copilot Studio nor LangChain is involved.

- **One port for the model.** `provider.ts` defines `AiProvider`: `draft`, `critique`, `draftChangeRequest`, `reviewRisks`, `draftStatusReport` and `chat`. Behind it sit the Azure OpenAI adapter and an offline model for development and tests (`mock-provider.ts`).
- **Structured output.** Every agent except the chat answers in a strict JSON schema; the parsers shorten over-long text instead of rejecting the answer (`output.ts`). A test keeps the schemas and the parsers in step.
- **Tool calling for A1.** The model may call tools for up to four rounds; the tools read the engine's views of the project with the person's own permissions. If the model fails, A1 answers from fixed rules and says so.
- **The engine is the truth.** Facts, tasks, permissions and the history (events in an append-only ledger table) come from the engine (`packages/core`), never from the model. Instructions hidden in project data are data, not instructions (each prompt says so, and the evaluation checks it).
- **Limits.** All calls pass the quota gate (`quota.ts`): calls at the same time, per person, and tokens per person and day. Drafts run in the background with their own token limit and time-out.
- **Security.** Managed identity, no keys; the model is reachable only through a private endpoint; regional deployment in Sweden Central (EU). Every agent run is audited (who, what, model, tokens, duration; never the content).

## 3. How they are tested

| Level | What | Where |
|---|---|---|
| Unit tests | Every agent against fake models: request formats for Azure (schemas, tool calls, the second round of a chat), parsing, limits, errors. | `apps/api/test`, in CI |
| Evaluation set | 18 fixed, fictional cases for all eleven agents. Critical checks must hold every time (no hidden instruction followed, no effort estimated, the assistant answers with the model, starts no draft unasked and claims no decision); quality checks count as a rate (at least 80 %). | `apps/api/src/eval`: offline in CI; against the real model with `scripts/check-agents.sh` |
| End-to-end | The web app in a browser with the offline model: drafts, assistant, change requests, risks, status reports, templates. | `apps/web/e2e`, in CI |

In Azure, `scripts/check-agents.sh` starts the job `caj-hh-<env>-eval`: it runs inside the app's network with the app's identity, prints the report and names the model's error when the assistant had to fall back to its rules. Run it after each deployment and after each change of model, prompt or setting; with `--repeat 3` locally (`npm run eval -w @hermes-helfer/api -- --provider azure --repeat 3`) the rates become more reliable.

## 4. Which platform on Azure

**Recommendation: keep the agents as code in TypeScript on Azure OpenAI, and add Microsoft Foundry for evaluation and monitoring only.** Direct calls are the shortest path to the model; the tools run in the API under the person's permissions; the history and audit stay in the organisation's database; nothing leaves the EU deployment. The options, as of 19 October 2026:

| Option | State | Fit for HERMES Helfer |
|---|---|---|
| **Code-first TypeScript + Azure OpenAI** (today) | Stable | **Best**: fewest hops, full control over permissions, data and costs |
| Microsoft Agent Framework | 1.0 for .NET and Python since April 2026, Go in preview; **no TypeScript SDK and none planned** | Poor: would need a second service in Python or .NET next to the TypeScript app |
| Foundry Agent Service | Generally available (new runtime on the Responses API, March 2026); JavaScript SDK `@azure/ai-projects`; private networking with own storage in the "standard setup"; Sweden Central supported | Possible, little gain: one more hop and state held by the service. Its web search tools send queries outside the EU boundary. Its "workflows" retire on 1 December 2026 in favour of Agent Framework |
| Copilot Studio | Low-code, part of Power Platform | **Excluded**: Power Platform is ruled out, and access would run through a second identity layer instead of the engine |
| OpenAI Agents SDK for TypeScript | 0.20, not yet 1.0; works with Azure OpenAI through your own client | Optional for A1's tool loop; its tracing is on by default and sends traces to OpenAI, so turn it off (`OPENAI_AGENTS_DISABLE_TRACING=1`) |

What would make the agents faster and better, each to be measured with the evaluation set before and after:

1. **Model deployments only "Regional" or "Data Zone EU"**, never "Global" (data residency).
2. **Effort and model per agent**: `REASONING_EFFORT=low` for drafts and the Kritiker; a smaller, faster model for the chat and the Kritiker if the evaluation keeps passing.
3. **Streaming the assistant's answer**, so the first words appear at once (todo-later E30).
4. **The Responses API for the assistant** (stateless, `store: false`): recommended by OpenAI for new tool-calling code and available in Sweden Central. Not urgent: Chat Completions keeps working.
5. **Foundry evaluations and tracing**: OpenTelemetry spans of the model calls to Application Insights (content capture off), Foundry's agent evaluators (task adherence, tool call accuracy) on the evaluation cases, red-teaming before a release. From TypeScript through `@azure/ai-projects`.
6. Optionally **promptfoo** in CI (TypeScript, Azure with Entra ID); keep its grading on your own Azure model and set `PROMPTFOO_DISABLE_TELEMETRY=1`.

Note: some of these facts come from search extracts because the Microsoft documentation sites were not reachable from the research environment; check the sources below before a purchase or architecture decision. Reports that newer models (gpt-5.4 and later) reject tools together with reasoning on Chat Completions are unverified: run the evaluation set before changing the model.

## 5. Carrying the agents into another HERMES Helfer

The agents depend on the rest of the app through a few narrow points. A version of HERMES Helfer without agents gets them by providing these:

| What the agents need | In this repository | In another app |
|---|---|---|
| The project's facts | `ProjectContext` (`provider.ts`): code, name, description, phase, profile, released results with summaries (confidential ones by name only, need-to-know), open risks | Built from its own data model |
| A place for results | Events (`SkillRunCompleted`, `ChangeRequestSubmitted`, `RiskRecorded`, `RiskAssessed`, `StatusReportPublished`) through `ProjectService` | Its own storage, written only after a person accepts |
| Who may do what | `permissions.ts` in the engine | Its own role checks; agents never get a decision |
| A1's tools | The engine's views (`views.ts`, `tasks.ts`) | The same ten tools against its own read model; «entwurf_anstossen» behind its permission check |
| The model | `AiProvider` with the Azure OpenAI adapter, quota gate and offline model | Copied as it is; settings `AZURE_OPENAI_*`, a managed identity with the role «Cognitive Services OpenAI User» |

Files to take: `packages/core` (the HERMES model and engine, if the other app does not already have its own), `apps/api/src/agents`, `apps/api/src/eval`, optionally `apps/api/src/documents` (Word templates), with their tests in `apps/api/test` (`eval.test.ts`, the provider tests in `units.test.ts`).

A clean hand-over is an npm package `@hermes-helfer/agents`: prompts, schemas, tool interfaces, the model adapter, the quota gate and the evaluation set, with the five points above as interfaces the other app implements. The next step is to look at the other app's code and cut the package along its data model; then its own CI runs the unit tests and the offline evaluation, and `scripts/check-agents.sh` (or `npm run eval -- --provider azure`) checks the agents against its model.

## Sources

Read on 19 October 2026 unless dated.

- Microsoft Agent Framework 1.0: https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/ (3 April 2026); https://github.com/microsoft/agent-framework; no JavaScript SDK planned: https://github.com/microsoft/agent-framework/issues/1216 (2 June 2026)
- Foundry Agent Service: https://devblogs.microsoft.com/foundry/foundry-agent-service-ga/ (16 March 2026); regions: https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/limits-quotas-regions; virtual networks: https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/virtual-networks; web search tools: https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/web-overview; workflows retiring: https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/workflow; JavaScript SDK: https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/ai/ai-projects/CHANGELOG.md
- Copilot Studio data residency: https://learn.microsoft.com/en-us/microsoft-copilot-studio/geo-data-residency
- OpenAI Agents SDK for TypeScript, tracing: https://github.com/openai/openai-agents-js/blob/main/docs/src/content/docs/guides/tracing.mdx
- Foundry evaluators: https://learn.microsoft.com/en-us/azure/foundry/concepts/built-in-evaluators; tracing for any framework: https://devblogs.microsoft.com/foundry/build-2026-from-observability-to-roi-for-ai-agents-on-any-framework/ (3 June 2026)
- promptfoo with Azure: https://promptfoo.dev/docs/providers/azure
- Responses API: https://developers.openai.com/api/docs/guides/migrate-to-responses; deployment types: https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/deployment-types
