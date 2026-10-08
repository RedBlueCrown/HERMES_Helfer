# To do later

Things we deliberately postponed: error cases that still need proper handling, placeholders to replace, and hardening. Every item says what the app does **today** and what it **should** do.

When an item is done, delete it here and mention it in the pull request.

Status: Increment 1 (local vertical slice).

---

## 1. Error cases

| ID | Situation | What happens today | What should happen |
|---|---|---|---|
| E01 | **Entra ID sign-in fails** (MSAL error, popup or redirect blocked, Conditional Access denies) | Untested against a real tenant. The web app shows a generic error message. | Friendly error page with "Erneut anmelden", the correlation ID and a support contact. Distinguish "access denied by policy" from technical errors. |
| E02 | **User signs in but has no app role** (`HH.User` missing) | The API answers 403 `no_app_role`. The web app shows a generic error. | Page "Kein Zugriff auf HERMES Helfer" explaining how to request access, and a link to the request process. |
| E03 | **Token expires** during a session, or silent renewal fails | MSAL tries a silent renewal. If that fails, the request fails with 401 and unsaved input in open forms is lost. | Re-authenticate without losing unsaved input (keep form drafts in memory or session storage). |
| E04 | **The project doesn't exist, or the user has no access to it** | The API deliberately answers 404 in both cases, so it reveals nothing. The web app shows "Vorhaben nicht gefunden". | Page "Vorhaben nicht gefunden oder kein Zugriff" with a link back to the list and to the PL or PMO to request a role. |
| E05 | **Role removed while the user is working** | The next action fails with 403. | Refresh permissions automatically and explain why the button disappeared. |
| E06 | **Concurrent change**: two people act on the same project at the same time | The API answers 409 `conflict`. The web app shows a message, but the form content may be lost. | Reload the state automatically, keep the form input, and show what changed. |
| E07 | **An agent run fails** (model error, timeout) | A `SkillRunFailed` event is written with a neutral reason. The skill can be started again, and the reason appears in the deliverable. | Automatic retry with backoff for transient errors, details for administrators, an alert after repeated failures. |
| E08 | **Model rate limit (429) or quota exhausted** | Treated as a failed run (E07). | Queue with `retry-after`, a message such as "Hohe Auslastung, Entwurf folgt", quota per project. |
| E09 | **Content filter or Prompt Shields block** the request or answer | Treated as a failed run, with reason "blockiert". | A specific message for the user, an audit entry, and an ISM alert when it is an attack. |
| E10 | **API restarts while a run is running** | At startup, unfinished runs are closed with `SkillRunFailed` ("Abgebrochen durch Neustart"). | A durable queue (Service Bus) so runs survive restarts, and a watchdog for hanging runs. |
| E11 | **The hash chain of a project fails verification** | At startup the project is not loaded and an error is logged. On demand, "Integrität prüfen" shows the first broken event. | Alert to ISM and SOC, the project switches to read-only, an incident process starts. |
| E12 | **Event store unavailable** (database down) | Not relevant yet (in memory). | 503 with retry, health and readiness probes, an alert. |
| E13 | **A SharePoint site is missing, not provisioned or not accessible** | Not relevant yet (SharePoint comes in Increment 3). | A clear message in the project, a task for the PMO, retry of the provisioning. |
| E14 | **Microsoft Graph throttling** (429/503) | Not relevant yet. | Backoff with `retry-after`, batching, delta queries. |
| E15 | **No member holds a required role** (e.g. nobody is ISM, so ISDS can never be approved) | The approval waits, and the gate panel names the missing role. | A warning on the project page and a task for the PL to assign the role. |
| E16 | **The browser is offline, or the API cannot be reached** | Requests fail and the web app shows an error message. | An offline banner, automatic retry, no data loss in forms. |
| E17 | **Validation errors** (reason too short, Auflage without text …) | The API answers 422 with a German message, which the web app shows above the form. | Messages next to the affected field. |
| E18 | **Dev sign-in is switched on in production** | The API refuses to start (`AUTH_MODE=dev` together with `NODE_ENV=production`). | Also a check in the deployment pipeline, and a Sentinel alert. |
| E19 | **The chat model is unavailable** | The assistant answers with the deterministic intent router and says that free-text answers are unavailable. | Show this state in the chat header, and retry the model later. |
| E20 | **Input too large** (chat message, edited draft) | Rejected with 413 or 422 (limits: chat 2,000 characters, draft 100,000 characters). | A character counter and a clear hint before sending. |
| E21 | **Unsaved edit lost** when the drawer is closed | The text is lost. | Ask before closing, and autosave the draft locally. |
| E22 | **A member leaves the company** (account disabled in Entra) | Their memberships remain. | A nightly sync flags them, and the PL gets a task to reassign roles. |
| E23 | **Clock skew** between Entra and the server | 30 seconds of tolerance when validating tokens. | Monitor time synchronisation in the hosting environment. |
| E24 | **Gate decided while its state changed** (a draft was edited after the form was opened) | The engine checks the gate state again when the decision arrives, so the API answers 409 or 422. | Same as E06: reload and explain. |

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
| P09 | Due dates of Auflagen are free text ("1 Woche", "bis zum nächsten Gate") | Real dates, reminders, and overdue status in the portfolio view |

## 3. Hardening and deferred technology

| ID | Topic | Planned for |
|---|---|---|
| H01 | Azure SQL event store with an append-only ledger table, migrations, daily WORM export | Increment 2 |
| H02 | Durable run queue (Service Bus) and workers (Container Apps jobs) | Increment 2 |
| H03 | Infrastructure as code (Bicep): Container Apps, SQL, Key Vault, Front Door/WAF, APIM, App Insights | Increment 2 |
| H04 | OpenTelemetry to Application Insights, `ai_run` metrics, Sentinel rules (architecture §9.4) | Increment 2 |
| H05 | Separate store for prompt and response content (90 days, four-eyes access) | Increment 2 |
| H06 | Server-side storage and retention of the chat history (today only in the browser tab) | Increment 2 |
| H07 | SharePoint: sites, .docx drafts, OBO access, sources in drafts | Increment 3 |
| H08 | Strict CSP and security headers for the static web app in production | Increment 2 |
| H09 | Accessibility check against WCAG 2.1 AA | Before the pilot goes live |
| H10 | External pentest | Before go-live |
| H11 | Evaluation set per skill, run in CI on every prompt or model change | Once the real model is connected |
| H12 | Pin each project to a HERMES model version, and an audited migration | Before the first model change |
