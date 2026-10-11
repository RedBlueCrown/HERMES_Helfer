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
| Projektführung (A2) | Statusbericht → «Texte mit dem Agenten entwerfen» | Drafts the overview, outlook, problems and measures of the status report; the colours are yours, suggested by the app |
| Kritiker (A11) | Automatically, after every draft | Checks structure and content; its hints appear with the draft |
| Delivery-Assistent (A1) | «Assistent fragen» | Answers free-text questions about the project from the engine's data and starts drafts on request; never decides |
| Change-Request (A10) | Change Requests → «Mit dem Agenten ausarbeiten» | Turns a rough wish into a change request and says which areas it touches; the impact is computed, the Projektausschuss decides |
| Risiko (A12) | Risiken → «Risiken prüfen lassen» (project lead) | Reviews the risk register against the project's state and proposes new risks and new assessments, each with its reason; the project lead accepts what fits |

## Before you start

1. **Azure subscription** in which you are **Owner** (the templates create role assignments and private endpoints).
2. **Entra ID**: the role **Application Administrator** or **Cloud Application Administrator**, or an administrator who runs the script with you. The script creates two app registrations and grants consent for the organisation. It needs a **work account**: a personal Microsoft account (outlook.com, hotmail.com, live.com) cannot create the app registrations, not even as administrator of the directory (see below).
3. **Model and quota.** The default is `gpt-5.1` (version `2025-11-13`) as *Standard* deployment in Sweden Central, with 50,000 tokens per minute. Check whether your subscription has it:

   ```bash
   az cognitiveservices model list -l swedencentral -o table --query "[?model.name=='gpt-5.1']"
   az cognitiveservices usage list -l swedencentral -o table
   ```

   10,000 tokens per minute are enough to try it (`MODEL_CAPACITY=10`). If the model is missing or needs a registration, request it in the Azure AI Foundry portal (Management center → Quota), or choose another model (next section).
