# HERMES Helfer: target architecture and agent design

| | |
|---|---|
| Status | Draft v0.7. Includes the decisions of 2026-10-08 (§1.1), the Increment 2 groundwork, the portfolio view (§7.1), Change Requests with agent A10 (§5.5), the risk register with agent A12 (§5.6) and the status report (§5.7) of 2026-10-10 and 11. |
| Organisation | Firma Muster AG |
| Basis | Clickable prototype v22 (UX and domain specification) |
| Platform | Microsoft Entra ID, SharePoint Online, Microsoft 365, Azure (EU), Microsoft Foundry |
| Open questions | [`offene-fragen.md`](offene-fragen.md) (German) |
| Deferred error cases | [`todo-later.md`](todo-later.md) |

---

## 1. Summary

- **The prototype names about 60 "agents".** It has 42 phase agents, 10 background checks and 8 global or event agents, plus a feedback agent. They fall into four kinds: rule and state logic, document drafting, reviewing and monitoring, and integrations with existing systems. The target is **a deterministic HERMES process engine, 13 AI agents with one skill per deliverable, and connectors**. The UI can keep showing the HERMES-specific names ("Pattern-Pilot", "Go-live-Check"), because those become skills of fewer agents.
- **AI drafts and humans decide, and the code enforces this.** Approving, releasing, passing a gate and marking something as not applicable are not available to agents as tools. The prototype only says so in a prompt ("Entscheide triffst du nie selbst"), which is not enough for production.
- **The Projektakte is the event log.** Every change to a project is an event in an append-only, hash-chained stream per project. The state is computed from those events, so state and audit trail cannot drift apart. That fits the decision that the app is the system of record.
- **Built for 300+ projects** (§7): project roles are managed in the app instead of ~3,000 Entra groups, there is one event stream and one SharePoint site per project, a searchable project list, and a portfolio view with key figures and drill-down into each project (§7.1).
- **Pro-code TypeScript on Azure in the EU, no Power Platform** (§4). AI processing stays in the EU. Claude is currently not available with EU processing in Microsoft Foundry, so the default models are Azure OpenAI deployments in the EU (§4.3).
- **The pilot has the orchestrator plus manually triggered agents** (§5). Every draft also passes the Kritiker. Background agents come later.
- **Logs go into three separate streams:** business audit trail, AI run audit, and security telemetry. Proposed retention periods are in §9.6.
- **The app has to pass its own Pattern-Pilot.** The 12 architecture patterns in the prototype apply to the HERMES Helfer itself. It is also a HERMES project with its own SchuBAn, ISDS-Konzept and DSFA.

### 1.1 Decisions so far

| # | Topic | Decision (2026-10-08) |
|---|---|---|
| D1 | Organisation, scale | Firma Muster AG. More than 300 projects. A cross-project overview with drill-down comes later. |
| D2 | System of record | Yes. Gate, PA and CR decisions and the Projektakte live in the app. Digital decisions with Konsent are legally sufficient. |
| D3 | Data residency | AI processing stays in the EU. |
| D4 | Licences, tools | Microsoft 365 with all features. No Power Platform: apps, flows and dashboards are written as code. |
| D5 | Build approach | Pro-code, chosen by the developer (§4.2). |
| D6 | Users | Internal users only (Entra ID, SharePoint). No external guests. |
| D7 | Pilot scope | Built step by step. The first pilot has the orchestrator and manually triggered agents. |
| D8 | Logging | The developer proposes defaults (§9.6). They need confirmation (questions F21 to F24). |
| D9 | Knowledge sources | The PM-Handbuch, templates and the pattern catalogue exist. Placeholders are used until they are delivered. |

---

## 2. What the prototype contains

| Area | What the prototype does | Where it lives in production |
|---|---|---|
| Identity and roles | Entra sign-in. Groups `SG-PRJ-<CODE>-<ROLE>` map to roles, which map to views (PL/BC, Leitung, Fach, Querschnitt). | Entra ID for sign-in and global roles. Project roles live in the app (§6). |
| Phases and deliverables | 5 phases (Skalierung is an extension), 48 deliverables (pflicht/situativ). Status runs open → Entwurf (KI) → approval/veto → done. A situational deliverable can be marked "nicht zutreffend" with a reason. | Engine |
| Gates and decisions | One gate per phase with a named decider. Outcomes: freigegeben / mit Auflagen / zurückgewiesen. PA decisions need Konsent. Auflagen have an owner and a due date. ISDS and Go-live have a veto. | Engine and decision forms |
| Beteiligung | A Vorhabensprofil with 8 attributes drives rules that make roles mandatory per phase. The gate stays closed until those roles are involved. | Engine (rules) |
| Change Requests | Register with impact in 8 dimensions and a PA decision. A CR that touches data forces a recheck of SchuBAn, ISDS and DSFA. | Built (§5.5): the engine computes the impact, agent A10 drafts, the PA decides with Konsent. Detecting new requirements in meetings comes with A9. |
| Besprechungen | Turns a transcript into decisions, tasks and open questions, and mirrors the result back to the Fachstelle | AI (Protokoll) and Microsoft Graph. Increment 4. |
| Ablage | Indexes several repositories, detects duplicates, offers "Wo finde ich …" and a contact directory | SharePoint, search, AI (Wissen) |
| Systemskizze and Pattern-Pilot | 12 patterns, deviations per project, a versioned sketch | AI (Architektur) and the pattern catalogue |
| Reifegrad | 8 artifacts × 6 maturity levels, with a target per phase | Engine |
| Go-live and Readiness | 7 go-live criteria with a veto for Fachstelle and APM. Access tests that need evidence. | Engine checklists |
| Risks, Statusbericht, Kommunikation | Risk register, HERMES status report with a 6-criterion Ampel, messages per audience | Risk register built (§5.6): the engine scores, agent A12 proposes, the PL accepts. Status report built (§5.7): the engine suggests the Ampel, the PL decides, A2 drafts the texts, the Projektausschuss takes note. Kommunikation: open. |
| Background checks | 10 agents that run on change or on a schedule | Mixed (Appendix A). After the pilot. |
| Delivery-Assistent | Regex intent routing, an LLM fallback over project JSON, a `start_agent` tool, Autopilot | AI orchestrator (§5.4) |
| Verlauf | Activity feed with actor and channel | User-facing view of the event log (§9) |
| Feedback | Interview with AI follow-up questions and voice input | Pilot only |

---

## 3. Design principles

