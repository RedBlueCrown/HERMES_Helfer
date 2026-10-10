# Trying HERMES Helfer in Azure

How to put the whole app into your own Azure subscription and try it with working agents. One script does the set-up; afterwards you sign in with your company account and use the app as PMO, project lead and decider at once. For the step-by-step runbook of the pilot environment, see [deployment.md](deployment.md).

Use **fictional data only** until the questions on hosting, data protection and logging are answered ([offene-fragen.md](offene-fragen.md): F1 to F4, F21 to F28).

## What you get

| Part | In Azure | What it does for you |
|---|---|---|
| Web app and API | Container Apps, one instance, in its own virtual network | The app at an `https://….azurecontainerapps.io` address |
| Sign-in | Two Entra ID app registrations, four app roles | Only people with a role get in; you get the role PMO |
| Projektakte | Azure SQL Database with a ledger table, private endpoint | Every step is recorded, tamper-evident |
| Agents | Azure OpenAI deployment in Microsoft Foundry, regional in the EU, private endpoint, no keys | The agents below |
| Logs | Log Analytics, Application Insights | Requests, model calls, `ai_run` audit entries |

The agents that work in this environment:

| Agent | Where you use it | What it does |
|---|---|---|
| Drafting agents (A2 to A8) | Lieferergebnisse → «Entwurf erstellen» | Write the draft of a deliverable from the project's data and released results |
| Kritiker (A11) | Automatically, after every draft | Checks structure and content; its hints appear with the draft |
| Delivery-Assistent (A1) | «Assistent fragen» | Answers free-text questions about the project from the engine's data and starts drafts on request; never decides |
| Change-Request (A10) | Change Requests → «Mit dem Agenten ausarbeiten» | Turns a rough wish into a change request and says which areas it touches; the impact is computed, the Projektausschuss decides |
| Risiko (A12) | Risiken → «Risiken prüfen lassen» (project lead) | Reviews the risk register against the project's state and proposes new risks and new assessments, each with its reason; the project lead accepts what fits |

## Before you start

1. **Azure subscription** in which you are **Owner** (the templates create role assignments and private endpoints).
2. **Entra ID**: the role **Application Administrator** or **Cloud Application Administrator**, or an administrator who runs the script with you. The script creates two app registrations and grants consent for the organisation.
3. **Model and quota.** The default is `gpt-5.1` (version `2025-11-13`) as *Standard* deployment in Sweden Central, with 50,000 tokens per minute. Check whether your subscription has it:

   ```bash
   az cognitiveservices model list -l swedencentral -o table --query "[?model.name=='gpt-5.1']"
   az cognitiveservices usage list -l swedencentral -o table
   ```

   10,000 tokens per minute are enough to try it (`MODEL_CAPACITY=10`). If the model is missing or needs a registration, request it in the Azure AI Foundry portal (Management center → Quota), or choose another model (next section).
