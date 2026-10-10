# To do later

Things we deliberately postponed: error cases that still need proper handling, placeholders to replace, and hardening. Every item says what the app does **today** and what it **should** do.

When an item is done, delete it here and mention it in the pull request.

Status: Increment 1 (local vertical slice) is done. Increment 2: the SQL event store, the container image, telemetry and the Azure templates are built and tested in CI; the first deployment to Azure is still open.

---

## 1. Error cases

| ID | Situation | What happens today | What should happen |
|---|---|---|---|
| E01 | **Entra ID sign-in fails** (MSAL error, popup or redirect blocked, Conditional Access denies) | Untested against a real tenant. The web app shows a generic error message. | Friendly error page with "Erneut anmelden", the correlation ID and a support contact. Distinguish "access denied by policy" from technical errors. |
| E02 | **User has no app role** | In Azure the API registration requires an assignment, so Entra ID refuses the sign-in (AADSTS50105) and the web app shows the raw sign-in error. Locally, or if assignment is not required, the API answers 403 `no_app_role` and the web app shows "Kein Zugriff auf den HERMES Helfer". | Recognize AADSTS50105 and show "Kein Zugriff – beim PMO beantragen" with a link to the request process, for example an Entra ID access package. |
| E03 | **Token expires** during a session, or silent renewal fails | MSAL tries a silent renewal. If that fails, the request fails with 401 and unsaved input in open forms is lost. | Re-authenticate without losing unsaved input (keep form drafts in memory or session storage). |
| E04 | **The project doesn't exist, or the user has no access to it** | The API deliberately answers 404 in both cases, so it reveals nothing. The web app shows "Vorhaben nicht gefunden oder kein Zugriff", says that the PL or PMO assigns roles, and links back to the list. | A "Rolle anfragen" button that notifies the PL. |
| E05 | **Role removed while the user is working** | The next action fails with 403. | Refresh permissions automatically and explain why the button disappeared. |
| E06 | **Concurrent change**: two people act on the same project at the same time | Commands are serialized per project. Releases, decisions and edits carry the version the person saw; a newer version is refused with 409 `stale`. The web app shows the message and keeps the form open. | Show what changed (side-by-side versions) and offer to re-apply the edit on the new version. |
| E07 | **An agent run fails** (model error, timeout) | A `SkillRunFailed` event is written with a neutral reason. The skill can be started again, and the reason appears in the deliverable. | Automatic retry with backoff for transient errors, details for administrators, an alert after repeated failures. |
| E08 | **Model rate limit (429) or quota exhausted** | Treated as a failed run (E07). | Queue with `retry-after`, a message such as "Hohe Auslastung, Entwurf folgt", quota per project. |
| E09 | **Content filter or Prompt Shields block** the request or answer | Treated as a failed run, with reason "blockiert". | A specific message for the user, an audit entry, and an ISM alert when it is an attack. |
| E10 | **API restarts while a run is running** | At startup, unfinished runs are closed with `SkillRunFailed` ("Abgebrochen durch Neustart"). This assumes one instance, so the app runs with exactly one replica; during a rolling update the new instance may close a run the old one is finishing. | A durable queue (Service Bus) so runs survive restarts, a watchdog for hanging runs, and recovery only of an instance's own runs (H02). |
| E11 | **The hash chain of a project fails verification** | Every event the API reads is checked against the chain. A broken or unreadable project is quarantined: not served (404), writes refused (423), an error is logged. "Integrität prüfen" re-reads the stream and also detects events that disappeared or were replaced. In SQL the ledger table prevents changes in the first place. | Alert to ISM and SOC, the project switches to read-only instead of disappearing, an incident process starts. |
| E12 | **Event store unavailable** (database down, failover, throttling) | Reads are retried three times on transient SQL errors; then the API answers 503 with `retry-after` ("Die Datenbank ist vorübergehend nicht erreichbar"). `/api/ready` fails, so Container Apps stops routing to the instance. Writes are not retried automatically. | An alert on repeated 503s, and a banner in the web app instead of an error per action. |
| E13 | **A SharePoint site is missing, not provisioned or not accessible** | Not relevant yet (SharePoint comes in Increment 3). | A clear message in the project, a task for the PMO, retry of the provisioning. |
| E14 | **Microsoft Graph throttling** (429/503) | Not relevant yet. | Backoff with `retry-after`, batching, delta queries. |
| E15 | **No member holds a required role** (e.g. nobody is ISM, so ISDS can never be approved) | The gate panel names the missing role, and the PL gets the task "Rolle besetzen". | A notification to the PL and the PMO. |
| E16 | **The browser is offline, or the API cannot be reached** | Requests fail and the web app shows an error message. | An offline banner, automatic retry, no data loss in forms. |
| E17 | **Validation errors** (reason too short, Auflage without text …) | The API answers 422 with a German message. The web app shows it in the form and hides it as soon as the input changes. | Messages next to the affected field, checked before sending. |
| E18 | **Dev sign-in is switched on in production** | Entra ID is the default. The API refuses to start with `AUTH_MODE=dev` when `NODE_ENV=production` and whenever it runs in Azure (Container Apps, App Service), whatever `NODE_ENV` says. | Also a check in the deployment pipeline, and a Sentinel alert. |
| E19 | **The chat model is unavailable** | The assistant answers with the deterministic intent router and says that free-text answers are unavailable. | Show this state in the chat header, and retry the model later. |
| E20 | **Input too large** (chat message, edited draft) | Rejected with 413 or 422 (limits: chat 2,000 characters, draft 100,000 characters). | A character counter and a clear hint before sending. |
| E21 | **Unsaved edit lost** when the drawer is closed | The text is lost. | Ask before closing, and autosave the draft locally. |
| E22 | **A member leaves the company** (account disabled in Entra) | Their memberships remain. | A nightly sync flags them, and the PL gets a task to reassign roles. |
| E23 | **Clock skew** between Entra and the server | 30 seconds of tolerance when validating tokens. | Monitor time synchronisation in the hosting environment. |
| E24 | **Gate decided while its state changed** (a draft was edited after the form was opened) | The engine checks the gate state again when the decision arrives, so the API answers 409 or 422. | Same as E06: reload and explain. |
| E25 | **Profile edits while the page refreshes** (e.g. during a running draft the page polls every 1.5 s) | Unsaved changes in the profile form are reset when the project data changes. | Keep the form state until saved or cancelled; show a hint if the profile changed meanwhile. |
| E26 | **Assigning a role needs the person's Entra ID object ID** | The PL types the ID and the name; the API does not check them against the directory. | A people picker using Microsoft Graph (on behalf of the PL) that only offers internal accounts. |
| E27 | **The app starts before the migration job ran** (first deployment, new schema) | The app cannot sign in to the database or finds an older schema; it does not become ready and Container Apps restarts it. The previous revision keeps serving. | Run the job automatically in the deployment pipeline before the new revision starts. |
| E28 | **A model version is retired by Microsoft** | Deployments are pinned (`NoAutoUpgrade`); after the retirement date the calls fail and runs end with "Modell nicht erreichbar". | Watch the retirement schedule, alert 60 days ahead, and plan the upgrade with the evaluation set (H11). |