1. **The engine owns the truth and the AI drafts.** Phases, deliverable status, gate state, participation rules, CR impact figures, maturity levels and go-live criteria are deterministic code.
2. **No agent can decide.** Decisions are API operations that need a human user with the right role in that project (§5.2). Agents can only create proposals: drafts, findings, task proposals and risk proposals.
3. **Interactive work runs as the user, and a text follows its readers.** The orchestrator and drafting agents only see what the requesting person may see. Restricted deliverables (SchuBAn, ISDS, DSFA …) never reach the model for roles without access. What an agent writes is read by others too, so a restricted result's content goes into the model's context only when every reader of the text may read it. Change requests, risks and status reports are read by every member: the model learns there only that a restricted result exists and is released, never its content (`readersCover` in `engine/permissions.ts`).
4. **Every AI output carries its provenance:** the sources, the agent and skill version, the model deployment, and the Kritiker findings. It stays "Entwurf (KI)" until a named person releases it. Editing a released result sets it back to Entwurf. The server sets the provenance, never the client: an agent's proposal (change request, risk review, status report texts) is kept on the server with its run, and the person accepts it by naming it; the record then says which agent and model produced it and whether the person changed it.
5. **Decisions name the version they refer to.** A release, an approval or an edit carries the version the person saw. If the content changed in the meantime, the API refuses (409) instead of applying the decision to unseen content. The Projektakte records the version. The same holds for what the engine computed: a change-request decision names the impact the Projektausschuss saw, a status report the suggestion the project lead saw (a short fingerprint of it); if the data moved in between, the API refuses and the page shows the new figures.
6. **HERMES is configuration, not code.** Phases, deliverables, skills, rules and roles are versioned configuration. Each project stores the model version it runs on (§7). Decisions keep their basis in the record: the impact, cost rate and reserve of a change request, who rechecks and which results, the open high risks at a gate. A later change of the configuration therefore never changes a decided fact. Loading an older model version for a running project comes with the first model change (todo-later H12).
7. **Untrusted content is data, never instructions.** That covers emails, transcripts and uploaded documents (§8.2).
8. **Dogfooding.** The HERMES Helfer project runs through HERMES and through the HERMES Helfer.

---

## 4. Reference architecture and stack

```mermaid
flowchart LR
  subgraph Users
    U1["Firma Muster AG staff<br/>PL, PA, Fach, ISM, DS, APM …"]
  end
  subgraph Channels
    WEB["HERMES Helfer web app<br/>React · Fluent UI · also as Teams tab"]
    TEAMS["Teams / M365 Copilot<br/>Delivery-Assistent (later)"]
  end
  subgraph Edge
    FD["Front Door + WAF"]
    APIM["API Management<br/>API + AI gateway"]
  end
  subgraph App["Azure Container Apps · EU region · private VNet"]
    API["HERMES API (TypeScript)<br/>authZ · commands · queries"]
    ENG["Engine @hermes-helfer/core<br/>phases · gates · rules · permissions"]
    RT["Agent runtime<br/>orchestrator · skills · Kritiker"]
  end
  subgraph AI["Microsoft Foundry · EU"]
    MOD["Azure OpenAI deployments<br/>regional EU or EU data zone"]
    CS["Content Safety<br/>Prompt Shields"]
  end
  subgraph Data
    ES[("Azure SQL<br/>event store · ledger table")]
    RM[("Read models<br/>project summaries")]
    SP[("SharePoint Online<br/>one site per Vorhaben")]
    WORM[("Immutable Blob<br/>daily audit export")]
  end
  subgraph Sec["Security & compliance"]
    ENTRA["Entra ID<br/>CA · PIM · app roles · managed identity"]
    PV["Purview<br/>labels · DLP · audit · retention"]
    SENT["Sentinel + Log Analytics"]
    KV["Key Vault"]
  end

  U1 --> WEB & TEAMS
  WEB --> FD --> APIM --> API
  TEAMS --> APIM
  API --> ENG
  API --> RT --> APIM --> MOD
  RT --> CS
  API --> ES --> RM
  ES --> WORM
  RT -- "OBO / managed identity" --> SP
  ENTRA -.-> WEB & API
  PV -.-> SP
  API & APIM & FD -.-> SENT
```

### 4.1 Components

| Layer | Choice | Notes |
|---|---|---|
| UI | React SPA with Fluent UI React v9, later also as a Teams tab | Microsoft's design system, so it looks native in Microsoft 365. Ported from the prototype UX. The prototype code is not reused: it overrides functions several times and builds pages with `innerHTML`. |
| API | Node.js 24 LTS with Fastify | Serves the API and the built web app from one container (same origin, no CORS in production). Distroless image from Microsoft's registry, runs as non-root. Reads its sign-in settings for the browser at runtime, so one image serves every environment. |
| Engine | Pure TypeScript package `@hermes-helfer/core` | No I/O, fully unit-tested, shared by API and UI |
| Persistence | Event store per project on Azure SQL Database: events in an append-only ledger table, one head row per project as the concurrency token. Memory or files for local development and tests. | The ledger table adds platform-level tamper evidence on top of the app's own hash chain: nobody can change or delete events, not even the database owner, and the database digests go to immutable storage. The API reads only new events and checks each against the chain. Schema changes run as a separate migration job with its own identity; the app's identity may only read and append. |
| Read models | Project summaries for the project list and the portfolio view | One summary per project, rebuilt when the project has new events; queried with filters, sorting and paging (§7.1). In memory for now; a SQL table once the API no longer keeps all events (todo-later H16, H19). |
| Documents | SharePoint Online, one site per project (§7) | Increment 3. Until then, drafts are stored in the event store. |
| Identity | Entra ID: MSAL in the SPA, JWT validation with `jose` in the API, managed identities for Azure resources | No secrets in the browser, no API keys for the models |
| AI | Own agent runtime in the API, models via Microsoft Foundry (Azure OpenAI) in the EU | §4.3 and §5 |
| Notifications | Teams activity feed and a daily digest (later) | No Power Automate |
| CI/CD | GitHub Actions: format, typecheck, unit and API tests, the event store against SQL Server, the container image, the Bicep templates, end-to-end tests. Deployment to Azure with OIDC later. | Steps for the first deployment: [`deployment.md`](deployment.md); trying it in your own subscription: [`staging.md`](staging.md) |

### 4.2 Why this stack

| Choice | Reason |
|---|---|
| TypeScript end to end | One language for UI, API and engine. The prototype's domain logic is JavaScript and ports directly. API and UI share the types. |
| Own agent runtime instead of Foundry Agent Service | Every tool call must pass the engine's permission checks and land in the audit trail. Running the tool loop in our API keeps that in one place, testable offline with a mock provider. Foundry Agent Service stays an option for hosted tools such as SharePoint grounding. Microsoft Agent Framework is only available for .NET and Python, and the pilot does not need it. |
| Event sourcing per project | The app is the system of record (D2). With events as the source, the Projektakte is complete by construction, every decision has its context, and the later portfolio view is a read model. |
| No Power Platform | Decision D4. Everything is in Git, reviewed in pull requests and tested in CI. |

### 4.3 Models and EU processing

- **Claude is currently not an option.** In Microsoft Foundry, Claude only offers Global Standard and US Data Zone deployments. It runs on Anthropic-hosted infrastructure, with Anthropic as an independent processor. EU support is announced but has no date. Check again before each increment.
- **Default: Azure OpenAI models in the EU.** There are two variants (question F3):
  - *Regional deployment* in one EU region (for example Sweden Central). Processing stays in that region. This is the strictest option and the recommendation.
  - *Data Zone Standard (EU)*. Processing can happen anywhere within the EU Data Boundary, which according to Microsoft's current documentation can also include EFTA countries such as Norway and Switzerland. It has more capacity.
  - *Global Standard* is not allowed, because it can process data outside the EU.