4. **A shell:** [Azure Cloud Shell](https://shell.azure.com) (Bash) has everything. Elsewhere you need the Azure CLI, `jq`, `git` and `curl`. No Docker: the image is built in the container registry.

## Deploy

```bash
git clone https://github.com/RedBlueCrown/HERMES_Helfer.git && cd HERMES_Helfer
az login                       # not needed in Cloud Shell
scripts/deploy-azure.sh
```

The first run takes 20 to 30 minutes. The script checks the model and the quota, deploys the infrastructure, creates the app registrations, gives you the role PMO, builds the image, runs the database migrations and waits until the app answers. At the end it prints the address. Run it again to deploy a new version.

Options, as environment variables in front of the command:

| Setting | Default | Example |
|---|---|---|
| `LOCATION` | `swedencentral` | another EU region that offers the model |
| `MODEL`, `MODEL_VERSION` | from `infra/test.bicepparam` | `MODEL=gpt-4.1 MODEL_VERSION=2025-04-14` |
| `MODEL_SKU` | `Standard` (processing in this region only) | `DataZoneStandard` (EU data zone, more capacity; question F3) |
| `MODEL_CAPACITY` | `50` (thousand tokens per minute) | `10` |
| `REASONING_EFFORT` | the model's default | `low` makes GPT-5 models answer faster; only for the GPT-5 series |
| `ENV_NAME` | `test` | `demo` (a second, separate environment) |

Example: `MODEL_CAPACITY=10 REASONING_EFFORT=low scripts/deploy-azure.sh`. To switch to another model later, remove the environment first (see below); a deployment cannot change its model.

## First steps

1. **Sign in.** Open the address, sign in with your company account. Under your name at the top right it says «PMO».
2. **Create a project.** Vorhaben → «Neues Vorhaben», project lead «Ich selbst».
3. **Take the other roles.** In the project: «Beteiligte und Rollen» → «Mich selbst», then for example «Auftraggeber / Projektausschuss», «Informationssicherheit (ISM)» and «Datenschutz». Now you can try every decision on your own.
4. **Let an agent draft.** Lieferergebnisse → «Kick-off-Roundtable» → «Entwurf erstellen». After 10 to 60 seconds the draft appears as «Entwurf (KI)»; the drawer names the model and shows the Kritiker's hints. Edit it if you like, then «Freigeben».
5. **Ask the assistant.** «Assistent fragen». Its header shows «KI-Modell … (Sweden Central (regional))»: it understands free text, for example «Was fehlt noch bis zum Gate?» or «Starte Projektgrundlagen».
6. **Change request.** «Change Requests» → «Neuer Change Request». Describe a wish in two sentences, click «Mit dem Agenten ausarbeiten», check the text and the areas, estimate the effort, «Einreichen». Then decide it as Projektausschuss (with Konsent) and, if it touches personal data, confirm the recheck as ISM and Datenschutz. Until then the gate stays closed.
7. **Risks.** «Risiken» → «Risiken prüfen lassen»: the agent names the facts it looked at and proposes risks. Select the ones that fit, adjust them, «Ausgewählte übernehmen». A high risk gives the responsible role a task; open a risk to assess it again or close it.
8. **Portfolio.** «Portfolio» shows your projects with their signals, for example the open change request or a high risk.
9. **Invite colleagues.** Entra admin center → Enterprise applications → «HERMES Helfer API (test)» → Users and groups → add people or groups with the role *HH.User* (or *HH.PMO*, *HH.Portfolio*). To give them a role in a project, you need their Entra object ID (Entra admin center → Users → the person → Object ID); a people picker follows later (todo-later E26).

## Check that the agents use Azure OpenAI

- The draft drawer says «Entwurf (KI) · … · Modell hh-gpt …», and the assistant's header names the model. In the local test mode both say «mock» or «Testmodus».
- Application Insights → Transaction search: requests such as `POST /api/projects/:code/skills/:skillId/runs` with a dependency call to `ais-…openai.azure.com`.
- Log Analytics, the audit entries of the agents (no content, only metadata):

  ```kusto
  ContainerAppConsoleLogs
  | where Log has '"type":"ai_run"'
  | project TimeGenerated, Log
  | order by TimeGenerated desc
  ```

## When something does not work

| What you see | Likely cause | What to do |
|---|---|---|
| The script stops: «… is not offered as Standard in swedencentral» | The model or version is not available in the region | `MODEL=… MODEL_VERSION=…` or another `LOCATION`; list: `az cognitiveservices model list -l swedencentral -o table` |
| The script stops: «Not enough quota» | Too little quota for the model | `MODEL_CAPACITY=10`, or request more in the Foundry portal |
| The deployment fails with *InsufficientQuota* or a note on registration | The model needs approval or more quota | Request it, or pick another model |
| `az acr build` fails | Some subscription types (free trial, student) cannot use ACR Tasks | The script prints the `docker build` and `docker push` commands; then run it with `SKIP_BUILD=1 TAG=…` |
| Sign-in shows *AADSTS50105* | Your account has no app role | Assign a role (step 9); the script gives it to the person who runs it |
| Drafts fail with «Das KI-Modell ist gerade nicht erreichbar» right after the first deployment | The app's permission on the model takes a few minutes to become effective | Wait 10 minutes and try again; the logs show the status code (401/403) |
| Drafts fail with «… keinen gültigen Entwurf geliefert» | The answer was cut off at the token limit | `REASONING_EFFORT=low`, or raise `AZURE_OPENAI_MAX_COMPLETION_TOKENS` on the container app |
| The assistant answers «aus den festen Regeln» | The chat model call failed | As above; the logs show «chat model failed» |
| The app does not become ready | Database or migration | `az containerapp logs show -g rg-hermes-helfer-test -n ca-hh-test-api --tail 50` |

## Costs and removing it

The test environment costs roughly 80 to 100 USD (or EUR) per month while it exists, mainly for the container that is always on, the database and the private endpoints. The models are billed per token on top; a draft uses a few thousand tokens. Use the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/) for exact figures.

Remove everything:

```bash
ENV_NAME=test scripts/destroy-azure.sh
```

## Not part of the test environment

Front Door with a web application firewall, API Management as AI gateway, Sentinel, Defender plans and deployment from GitHub Actions are planned before go-live (todo-later H03). The steps for the pilot environment, with groups per role and the locked ledger digests, are in [deployment.md](deployment.md).