4. **A shell:** [Azure Cloud Shell](https://shell.azure.com) (Bash) has everything. Elsewhere you need the Azure CLI, `jq`, `git` and `curl`. No Docker: the image is built in the container registry.

### With a personal Microsoft account

A subscription you signed up for with a personal Microsoft account comes with its own directory («Default Directory»), and that account is its administrator. The Bicep extension for Microsoft Graph, which creates the app registrations, does not accept personal accounts, so the script stops at «Entra ID app registrations» with *Authorization_RequestDenied*. Create a work account in that directory once:

1. Azure portal, signed in with the personal account → **Microsoft Entra ID** → Overview: note the **tenant ID** and the **primary domain** (`….onmicrosoft.com`).
2. **Users → New user → Create new user**: user principal name for example `hh-admin@<primary domain>`, display name, note the password. Tab **Assignments → Add role → Global Administrator** (in your own test directory the simplest; *Application Administrator* is enough for the app registrations). Create.
3. **Subscriptions →** your subscription **→ Access control (IAM) → Add role assignment → Privileged administrator roles → Owner →** member: the new user. The default condition (all roles except the privileged administrator roles) is enough. Review + assign.
4. Sign in with the new account: `az logout`, then `az login --tenant <tenant ID>`. The first sign-in asks for a new password and to set up multifactor authentication (Microsoft Authenticator). In Cloud Shell: sign out of the portal, sign in with the new account and open Cloud Shell again.
5. Run `scripts/deploy-azure.sh` again. It continues where it stopped; the infrastructure exists already, so that step is quick.

The script gives the PMO role to the account that runs it, so you sign in to the app with the new account. To sign in with your personal account as well: Enterprise applications → «HERMES Helfer API (test)» → Users and groups → add it with a role.

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
3. **Take the other roles.** In the project: «Beteiligte und Rollen» → «Mich selbst», then for example «Auftraggeber / Projektausschuss», «Informationssicherheit (ISM)» and «Datenschutz». Now you can try every decision on your own. This works only because the test environment turns separation of duties off (`separationOfDuties = false` in `infra/test.bicepparam`; the page says so). In the pilot, the project lead never holds these control roles, the PMO assigns them, and nobody decides their own change request (architecture §6.1, question F37).
4. **Let an agent draft.** Lieferergebnisse → «Kick-off-Roundtable» → «Entwurf erstellen». After 10 to 60 seconds the draft appears as «Entwurf (KI)»; the drawer names the model and shows the Kritiker's hints. Edit it if you like, then «Freigeben».
5. **Word templates.** «Vorlagen» (only for the PMO) → «Projektauftrag» → «Vorlage hochladen» with the .docx. The drawer lists the fields found and who fills each one: «Agent», «HERMES Helfer» (facts of the project) or «Person» (approval, signature, classification). Do this before the first draft of the result: a draft follows the template only if it was written after the upload. In a project in Initialisierung: «Projektauftrag» → «Entwurf erstellen»; the draft has the template's fields as sections. Check and edit it, then «Als Word herunterladen». The ISDS-Konzept works the same in the phase Konzept, with the role «Informationssicherheit (ISM)». An ISDS draft from before the upload follows the template once the ISM sends it back («Zurückweisen») and the agent drafts it again.
6. **Ask the assistant.** «Assistent fragen». Its header shows «KI-Modell … (Sweden Central (regional))»: it understands free text, for example «Was fehlt noch bis zum Gate?» or «Starte Projektgrundlagen».
7. **Change request.** «Change Requests» → «Neuer Change Request». Describe a wish in two sentences, click «Mit dem Agenten ausarbeiten», check the text and the areas, estimate the effort, «Einreichen». Then decide it as Projektausschuss (with Konsent) and, if it touches personal data, confirm the recheck as ISM and Datenschutz. Until then the gate stays closed.
8. **Risks.** «Risiken» → «Risiken prüfen lassen»: the agent names the facts it looked at and proposes risks. Select the ones that fit, adjust them, «Ausgewählte übernehmen». A high risk gives the responsible role a task; open a risk to assess it again or close it.
9. **Status report.** «Statusbericht» → «Neuer Statusbericht»: the app suggests a colour per criterion and says why. Decide the colours, let the agent draft the texts, «Veröffentlichen». As Projektausschuss, take note of it.
10. **Portfolio.** «Portfolio» shows your projects with their signals and status, for example the open change request, a high risk or a red status report.
11. **Invite colleagues.** Entra admin center → Enterprise applications → «HERMES Helfer API (test)» → Users and groups → add people or groups with the role *HH.User* (or *HH.PMO*, *HH.Portfolio*). To give them a role in a project, you need their Entra object ID (Entra admin center → Users → the person → Object ID); a people picker follows later (todo-later E26).

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

  Uploads of templates and downloads of documents leave entries of the types `template_uploaded` and `document_export` in the same log.

## Check the agents with the evaluation set

The evaluation sends fixed, fictional cases to the agents and checks every answer (architecture §5.8): critical rules that must always hold, for example that an instruction hidden in a wish is not followed or that no effort is estimated, and quality checks counted as a rate. The model is reachable only from the app's network, so the evaluation runs in the API's container, with its identity and settings:

```bash
az containerapp exec -g rg-hermes-helfer-test -n ca-hh-test-api --command "node dist/eval/main.js --repeat 3"
```

Nine cases, three times each: about 30 model calls. The report lists every case, the checks that failed and why, the tokens used, and ends with «Ergebnis: bestanden» or the reasons why not. Run it after each change of model, prompt or settings such as `REASONING_EFFORT`, and compare the rates with the run before. With `--case cr-anweisung` it runs a single case.

## When something does not work

| What you see | Likely cause | What to do |
|---|---|---|
| The script stops: «… is not offered as Standard in swedencentral» | The model or version is not available in the region | `MODEL=… MODEL_VERSION=…` or another `LOCATION`; list: `az cognitiveservices model list -l swedencentral -o table` |
| The script stops: «Not enough quota» | Too little quota for the model | `MODEL_CAPACITY=10`, or request more in the Foundry portal |
| The deployment fails with *InsufficientQuota* or a note on registration | The model needs approval or more quota | Request it, or pick another model |
| The script stops at «Entra ID app registrations»: *Authorization_RequestDenied: Insufficient privileges* | A personal Microsoft account, or an account without the Entra role | Personal account: «With a personal Microsoft account» above. Otherwise: Application Administrator, or ask an administrator |
| `az acr build` fails | Some subscription types (free trial, student) cannot use ACR Tasks | The script prints the `docker build` and `docker push` commands; then run it with `SKIP_BUILD=1 TAG=…` |
| Sign-in shows *AADSTS50105* | Your account has no app role | Assign a role (step 11); the script gives it to the person who runs it |
| Drafts fail with «Das KI-Modell ist gerade nicht erreichbar» right after the first deployment | The app's permission on the model takes a few minutes to become effective | Wait 10 minutes and try again; the logs show the status code (401/403) |
| Drafts fail with «… keinen gültigen Entwurf geliefert» | The answer was cut off at the token limit | `REASONING_EFFORT=low`, or raise `AZURE_OPENAI_MAX_COMPLETION_TOKENS` on the container app |
| The assistant answers «aus den festen Regeln» | The chat model call failed | As above; the logs show «chat model failed» |
| «Vorlagen» refuses a file: «keine Felder zu erkennen» | The chapters are not in the style «Überschrift 1», or the labels above the empty paragraphs are not bold | Fix the template in Word and upload it again; every upload is a new version |
| No «Als Word herunterladen» in a result's drawer | No template for this result yet, or the result is confidential for your roles | Upload the template under «Vorlagen»; take a role that may read the result |
| The Word document has empty fields the agent should have filled | The draft was written before the template; the drawer names its sections without a field | Let the agent draft again (for the ISDS-Konzept after «Zurückweisen»), or copy the text in Word |
| The app does not become ready | Database or migration | `az containerapp logs show -g rg-hermes-helfer-test -n ca-hh-test-api --tail 50` |

## Costs and removing it

The test environment costs roughly 80 to 100 USD (or EUR) per month while it exists, mainly for the container that is always on, the database and the private endpoints. The models are billed per token on top; a draft uses a few thousand tokens. Use the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/) for exact figures.

Remove everything:

```bash
ENV_NAME=test scripts/destroy-azure.sh
```

## Not part of the test environment

Front Door with a web application firewall, API Management as AI gateway, Sentinel, Defender plans and deployment from GitHub Actions are planned before go-live (todo-later H03). The steps for the pilot environment, with groups per role and the locked ledger digests, are in [deployment.md](deployment.md).