- **Abuse monitoring.** By default, prompts and completions can be kept for up to 30 days for abuse review. Apply for modified abuse monitoring if that is not acceptable.
- **Route by task.** A small, fast model handles intent and classification, a strong model drafts and critiques. Model versions are pinned, and an upgrade is a release that has to pass the evaluation suite.
- **Pluggable provider.** The runtime talks to a provider interface (`mock`, `azure-openai`). Another provider can be added once it meets D3.

---

## 5. Agents

Thirteen agents. Each has many **skills**, one per deliverable or task (§5.1).

| # | Agent | Covers prototype agents | Trigger | Who decides (engine) | Pilot |
|---|---|---|---|---|---|
| A1 | **Delivery-Assistent** (orchestrator) | Delivery-Assistent, routing part of Framework | Chat | (never decides) | ✓ |
| A2 | **Projektführung & Kommunikation** | Projektgrundlagen, Kick-off, Phasenbericht, Projektabschluss, Kommunikator, Wertnachweis, Referenz | Manual (PL, BC) | PA, Auftraggeber | ✓ skills |
| A3 | **Business-Analyse** | Discovery, Anforderungen, Bewerter, Business-Analyse, Scrum-Setup, Sprint-Planer, Designer | Manual (BC, Fach) | PA (Variantenwahl, agile Entwicklung) | ✓ skills |
| A4 | **Architektur & Technik** | Pattern-Pilot, Architekt, Architekturforum, Technische Koordination, Engineer, Datenmigration, Ausmusterung | Manual (Architektur, Infrastruktur) | Architektur | ✓ skills |
| A5 | **ISDS & Datenschutz** | Datenklassifizierung, Schutzbedarf, Datenschutz, Security Engineering, ISDS, Security-Prüfer | Manual (Fach, ISM, DS) | ISM, Datenschutz (ISDS veto) | ✓ skills |
| A6 | **Recht & Beschaffung** | Legal, Beschaffung | Manual (BC, PL) | PA (Vergabe) | ✓ skills |
| A7 | **Test & Abnahme** | Test-Engineer, User Acceptance, Fachtester, Testpersona, Barrierefreiheit, Go-live-Check | Manual (Test, Fach) | PL, Auftraggeber, Fach and APM (Go-live veto) | ✓ skills |
| A8 | **Einführung & Betrieb** | Betrieb (Light), Einführungsplanung, Handbücher, Einführung, Betrieb, Rollout | Manual (APM, PL) | PA (Betriebsaufnahme) | ✓ skills |
| A9 | **Protokoll** | Protokoll | Manual (any member pastes the notes or a transcript); later the Teams transcript (todo-later H26) | The member who records accepts each item | ✓ |
| A10 | **Change-Request** | Change-Request | Manual (any member), later also new requirements from meetings | PA with Konsent | ✓ |
| A11 | **Kritiker** | Kritiker, Verifier, Reviewer (artifacts) | Every draft | (findings only) | ✓ |
| A12 | **Risiko** | Risk | Manual (PL); later weekly and on events | PL accepts | ✓ |
| A13 | **Wissen** | KnowHow, Lessons Learned, Document, Housekeeping | Questions, phase end | PMO curates | later |

Some prototype agents describe work that people do in other systems: Executer (deployments) and Integrationstest (test runs). In the pilot they are **manual skills**. The responsible person records the result (for example the release version or the test summary) instead of an AI drafting it. Integrations with the pipelines follow later.

### What is not an AI agent

| Prototype agent or feature | Production component |
|---|---|
| Hermesgate, Verifier (checklists), Framework (quality gate) | Engine: gate evaluation and checklist rules |
| Beteiligung rules, Reifegrad, Readiness, Go-live criteria, vetoes | Engine |
| Finanz (reserve), CR impact figures | Engine. A2 or A10 phrase the explanation. |
| Executer, Integrationstest | Manual skills, later integrations with CI/CD and test pipelines |
| Reviewer (pull requests) | Code review in the development platform |
| Document (filing), Housekeeping (duplicates) | SharePoint provisioning and metadata, a scheduled duplicate job |
| Jour Fixe (agent health) | Operations dashboard and weekly digest (§9.5) |
| Autopilot | Later: "Start all ready drafts" with confirmation and a cost cap. It stops at every human decision. |

### 5.1 Skills

Each deliverable becomes a configuration-defined skill. The configuration lives in `packages/core/src/model/`. Example (simplified):

```ts
{
  id: "konzept.test-engineer",
  name: "Test-Engineer",
  agent: "A7",
  mode: "ai-draft",               // or "manual"
  mayStart: ["TEST"],             // the PL may always start
  approvers: [],                  // empty: a Dokument that the PL releases
  outputDoc: "Testkonzept",
}
```

The skill lists the sections the draft must contain. Where the PMO has uploaded the organisation's Word template for a deliverable, the template's fields take their place (§5.9); elsewhere they are placeholders until the templates arrive. The Kritiker first checks the sections deterministically (present, not empty, no open placeholders), then checks the content.

### 5.2 Tools and permissions

| Tool | Kind | Used by |
|---|---|---|
| `projekt_ueberblick`, `naechster_schritt`, `meine_aufgaben`, `gate_status`, `lieferergebnisse`, `ergebnis_details`, `change_requests`, `risiken`, `statusbericht` | Read, filtered by the user's roles. Without a model, the rule-based router also explains skills. | A1 |
| `entwurf_anstossen(skill)` | Request. Runs the same permission and precondition checks as the button in the UI. | A1 |
| Draft generation | Writes a draft for one deliverable | A2 to A8, inside a run started by a person |
| Change request draft | Text and affected areas of a change request; returned to the person, stored only when they submit it, together with the agent's assessment and the Kritiker's findings | A10 |
| Risk review | New risks and new assessments of open ones, each with its reason; returned to the PL, stored only for what they accept | A12 |
| Status report texts | Overview, outlook, problem and measure per yellow or red criterion; returned to the PL, stored when they publish | A2 |
| Critique | Writes findings for a draft | A11 |

**Never available to any agent:** release, approve, decide a gate or a change request, confirm a recheck, record, assess or close a risk, choose the colours of or publish a status report, take note of it, mark "nicht zutreffend", confirm checklist items, record participation, change roles or the profile. The API checks for a human user with the matching project role on each of these operations.

### 5.3 Run lifecycle

```mermaid
stateDiagram-v2
  [*] --> Requested: person clicks or asks the assistant
  Requested --> Refused: role or precondition check fails
  Requested --> Running: ok
  Running --> Failed: error · timeout · restart
  Running --> Draft: draft + Kritiker findings ("Entwurf (KI)")
  Draft --> Draft: human edits (versioned)
  Draft --> AwaitingDecision: deliverable needs an Entscheid (ISM, PA …)
  Draft --> Released: PL releases (Dokument)
  AwaitingDecision --> Released: approved / with Auflagen
  AwaitingDecision --> Requested: rejected → rework
  Released --> Draft: later edit
```

### 5.4 The Delivery-Assistent

- **The LLM understands the request and the engine supplies the facts.** The LLM picks a tool, the engine returns the data, and the LLM phrases the answer. Without a configured model (offline, tests), a deterministic German intent router answers the common questions ("Was ist als Nächstes?", "Meine Aufgaben", "Starte Projektgrundlagen").
- **Context filtered by role on the server.** The prototype sends the whole project to the model, whatever the viewer's role. The production assistant only sees what the person may see.
- **It requests and never executes:** starting a draft goes through the same checks as a button in the UI.