## 2. Placeholders to replace

| ID | Placeholder | Replace with |
|---|---|---|
| P01 | HERMES model texts (phases, deliverables, skills) ported from prototype v22, neutralized for Firma Muster AG | Review against the PM-Handbuch and the "Szenarien-Ergebnis-Mapping" (question F17) |
| P02 | Template sections per deliverable | The real Word templates (.dotx), question F19 |
| P03 | Kritiker findings of the mock model | Real critique prompts and checklists per deliverable |
| P04 | Demo projects and dev users (all fictional) | Import of the real project list (question F9). Dev users only locally. |
| P05 | Participation catalogue and rules from the prototype | Review by the PMO |
| P06 | German prompts for the assistant and the drafts | Review with the PMO, then an evaluation set per skill |
| P07 | **Azure OpenAI provider**: written against the documented REST API, **not yet tested** against a real EU deployment | Test in Increment 2 (question F2 to F4) |
| P08 | **MSAL sign-in in the web app**: **not yet tested** against a real tenant | Test in Increment 2 with real app registrations |
| P10 | **Azure templates** (`infra/`): compile and pass the linter, **not yet deployed** | First deployment in Increment 2 (docs/deployment.md) |
| P11 | **Model choice** in `infra/pilot.bicepparam` (gpt-5.1, Standard, Sweden Central) is a proposal | Decision F3/F4, then check availability and quota in the region |
| P09 | Due dates of Auflagen are free text ("1 Woche", "bis zum nächsten Gate") | Real dates, reminders, and overdue status in the portfolio view |

## 3. Hardening and deferred technology

| ID | Topic | Planned for |
|---|---|---|
| H01 | Daily export of the Projektakte to WORM storage (the database ledger digests already go to immutable storage) | Before go-live |
| H02 | Durable run queue (Service Bus) and workers (Container Apps jobs) | Increment 2 |
| H03 | Remaining infrastructure: Front Door with WAF, API Management as AI gateway (quotas per project), Key Vault once there are secrets, Defender plans for containers and storage, budget alerts, deployment from GitHub Actions with OIDC (Container Apps, SQL, storage, AI, monitoring, network and Entra ID registrations are done) | Before go-live |
| H04 | Sentinel analytics rules (architecture §9.4); check in Azure that SQL and Azure OpenAI calls appear as dependencies (OpenTelemetry itself is done) | After the first deployment |
| H05 | Separate store for prompt and response content (90 days, four-eyes access) | Increment 2 |
| H06 | Server-side storage and retention of the chat history (today only in the browser tab) | Increment 2 |
| H07 | SharePoint: sites, .docx drafts, OBO access, sources in drafts | Increment 3 |
| H08 | CSP without `'unsafe-inline'` for styles (Fluent UI injects styles at runtime; needs nonce support) | Before go-live |
| H09 | Accessibility check against WCAG 2.1 AA | Before the pilot goes live |
| H10 | External pentest | Before go-live |
| H11 | Evaluation set per skill, run in CI on every prompt or model change | Once the real model is connected |
| H12 | Pin each project to a HERMES model version, and an audited migration | Before the first model change |
| H13 | Split the web bundle (about 1 MB, 270 KB compressed) into vendor chunks | Before the pilot goes live |
| H14 | Pin GitHub Actions to commit SHAs, add ESLint (React hooks, security rules) | Increment 2 |
| H15 | Remove the dev-only console warning "Keyborg instance … disposed incorrectly" (Fluent UI under React StrictMode) | When Fluent UI fixes it, or by updating the focus management setup |
| H16 | The API keeps all events of all projects in memory (about 300 projects fit in 2 GB). Events shrink once drafts move to SharePoint (Increment 3); otherwise evict rarely used projects | Increment 3 |
| H17 | `npm audit` reports `sprintf-js` (GHSA-hp3w-g68c-fv3c, moderate) through `tedious`. Not exploitable here: tedious only passes fixed format strings. No fixed version exists yet | Watch for a tedious release |
