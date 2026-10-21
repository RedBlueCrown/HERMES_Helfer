# Testing the agents

Three ways to test the agents, from the quickest to the one closest to production. All three run the same fixed, fictional cases with the same checks (`apps/api/src/eval`). All three can write a page where you read every answer, see its checks, compare models side by side and rate each answer yourself.

| Way | Model | What you need | What it is for |
|---|---|---|---|
| Offline | None (fixed answers) | Nothing | The plumbing: runs in CI with every change |
| Claude on your computer | Claude, through the Claude API | Node.js 22, a Claude API key | Trying prompts and comparing models without Azure |
| In Azure | Your Azure OpenAI deployment | The test environment ([staging.md](staging.md)) | The model that will run in production; after every deployment |

## Claude on your computer, without Azure

1. Install Node.js 22, then get the code: `git clone https://github.com/RedBlueCrown/HERMES_Helfer.git`, `cd HERMES_Helfer`, `npm ci`.
2. Create an API key in the [Claude Console](https://console.anthropic.com/) under «API Keys». Put it only into the shell you work in. Never write it into a file in the repository, and never paste it into a chat:
   - macOS or Linux: `read -rs ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY` (paste the key, then press Enter; nothing is shown)
   - Windows PowerShell 7: `$env:ANTHROPIC_API_KEY = Read-Host -MaskInput "Key"`
3. Run the evaluation:

   ```bash
   npm run eval -w @hermes-helfer/api -- --provider claude --out claude.json --html claude.html
   ```

4. Open `apps/api/claude.html` in the browser.
   - A table at the top shows each model's result. A second table shows every case per model:
     - ✓ passed
     - ~ a quality check was missed
     - ✗ a critical rule was broken, or the call failed
   - Each case shows the agent's answer, laid out like the result in the app, with every check and why it failed.
   - Under each answer you can rate it («gut», «brauchbar», «schlecht») and add a note. The ratings stay in your browser; «Bewertungen herunterladen» saves them as a file.

To try the app itself with Claude, start it with the key in the same shell: `AI_PROVIDER=anthropic npm run dev`. Then open <http://localhost:5173>, choose a demo project, and ask the assistant or let an agent draft a result.

Settings, as environment variables:

| Setting | Default | What it does |
|---|---|---|
| `ANTHROPIC_MODEL_DRAFT` | `claude-opus-5-5` | Model for drafts, the Kritiker and the other agents with a fixed answer form |
| `ANTHROPIC_MODEL_CHAT` | `claude-opus-5-5` | Model for the Delivery-Assistent; `claude-sonnet-5-5` or `claude-haiku-5-5` to compare speed and cost |
| `ANTHROPIC_EFFORT` | the model's own | `low`, `medium`, `high`: how much the model thinks before it answers |
| `ANTHROPIC_MAX_TOKENS`, `ANTHROPIC_DRAFT_MAX_TOKENS` | 16,000 / 32,000 | Upper bound per call, thinking included |

Further options: `--repeat 3` runs every case three times, because a model answers differently each time. `--case entwurf-isds` runs one case. A full run makes about 23 model calls; the page shows the tokens used. For the cost, see the [price list](https://claude.com/pricing#api).

**Fictional data only.** The Claude API processes data in the USA or worldwide, never only in the EU. HERMES Helfer needs EU-only processing, so the app refuses `AI_PROVIDER=anthropic` in production, in Azure and with a database (`STORE=sql`). Claude can process data inside the EU only through Amazon Bedrock (`eu.` inference profiles) or Google Vertex AI (EU regions). Claude in Microsoft Foundry is offered as «Global Standard» or «US Data Zone», not EU-only (as of October 2026).

## In Azure, with your model

The model in Azure is reachable only from the app's network, so the evaluation runs there as a job. In Cloud Shell, from the folder `HERMES_Helfer`:

```bash
scripts/check-agents.sh
```

The console shows the report. The script also saves `eval-azure-<time>.html` and `eval-azure-<time>.json` in the current folder. To get them, use «Manage files» → «Download» in Cloud Shell. See [staging.md](staging.md#check-the-agents-with-the-evaluation-set).

## Comparing models side by side

Put the report files next to each other and build one page, one column per model:

```bash
npm run eval -w @hermes-helfer/api -- --from eval-azure-20261021-1930.json --from claude.json --html vergleich.html
```

With `--from` alone nothing runs; the page is built from the files.

## What the checks mean

- **kritisch:** rules that must hold every time. An instruction hidden in project data is not followed. No effort or cost is estimated. Personal data is recognised. The assistant starts no draft unasked and makes no decision. One violation fails the run.
- **qualitaet:** checks of content, counted as a rate. The run passes from 80 % (`--min-quality`).
- **Your ratings** cover what no check can judge: whether a text is complete, fits the organisation and helps the project. When the same flaw comes up again and again, change the prompt (`apps/api/src/agents/prompts.ts`) and run again. A flaw that can be described precisely becomes a new check (`apps/api/src/eval/cases.ts`).

Every change to a prompt, a model or a setting gets a run before and after. Keep the report files for that comparison. They are not committed (`.gitignore`).