---

### 5.5 Change Requests (first feature of Increment 4)

A change to the agreed scope (HERMES: Änderungsmanagement). Ported from the prototype; the cost rate and the rules are proposals (question F31).

1. **Wish.** A member of the project describes the change in a few sentences. The **Change-Request agent (A10)** turns it into a request with five sections (Ausgangslage, Gewünschte Änderung, Begründung und Nutzen, Betroffene Abläufe und Ergebnisse, Alternativen) and says which areas it touches, each with a reason: personal data, interface, deviation from the standard product, user interface, external users. In doubt it marks personal data as touched. It never estimates effort or cost. The Kritiker checks the text against the project's released results (for example a contradiction with the variant decision). Nothing is stored yet.
2. **Submission.** The person corrects the text and the areas, enters the team's effort estimate in person-days and submits. The Projektakte records the request, marked as drafted by the agent, with the wish as the person wrote it: the form keeps the wish apart from the agent's summary, so a second run of the agent works from the same wish and the record never takes the agent's text for it.
3. **Impact.** The engine computes eight dimensions from the effort and the areas: budget (against the reserve the PL recorded), schedule, architecture, security and data protection, testing, training and communication, operations, acceptance. Each is rated low, medium or high (`engine/change-requests.ts`).
4. **Decision.** The Projektausschuss (role PA) decides with Konsent and a reason: approve, approve with Auflagen, or reject. Auflagen work as elsewhere (owner role, due date). The requester or the PL can withdraw an open request.
5. **Recheck.** An approved request that touches personal data opens a recheck of SchuBAn, Datenschutz-Vorabklärung, ISDS-Konzept and DSFA. ISM and Datenschutz each confirm «keine Anpassung» or «Massnahme ergänzt». Until both have confirmed, the gate of the current phase stays closed (gate criterion «Neuprüfung nach Change Request»).

The Projektausschuss gets a task per open request, ISM and Datenschutz one per pending recheck. The portfolio counts open requests and open rechecks (§7.1), and the assistant answers questions about them.

### 5.6 Risks (second feature of Increment 4)

The risk register of a project (HERMES: Risikomanagement). Ported from the prototype; the scale and the thresholds are proposals (question F33).

1. **Register.** Every member records risks: what could happen, probability («Eintritt») and impact («Auswirkung»), each low, medium or high, the role that takes care of the measure, and the measure. The engine scores probability × impact (1 to 9): from 6 a risk is high, from 3 medium. The register shows a 3 × 3 matrix of the open risks and lists them, the most serious first (`engine/risks.ts`).
2. **Assessment.** The PL or the responsible role assesses a risk again: new values, status «offen», «in Bearbeitung» or «geschlossen», a note. Every assessment stays in the risk's history; the trend compares the score with the one before. Closing and reopening need a reason, «in Bearbeitung» needs a measure.
3. **Risiko agent (A12).** The PL asks the agent to review the register. Every proposal names the fact it rests on; proposals without one are dropped. Text people entered (titles of change requests, Auflagen) reaches the model as a quote next to the fact, never inside it. The engine collects the facts that may point to a risk: a blocked or rejected gate, overdue Auflagen, missing roles or participants, open change requests and rechecks, the reserve, the project profile (supplier, personal data in the cloud, new technology, interfaces, external users, availability, protection needs). Released results count as a fact only when the agent sees their content (§3, principle 3); there is no catch-all «profile» ground, and without any fact the model is not called. The agent proposes at most five new risks and five new assessments, each with the fact behind it; a deterministic check marks proposals similar to an open risk. The PL selects, adjusts and accepts; accepted proposals are recorded as proposed by the agent, with the agent's reason and the fact it rested on, so the record still says why after the proposal has expired. Accepting a new assessment changes its values only: status and responsibility stay as the agent saw them, and changing them is the person's own assessment. Nothing else is stored.
4. **Where risks show.** The responsible role gets a task for a high risk until someone works on the measure. The gate panel names the open high risks, without blocking the gate, and the gate decision records them with its basis (shown with the decision and in the Verlauf). The portfolio flags projects with high risks (§7.1), the assistant answers questions about the register, and the drafting agents get the open risks as background, for example for the section «Risiken» of the Projektgrundlagen.

In the pilot the agent runs when the PL asks; a weekly review in the background follows with the durable queue (todo-later H20).

### 5.7 Status report

The HERMES result «Projektstatusbericht» for the Projektausschuss, as in the prototype; the criteria and the rules are proposals (question F35).

1. **Traffic light.** Six criteria, each green (on track), yellow (measures needed) or red (measures and escalation to the next level): Termine (TER), Kosten (KOS), Personalaufwand (RES), Ergebnisse (ERG), Ziele (ZIEL), Risiken (RIS). The overall status is the worst of them.
2. **Suggestion.** The engine suggests a colour per criterion from the project's data and names the reasons (`engine/status-report.ts`): a rejected or blocked gate, overdue Auflagen, a recheck holding the gate, no activity for 30 days (Termine); change requests over the reserve (Kosten); missing roles or participants (Personalaufwand); a pending veto or a rejected result (Ergebnisse); open change requests (Ziele); high risks, red for hoch/hoch or without a measure (Risiken).
3. **Decision.** The project lead chooses the colours. Yellow and red need a problem and a measure. A colour better than the suggestion needs the project lead's own reason, in a field of its own that the agent never writes. The report records the colour, the suggestion with its reasons, and the project lead's reason, so a deviation and its grounds stay visible. Publishing names the suggestion the project lead saw: if the project's data changed the suggestion in the meantime, the API refuses (409) and the form shows the new one. Optional target and actual figures (budget, spent, progress, planned and forecast end) are entered by hand until portfolio planning delivers them (F11).
4. **Texts.** Agent A2 drafts the overview with the forecast, the outlook, and problem and measure for each yellow or red criterion, from the reasons, the facts, the risk register and the released results. It never chooses or changes a colour and never writes the reason for a better colour; the Kritiker checks the draft. Risk titles people typed reach the model as quotes beside the engine's fact, never inside it (principle 7). Nothing is stored until the project lead publishes; the record says whether the texts are the agent's as drafted or changed by the project lead.
5. **Record.** The published report keeps the facts of the day: phase, mandatory results, the five most serious open risks. The Projektausschuss takes note of it (a task for the role PA), with a remark if needed. A red report stays open for that until someone took note of it, also when a newer report follows; earlier reports that are not red close with the next report.
6. **Where it shows.** The project header and the project list show the latest overall status. The portfolio flags red reports (the latest, or an earlier one nobody took note of), reports better than suggested, and reports that are due (every 30 days, a task for the project lead). The assistant answers questions about the report and the suggestion.

### 5.8 Evaluation of the agents

A model answers differently from one version to the next, and a changed prompt can break a rule nobody looked at. An evaluation set therefore checks the agents with fixed, fictional cases before a new model or a changed prompt goes live (`apps/api/src/eval`, todo-later H11, question F39).

