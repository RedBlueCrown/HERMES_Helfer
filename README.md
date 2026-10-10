# HERMES Helfer

Leads projects of Firma Muster AG through the HERMES project management method. AI agents draft deliverables and check their quality. People release results and make every decision, and the app records each step in a tamper-evident project record (Projektakte).

Status: **Increment 1** (local vertical slice) is done. **Increment 2** (Azure pilot) is built and tested in CI: event store on Azure SQL with a ledger table, container image, telemetry, Bicep templates and Entra ID registrations. The first deployment to Azure is open ([deployment steps](docs/deployment.md), [roadmap](docs/target-architecture.md#10-increments)). Built ahead of their increments: the portfolio view ([description](docs/target-architecture.md#71-portfolio-view-first-version)) and Change Requests with their agent ([description](docs/target-architecture.md#55-change-requests-first-feature-of-increment-4)).

## Try it locally

You need Node.js 22.12 or newer (production and CI use Node.js 24 LTS).

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. The API runs on port 3001 and the web app proxies to it.

- **Test mode:** you sign in as a fictional person. Switch people in the account menu at the top right. Anna Keller is the project lead in three projects, Peter Graf (PMO) and Rita Vogel (Portfolio-Gremium) see all projects, Marco Bianchi decides as ISM.
- **Demo data:** 5 fictional projects in different phases plus 300 synthetic ones to try the list at scale. They are stored in `apps/api/.data`. `npm run dev:reset` starts fresh.
- **Without an AI model:** drafts are placeholders, and the assistant answers from fixed rules. In Increment 2 Azure OpenAI in the EU takes over (`AI_PROVIDER=azure-openai`, see `apps/api/.env.example`).

### Optional: with SQL Server instead of memory

To try the Azure SQL event store locally, start SQL Server 2025 in Docker and create a database:

```bash
docker run -d --name hh-sql -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD='<your password>' -p 1433:1433 mcr.microsoft.com/mssql/server:2025-latest
docker exec hh-sql /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P '<your password>' -Q "CREATE DATABASE hermes"
```

Then start the API with `STORE=sql SQL_SERVER=localhost SQL_DATABASE=hermes SQL_AUTH=password SQL_USER=sa SQL_PASSWORD=<your password> SQL_TRUST_SERVER_CERTIFICATE=true SQL_MIGRATE_ON_START=true` (see `apps/api/.env.example`). The SQL tests run with `TEST_SQL_SERVER=localhost TEST_SQL_PASSWORD=<your password> npm test -w apps/api`.

### In Azure

`scripts/deploy-azure.sh` sets up a complete test environment in your Azure subscription with one command: Entra ID sign-in, Azure SQL, Azure OpenAI in the EU, with the agents working. See [Trying HERMES Helfer in Azure](docs/staging.md).

## What you can do

1. Open a project and start a draft (for example the Kick-off). The agent writes it, and the Kritiker checks it.
2. Review the draft, edit it, release it as project lead, or decide in the named role (ISM, Projektausschuss …).
3. Record participants. The gate opens once all mandatory results are done and everyone needed was involved.
4. Decide the gate as Auftraggeber or Projektausschuss, with Konsent and Auflagen if needed. The project moves to the next phase.
5. Ask the assistant, for example «Was ist als Nächstes?», «Meine Aufgaben» or «Starte Kick-off».
6. Follow every step in **Verlauf**, and check the hash chain with «Integrität prüfen».
7. Open **Portfolio** as Peter Graf or Rita Vogel: see where projects need attention (open vetoes, overdue Auflagen, gates ready for a decision …), filter by phase and gate, and jump into a project.
8. Open **Change Requests** in a project (for example ERP as Nina Huber): describe a wish, let the agent work it out, see the impact in eight areas; decide it as Thomas Meier (Projektausschuss), recheck it as Marco Bianchi (ISM) and Sandra Roth (Datenschutz).

## Repository layout

| Path            | Content                                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core` | HERMES model (phases, deliverables, skills, rules) and the deterministic engine: status, gates, permissions, tasks, view models. No I/O.                                   |
| `apps/api`      | Fastify API: sign-in (Entra ID or dev users), hash-chained event store (memory or Azure SQL), commands, agent runs, Kritiker, Delivery-Assistent, migration job, telemetry |
| `apps/web`      | React app with Fluent UI, Playwright end-to-end tests                                                                                                                      |
| `infra`         | Bicep templates for Azure (`main.bicep`) and the Entra ID app registrations (`entra.bicep`)                                                                                |
| `docs`          | Architecture, deployment steps, open questions (German), deferred items                                                                                                    |

## Checks

```bash
npm run format:check   # Prettier
npm run typecheck      # TypeScript, all packages
npm test               # unit and API tests (Vitest)
npm run build          # API bundle and web build
npm run e2e            # Playwright: starts API and web, drives Chromium
docker build -t hermes-helfer .   # production image (API, web app, migration job)
```

CI runs all of them on every push (`.github/workflows/ci.yml`), plus the event store tests against SQL Server 2025, a smoke test of the image and the Bicep build and linter.

## Documents

- [Target architecture and agent design](docs/target-architecture.md)
- [Trying HERMES Helfer in Azure](docs/staging.md): one command, then first steps with the agents
- [Deploying the Azure pilot environment](docs/deployment.md)
- [Working on HERMES Helfer](CONTRIBUTING.md): how to propose and review changes
- [Security](SECURITY.md): reporting vulnerabilities
- [Offene Fragen](docs/offene-fragen.md): questions for the business side, in German
- [To do later](docs/todo-later.md): error cases, placeholders and hardening still open