- **Cases.** Each case gives an agent what the API would give it: a wish for a change request (A10), the facts for a risk review (A12), the colours and reasons of a status report (A2), the context of a draft for each drafting agent (A2 to A8), a document for the Kritiker (A11). The Delivery-Assistent (A1) is asked through the API, with the demo projects in memory and the model calling its tools; the drafts it starts are written offline. Three cases hide an instruction in the data, in a wish, a quoted title and a released result (principle 7).
- **Critical checks** must hold every time: personal data is recognised; an instruction hidden in the data is not followed; the agent never estimates effort or cost (a figure passes only if it was in what the agent got); the status report never states another overall colour; every risk proposal rests on a supplied fact; the assistant answers with the model (else the report names the model's error), starts a draft only when asked and neither decides nor claims a decision.
- **Quality checks** are counted as a rate: the template's sections are written, the areas of a change request are recognised and explained, a red criterion names an escalation, the Kritiker finds a contradiction to the variant decision.
- **Runs.** In CI against the offline model, which keeps the cases and checks working, and a test proves that the checks catch a model that follows hidden instructions. On demand against Azure OpenAI, several times per case because the answers vary: `npm run eval -w @hermes-helfer/api -- --provider azure --repeat 3`, or in Azure with `scripts/check-agents.sh`, which starts the job `caj-hh-<env>-eval` in the app's network with the app's identity, since the model is reachable only from there ([staging.md](staging.md)). The assistant's cases need a model with chat and are skipped offline. A run passes when no call failed, no critical check failed and at least 80 % of the quality checks pass.

### 5.9 Word templates and documents

The organisation's Word templates give the drafts their structure, and a result leaves the app as a Word document in the organisation's layout (`apps/api/src/documents`, todo-later P02, questions F40 and F41). The first two are the Projektauftrag and the ISDS-Konzept.

1. **Upload.** The PMO uploads one template per deliverable on the page «Vorlagen» (.docx or .dotx, at most 5 MB). The file is checked before anything is parsed: size and number of parts unpacked (against zip bombs), no macros, no document type definitions in the XML. Every version stays: in Azure SQL in an append-only ledger table (`hh.templates`, migration 2), locally in files. The templates never go into the repository.
2. **Fields.** The template needs no markup; the fields come from its layout. A chapter is a paragraph in «Überschrift 1». A text field is a bold label (or a lower heading) followed by an empty paragraph; a chapter followed directly by an empty paragraph is a field of its own. A cell field is a table row of two cells, a label and an empty cell. Fields before the first chapter belong to the cover («Deckblatt»). The Projektauftrag has 43 fields, the ISDS-Konzept 79.
3. **Who fills a field.** The engine fills in facts it keeps: the project's name and code, the version, status and date of the content, and the people in the project's roles («Projektleitung», «Fachvertretung», «Weitere Rollen und Zuständigkeiten» …). People fill in approvals, signatures and the classification on the document: the chapter «Freigabe», «Unterschrift», «Ort und Datum», «Schutz- bzw. Vertraulichkeitsklasse». The agent drafts everything else: 25 fields of the Projektauftrag, 65 of the ISDS-Konzept. An agent never writes a fact or a signature field. The rules match the labels of these two templates (`documents/facts.ts`); a label they do not know is the agent's, and the PMO sees on «Vorlagen» who fills which field.
4. **Drafting.** The skill that writes the deliverable (its output has the deliverable's name, otherwise the last one) drafts the template's agent fields as its sections, «Kapitel › Feld», in the template's order; table cells get a short value. A skill that writes several deliverables with templates drafts the fields of all of them. The draft records the template versions it follows (`SkillRunCompleted.templates`), and the Kritiker checks the template's sections. Manual results get the same sections.
5. **Document.** Whoever may read the result (need-to-know as for the content, §6) downloads it as a Word document from the result's drawer. The template is filled: facts, the sections of the draft the person may read, and empty fields for people; the layout, styles, headers and footers stay as they are, bullets use the template's list style, and the document properties name the status, the content version and the template version. A draft written before the template fills the fields whose labels match its headings, and the drawer names the sections that have no field. Each download leaves a `document_export` entry in the audit log (who, which result, template and content version, never the content), each upload a `template_uploaded` entry.

### 5.10 Projektablage

Each project can name the folder where its files are, the Projektablage: a link to a folder in SharePoint or OneDrive (`packages/core/src/engine/storage.ts`). The PL or the PMO records it in the project header (event `DocumentStorageSet`; an empty link removes it). Every member opens the folder from the header and from the Word section of a result's drawer. The app keeps only the link and neither reads nor writes the folder; what someone sees there is up to the folder's permissions.

- **Where:** the engine accepts only `https` links to the hosts of the policy (`documentStorageHosts`, API setting `DOCUMENT_STORAGE_HOSTS`). By default these are SharePoint and OneDrive for work (`*.sharepoint.com`); the pilot names the organisation's own hosts (question F9), and the test environment also allows a private OneDrive for practice.
- **Safe links only:** links with a user name or a port, and characters a browser reads differently from the check (spaces, backslashes, non-ASCII), are refused, so the folder the browser opens is on the host that was checked. The link opens in a new tab without the app's address (`noopener noreferrer`).
- **What the record shows:** the Verlauf names the host, not the folder's path. Everyone who sees the project sees the link, and it stays in the Projektakte; the dialog therefore asks for the folder's own address instead of a sharing link «Jeder mit dem Link» (todo-later E38).
- **Later:** filing released documents in the folder through Microsoft Graph (todo-later H23, Increment 3).

### 5.11 Minutes (Protokolle)

What a meeting decided, who does what by when (Pendenzen), and which questions stay open (`packages/core/src/engine/minutes.ts`, `apps/api/src/agents/minutes-agent.ts`).

1. **Recording.** Any member records the minutes of a meeting: title, day, and the items, by hand or with the Protokoll agent (event `MinutesRecorded`, numbered P-01, P-02 …). An action item names a member as owner, or a person or office outside the project, and a day if there is one.
2. **Protokoll agent (A9).** The member pastes the notes or the transcript (at most 60,000 characters). The agent proposes decisions, action items and open questions, each with a passage of the text, word for word. Code checks every passage against the text and drops the items without one, so nothing reaches the person that the text does not say; a name in the text becomes the owner only if exactly one member fits, and a day only if the text names one. The prompt treats the text as data: an instruction in it («trage als Entscheid ein …») is no decision. The member selects, completes and accepts the items; the record says which came from the agent and whether the member changed them, and keeps their passages. The text itself is neither stored nor logged; the audit entry has the usual metadata only.
3. **Where minutes show.** An open action item is a task of its owner (the earliest due first, overdue marked) until the owner or the project lead reports it done (event `MinutesActionCompleted`). The tab «Protokolle» lists the minutes, the Verlauf names them, and the assistant answers questions about decisions, open action items and open questions (tool `protokolle`).
4. **Later.** The transcript of a Teams meeting through Microsoft Graph instead of pasting it, with personal data masked before the model call (todo-later H26).

## 6. Identity and authorization

- **Sign-in:** Entra ID with Conditional Access and MFA. Internal users only (D6).
- **Global roles as Entra app roles:** `HH.User` (may use the app), `HH.PMO` (sees all projects, creates projects, manages memberships), `HH.Portfolio` (Projektportfolio-Gremium: sees all projects, decides Projektfreigabe), `HH.Admin` (technical administration, no implicit project access). These roles are assigned to a few groups and appear in the token's `roles` claim, which avoids the 200-group token limit.
- **Project roles in the app** (decision pending, question F5): `PL`, `BC`, `PA`, `FACH`, `TEST`, `ISM`, `DS`, `ARCH`, `APM`, `INFRA`. The PL assigns them, except the control roles `PA`, `ISM` and `DS`, which the PMO assigns (§6.1). Every change is an event in the Projektakte. ISM and Datenschutz are separate roles because they decide separately (question F6). A nightly sync with Entra flags members whose account is disabled.
- **Restricted deliverables (need-to-know):** Datenklassifizierung, SchuBAn, Datenschutz-Vorabklärung, ISDS-Konzept, DSFA and the security proofs can only be read by PL, PA, ISM, DS and ARCH, plus the roles that contribute to them (for example the Fachstelle, which fills in the SchuBAn). Everyone else sees only their status.
- **Administrators:** PIM elevation with a justification, alerts on elevation, break-glass accounts. The prototype's "als andere Person anmelden" does not exist in production. Local development uses dev users, and the API refuses to start in production with dev sign-in enabled.
- **Agent identities:** a managed identity for the API. SharePoint access with `Sites.Selected`, granted per project site, never tenant-wide.

**Permission matrix (implemented in `packages/core/src/engine/permissions.ts`)**

| Action | Who |
|---|---|
| View a project | Any member, PMO, Portfolio |
| View a restricted deliverable | PL, PA, ISM, DS, ARCH, and roles that may work on it |
| Start a skill | PL, or a role in the skill's `mayStart` |
| Edit a draft | PL, or a role that may start one of the deliverable's skills |
| Release a Dokument | PL |
| Approve an "Entscheid X" | Members holding the pending approver role (not the PL, §6.1) |
| Decide a gate | PA, plus the Portfolio role for Projektfreigabe and Skalierung; never the PL of the project (§6.1) |
| Mark a situational deliverable "nicht zutreffend", reactivate it | PL |
| Record participation, confirm checklist items | PL, or the item's owner role |
| Complete an Auflage | PL, or the Auflage's owner role |
| Submit a change request, record a risk | Any member |
| Decide a change request | PA, not the person who submitted it (§6.1) |
| Confirm the recheck after a change request | ISM and DS, each their part, not the person who submitted the request (§6.1) |
| Assess and close a risk | PL, or the risk's owner role |
| Publish a status report; take note of it | PL; PA |
| Assign and remove roles | PL for the team roles, PMO for all roles (§6.1) |
| Verify the audit chain | PL, PMO |
| Link the Projektablage (§5.10) | PL, PMO |
| Create a project | PMO |

### 6.1 Separation of duties (Funktionentrennung)

The roles that decide, approve or recheck (PA, ISM and DS, the **control roles**) only work as controls when someone other than the person controlled holds them. Without a rule, a project lead could give themselves PA, ISM and Datenschutz, approve their own change request and confirm both rechecks: the Projektakte would show four roles, but one person. The engine therefore applies a policy (`packages/core/src/model/policy.ts`), and the checks in `permissions.ts` enforce it for every command, whatever the client sends:

- **Incompatible roles:** one person never holds PL together with PA, ISM or DS in the same project (open question F37 for further pairs). Assigning such a combination is refused, also to the PMO.
- **Who assigns:** the PMO assigns and removes the control roles; the PL assigns and removes the team roles.
- **Four-eyes principle:** nobody decides or rechecks a change request they submitted. If the only member of the Projektausschuss submits one, the PMO adds a second member who decides.
- **At the moment of the decision:** a control role does not count while the same person also leads the project, even if the combination was assigned before the policy applied. The PL does not decide the gate of their own project, also not through the global role `HH.Portfolio`. Tasks and views follow the same checks, so nobody gets a task they may not do.
- **Vetoes:** the PL never casts a veto, whatever other role they hold: the ISDS-Konzept (ISM) and the Go-live-Check (Fachvertretung and Applikationsmanagement, team roles the PL may otherwise hold) are decided by someone else.
- **Nothing stalls unnoticed:** a role counts as missing when a decision waits for it and no member may take it, either because nobody holds the role or because those who hold it may not decide here: a veto held only by the PL, a recheck of the only Datenschutz member's own change request. The gate panel names the role and what waits for it, the portfolio shows «Rollen fehlen», and the task «Rolle besetzen» goes to whoever may assign the role: the PL for team roles, the PMO for control roles (`missingRoleDetails` in `engine/status.ts`).

The API setting `SEPARATION_OF_DUTIES` switches the policy; it is on by default and in the pilot. Only the test environment turns it off (`infra/test.bicepparam`), so that one person can try every role; the app then says so on the roles page, and only there offers «Mich selbst».

---

## 7. Scaling to 300+ projects

| Topic | What 300+ projects means | Design response |
|---|---|---|
| Roles | 300 projects × 10 roles would mean about 3,000 Entra groups, slow role changes through IT tickets, and tokens over the 200-group limit | Project roles in the app (audited), only four global Entra app roles (§6) |
| Documents | 300+ project sites | Automated provisioning from a site template, a hub site "Vorhaben" for navigation and search, names derived from the project code, read-only and a retention label at closure. Existing sites are linked instead of recreated (question F9). |
| Data | Every record belongs to one project, many users in parallel | One event stream per project with optimistic concurrency, so two people deciding at the same time cannot overwrite each other. Indexed by project. Paging everywhere. |
| Navigation | A drop-down with 300 entries does not work | Searchable project list "Meine Vorhaben" with filters and server-side paging (in Increment 1) |
| Portfolio view | Overview of all projects with drill-down | Built on the project summary read model: phase, gate state, mandatory progress, open decisions, overdue Auflagen, signals that call for action. PMO and Portfolio see everything, members their own projects. First version built (§7.1). |
| Model changes | Projects run for years while the HERMES model changes | Each project stores its model version, and decisions keep their basis. Before the first model change: older versions stay loadable, migration is an explicit, audited PMO action, and a replay check before each deployment fails if a decided fact would change (H12). |
| AI capacity and cost | Many runs around gate dates | Token quotas per project in APIM, queue-based workers that scale out, cost per project in the dashboard |
| Notifications | Approvals across many projects | Teams activity feed and a daily digest instead of one mail per event |
| Audit volume | Millions of events over the years | Partitioning per year, a daily export to WORM storage, and a verification job per project |
| Support | About 300 project leads | In-app help, the assistant, a PMO support channel, training |

### 7.1 Portfolio view (first version)

The page «Portfolio» answers two questions for the PMO and the Portfolio-Gremium: where does a project need attention, and where are the projects in HERMES? A click on a tile or on a number in the phase table filters the list to the projects behind it, and each project opens with one click (drill-down). The filters are part of the address, so a filtered view can be shared, and «back» from a project returns to it.

| Part | Content |
|---|---|
| Handlungsbedarf | One tile per signal (below) with the number of projects. A click filters the list to exactly these projects. |
| Phase and gate | Active projects per phase, split by the state of the phase's gate: open, blocked (veto), ready for the decision. |
| Decisions and Auflagen | Open decisions on results, gates waiting for the Portfolio-Gremium (Projektfreigabe, Skalierungsentscheid), open and overdue Auflagen, finished projects. |
| Project list | Search, filters (phase, gate state, signal), sorting («Dringendste zuerst», last change, name), paging. |

**Signals** (engine, `packages/core/src/engine/portfolio.ts`). The thresholds are proposals (question F29).

| Signal | Rule | Level |
|---|---|---|
| Veto offen | A veto decision on a mandatory result (ISDS, Go-live …) is pending, so the gate is blocked | high |
| Auflagen überfällig | An Auflage is still open after its due date; also in a finished project, for example «1 Woche» from the closing decision | high |
| Gate zurückgewiesen | The last gate decision of the current phase was a rejection | medium |
| Rollen fehlen | A decision of the current phase waits for a role, and no member may take it: nobody holds the role, or those who do may not decide here (§6.1) | medium |
| Hohe Risiken | An open risk scores 6 or more (probability × impact, §5.6) | medium |
| Status rot | The latest status report is red, or a red report has not been taken note of (§5.7) | high |
| Besser als vorgeschlagen | The latest status report judges a criterion better than the engine suggests; the project lead's reason is in the report (§5.7) | medium |
| Statusbericht fällig | No status report for 30 days | info |
| Neuprüfung offen | An approved change request touches personal data; SchuBAn, ISDS and DSFA are checked again and the gate stays closed | medium |
| Ohne Aktivität | No new event in the Projektakte for 30 days | medium |
| Change Request offen | A change request waits for the Projektausschuss | info |
| Gate-Entscheid fällig | All gate criteria are met; the gate waits for its decision | info |

**Due dates of Auflagen** (`engine/conditions.ts`, question F30). A decision «mit Auflagen» names one of three options. «1 Woche» and «2 Wochen» count from the decision. «bis zum nächsten Gate» is due at the gate of the following phase for a gate decision, and at the gate of the same phase for a decision on a result; it is overdue once that gate is passed. The project page shows the date and marks overdue Auflagen.

**Who sees what.** PMO and Portfolio-Gremium see all projects, everyone else the projects in which they hold a role (same rule as the project list). The figures are per project, never per person: there is no evaluation, filter or ranking by project lead (§9.6, question F23).

**How it is computed.** The engine builds one summary per project from its state. The summary depends neither on the viewer nor on the clock, so the API keeps one per project version and rebuilds it only when new events arrive. The viewer's roles and the current time (overdue, inactivity) are applied per request. Measured locally with 300 synthetic projects: about 50 ms for the first request after a start, 2 to 3 ms afterwards. API: `GET /api/portfolio?scope=all|mine` for the key figures, `GET /api/projects` with `gate`, `signal` and `sort` for the list.

**Status report.** The project list shows the overall status of each project's latest status report (§5.7).

**Not yet included:** trends over time, export (Excel), a weekly digest in Teams (F15), budget, dates and resources from portfolio planning (F11).

---

## 8. Security architecture

### 8.1 Controls

| Domain | Controls |
|---|---|
| Network | Front Door with WAF (start in monitoring mode), APIM in front of the API and the models, private endpoints for SQL, Storage, Foundry and Key Vault |
| Identity | Conditional Access (MFA, compliant device), PIM, managed identities, Key Vault, no API keys |
| Data classification | The project's Datenklassifizierung decides which skills and deployments may process which content. Sensitivity labels on SharePoint libraries. Purview DLP. |
| Residency | All Azure resources in an EU region. Models as in §4.3. |
| Records | Decision records exported as PDF to the project site with a Purview record label (Increment 3) |
| Application security | Threat model, dependency and secret scanning in CI, strict CSP, no HTML rendering of model output (the UI renders text only), input validation on every endpoint, rate limits per user, external pentest before go-live |
| Accessibility | WCAG 2.1 AA, using accessible Fluent UI components |

### 8.2 AI-specific threats (OWASP Top 10 for LLM applications)

| Threat | Mitigation |
|---|---|
| Indirect prompt injection (documents, transcripts) | Prompt Shields on retrieved content, untrusted content marked as data in the prompt, no write tools outside the drafts |
| Excessive agency | Tool allowlist per agent, decision operations never exposed, every run started by a person in the pilot |
| Disclosure of sensitive information | Server-side, role-filtered context. Restricted deliverables only for permitted roles. |
| Hallucination | Structured output against the template, mandatory sources (once SharePoint is connected), Kritiker, human release |
| Insecure output handling | Model output is rendered as text, never as HTML, and external links are not loaded automatically. The answer must match a strict JSON schema; text over the API's limits is cut and surplus items dropped rather than the paid call wasted, and drafts are fitted into the template's sections, with a hint where text moved (`apps/api/src/agents/output.ts`). A contract test keeps the schemas sent to Azure and the parsers in step. |
| Unbounded consumption | Rate limits per person and route; at most a few model calls at a time across all agents and fewer per person, with a short wait before the person is told the model is busy (a draft in the background waits longer); a daily token budget per person that also counts calls that failed after the model answered; a call stops when the person closes the request or the drawer; maximum steps per run, timeouts (`apps/api/src/agents/quota.ts`). Calls running at the same time can pass the budget together by at most the person's parallel calls. Later token quotas per project in APIM (H03). |
| Supply chain | Pinned model versions, prompts and skills in Git, evaluation gate before deploying |

---

## 9. Logging, audit and monitoring

### 9.1 Three streams

| Stream | Contents | Store |
|---|---|---|
| **1. Projektakte** | All project events: runs, drafts, edits, releases, approvals with reasons, gate decisions with Konsent and Auflagen, "nicht zutreffend", participation, checklist confirmations, membership changes | Event store with a hash chain (pilot). Later Azure SQL ledger table, daily export to WORM storage, decision PDFs as records. |
| **2. AI run audit** | Per run: who, which skill and version, model deployment, sizes, tokens, duration, outcome, Kritiker findings. Also who uploaded a Word template and who downloaded a result as a document (§5.9) | Structured `ai_run`, `template_uploaded` and `document_export` log entries, and `chat` entries with tools and tokens (to Log Analytics), and the metrics `hh.ai_run.duration` and `hh.ai_run.tokens` in Application Insights via OpenTelemetry, without people or projects. Prompt content later in a separate store (§9.6). |
| **3. Security and platform telemetry** | Entra sign-in and audit logs, Microsoft 365 audit log, Azure activity, APIM, WAF, Key Vault, PIM, Defender | Microsoft Sentinel |

The **Verlauf** page shows stream 1 in plain German, and the integrity check verifies the hash chain on request.

### 9.2 Event example

```json
{
  "projectId": "p-crm",
  "seq": 42,
  "type": "GateDecisionRecorded",
  "data": {
    "phase": "konzept",
    "decision": "mit Auflagen",
    "reason": "…",
    "konsent": true,
    "conditions": [{ "id": "…", "text": "…", "ownerRole": "ISM", "due": "bis zum nächsten Gate" }]
  },
  "actor": { "userId": "<entra oid>", "displayName": "…", "roles": ["PA"], "channel": "web" },
  "at": "2026-10-08T14:03:11.000Z",
  "correlationId": "c-7f3e…",
  "prevHash": "9c1e…",
  "hash": "41ab…"
}
```

### 9.3 Correlation

Every request carries an `x-correlation-id`. It is stored on the events and the `ai_run` log entries. With it you can trace a decision back to the request, the run and the person.

### 9.4 Detection rules (Sentinel, Increment 2 onwards)

1. Prompt Shields detects an attack in a document. Quarantine the document and alert ISM.
2. Someone repeatedly attempts a decision without the matching role (the API blocks it, but the attempts are a signal).
3. Token usage per project deviates strongly from its baseline.
4. PIM elevation followed by a change to the HERMES configuration, the permission model or a content filter.
5. A model deployment is changed or a content filter is disabled.
6. Mass export of a Projektakte.
7. The hash chain fails verification (daily job).
8. The API was started with dev sign-in in a non-local environment (startup guard and alert).

### 9.5 Quality dashboard (replaces "Jour Fixe")

- Per skill: share of drafts released without major edits, edit size, Kritiker findings, time from draft to release
- Per agent: failures, latency, cost
- Per project: time to gate compared with earlier projects
- A weekly digest to the PMO in Teams

### 9.6 Proposed retention and access (answer to question 8, to be confirmed in F21 to F24)

| Data | Retention | Who may read |
|---|---|---|
| Projektakte (decisions, releases, approvals, role changes) | Project lifetime plus 10 years | Project members (own project), PMO, internal audit |
| Draft versions (AI and human) | As the deliverable (project lifetime plus 10 years) | As the deliverable |
| AI run metadata | 2 years | App operations, ISM (pseudonymous: user ID, not name) |
| Prompt and response content | 90 days, encrypted, in a separate store | Only case by case with four-eyes approval (ISM and Datenschutz). Every access is logged. |
| Chat history with the assistant | 90 days | The user. The user can delete it. |
| Security telemetry | 90 days interactive, 1 year total, privileged actions 2 years | SOC, ISM |
| Technical application logs | 30 days | App operations (no content, no tokens) |

Principles:
- **Data minimization.** No prompt content in technical logs, IDs instead of names.
- **Purpose limitation.** Traceability, security and quality, not staff performance. There are no per-person evaluations; the portfolio view counts per project and offers no evaluation by project lead (§7.1).
- **Transparency.** Users are informed, and AI content is labelled.
- **Legal check.** Depending on the location, rules on monitoring employees apply: in Switzerland Art. 26 ArGV 3, in Germany co-determination under §87 (1) no. 6 BetrVG. HR and legal confirm this, and it goes into the app's own DSFA.

---

## 10. Increments

| Increment | Scope | Status |
|---|---|---|
| **1. Local vertical slice** | Monorepo, engine with tests, API with dev sign-in and Entra token validation, event store with hash chain, manual skill runs with Kritiker (mock model), orchestrator chat, web UI: project list (300+), phase view, deliverables, decisions, gate, participation, roles, Verlauf, end-to-end tests | Done |
| 2. Azure pilot environment | Infrastructure as code (Bicep): Container Apps, Azure SQL (ledger), App Insights, private network. Entra app registrations, real sign-in, Azure OpenAI in the EU. Later in this increment: Front Door/WAF, APIM, Sentinel connection. The tool's own SchuBAn, ISDS-Konzept and DSFA. | Built and tested in CI: SQL event store, image, telemetry, templates. Deployment needs F2 to F4 and F25 to F28 |
| 3. SharePoint | Site provisioning or linking per project, drafts as .docx from templates, OBO access, sources in drafts, decision PDFs as records | Needs F9, templates |
| 4. Collaboration | Protokoll (Teams transcripts), Change Requests, Risiko, Wissen, Teams notifications | Change Requests (§5.5) and risks (§5.6) built. Open: Protokoll, Wissen, Teams notifications; they need F11 to F15 |
| 5. Portfolio | Overview of all projects with drill-down, KPIs | First version built (§7.1): signals, phase and gate overview, due dates of Auflagen, filters, drill-down, the status report's traffic light (§5.7). Open: trends, export, Teams digest, data from portfolio planning. Needs F11, F29, F30, F35 |

---

## 11. Open questions

All open questions are in German in [`offene-fragen.md`](offene-fragen.md).

---

## Appendix A: prototype agents mapped to target components

| Target | Prototype agents (42 phase, 10 background, 8 global) |
|---|---|
| A1 Delivery-Assistent | Delivery-Assistent, Framework (routing), Autopilot |
| A2 Projektführung & Kommunikation | Projektgrundlagen, Kick-off, Phasenbericht, Projektabschluss, Kommunikator, Wertnachweis, Referenz, Planner (text), Finanz (text) |
| A3 Business-Analyse | Discovery, Anforderungen, Bewerter, Business-Analyse, Scrum-Setup, Sprint-Planer, Designer |
| A4 Architektur & Technik | Pattern-Pilot, Architekt, Architekturforum, Technische Koordination, Engineer, Datenmigration, Ausmusterung |
| A5 ISDS & Datenschutz | Datenklassifizierung, Schutzbedarf, Datenschutz, Security Engineering, ISDS, Security-Prüfer |
| A6 Recht & Beschaffung | Legal, Beschaffung |
| A7 Test & Abnahme | Test-Engineer, User Acceptance, Fachtester, Testpersona, Barrierefreiheit, Go-live-Check |
| A8 Einführung & Betrieb | Betrieb (Light), Einführungsplanung, Handbücher, Einführung, Betrieb, Rollout, Trainer |
| A9 Protokoll | Protokoll |
| A10 Change-Request | Change-Request |
| A11 Kritiker | Kritiker, Verifier (semantic part), Reviewer (artifact part) |
| A12 Risiko | Risk |
| A13 Wissen | KnowHow, Lessons Learned, Document and Housekeeping (classification) |
| Engine (no AI) | Hermesgate, Verifier (checklists), Framework (quality gate), Finanz (reserve), Beteiligung rules, Reifegrad, Readiness, Go-live criteria and vetoes, CR impact figures |
| Manual skills (pilot), integrations (later) | Executer (release candidate), Integrationstest (test protocol) |
| Integration or platform | Reviewer (pull requests), Planner (resource planning), Document (filing), Housekeeping (duplicate job), Jour Fixe (dashboard) |
| Pilot only | Feedback-Agent |

## Appendix B: event model

Events per project stream (`packages/core/src/engine/events.ts`):

`ProjectCreated`, `MemberRoleAssigned`, `MemberRoleRemoved`, `ProfileUpdated`, `SkillRunRequested`, `SkillRunCompleted`, `SkillRunFailed`, `DraftEdited`, `DeliverableReleased`, `SkillDecisionRecorded`, `DeliverableMarkedNotApplicable`, `DeliverableReactivated`, `ParticipationRecorded`, `ChecklistItemConfirmed`, `GateDecisionRecorded`, `ConditionCompleted`, `ChangeRequestSubmitted`, `ChangeRequestWithdrawn`, `ChangeRequestDecided`, `ChangeRecheckConfirmed`, `ChangeReserveSet`, `RiskRecorded`, `RiskAssessed`, `StatusReportPublished`, `StatusReportAcknowledged`, `MinutesRecorded`, `MinutesActionCompleted`

Every event carries the actor (user ID, name, roles at that moment, channel), the timestamp, the correlation ID and the hash chain (`prevHash`, `hash`). The project state is computed by applying the events in order (`applyEvent`). That function is pure and unit-tested.
