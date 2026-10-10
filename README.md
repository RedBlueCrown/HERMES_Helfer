# HERMES Helfer

Leads projects of Firma Muster AG through the HERMES project management method. AI agents draft deliverables and check their quality. People release results and make every decision, and the app records each step in a tamper-evident project record (Projektakte).

Status: **Increment 1**, a local vertical slice. It runs on your machine with fictional demo data and without an AI model (placeholder drafts). Azure deployment, Entra sign-in and the real model follow in Increment 2 ([roadmap](docs/target-architecture.md#10-increments)).

## Try it locally

You need Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. The API runs on port 3001 and the web app proxies to it.

- **Test mode:** you sign in as a fictional person. Switch people in the account menu at the top right. Anna Keller is the project lead in three projects, Peter Graf (PMO) sees all projects, Marco Bianchi decides as ISM.
- **Demo data:** 5 fictional projects in different phases plus 300 synthetic ones to try the list at scale. They are stored in `apps/api/.data`. `npm run dev:reset` starts fresh.
- **Without an AI model:** drafts are placeholders, and the assistant answers from fixed rules. In Increment 2 Azure OpenAI in the EU takes over (`AI_PROVIDER=azure-openai`, see `apps/api/.env.example`).

## What you can do

1. Open a project and start a draft (for example the Kick-off). The agent writes it, and the Kritiker checks it.
2. Review the draft, edit it, release it as project lead, or decide in the named role (ISM, Projektausschuss …).
3. Record participants. The gate opens once all mandatory results are done and everyone needed was involved.
4. Decide the gate as Auftraggeber or Projektausschuss, with Konsent and Auflagen if needed. The project moves to the next phase.
5. Ask the assistant, for example «Was ist als Nächstes?», «Meine Aufgaben» or «Starte Kick-off».
6. Follow every step in **Verlauf**, and check the hash chain with «Integrität prüfen».

## Repository layout

| Path            | Content                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core` | HERMES model (phases, deliverables, skills, rules) and the deterministic engine: status, gates, permissions, tasks, view models. No I/O. |
| `apps/api`      | Fastify API: sign-in (Entra ID or dev users), hash-chained event store, commands, agent runs, Kritiker, Delivery-Assistent               |
| `apps/web`      | React app with Fluent UI, Playwright end-to-end tests                                                                                    |
| `docs`          | Architecture, open questions (German), deferred items                                                                                    |

## Checks

```bash
npm run format:check   # Prettier
npm run typecheck      # TypeScript, all packages
npm test               # unit and API tests (Vitest)
npm run build          # API bundle and web build
npm run e2e            # Playwright: starts API and web, drives Chromium
```

CI runs all of them on every push (`.github/workflows/ci.yml`).

## Documents

- [Target architecture and agent design](docs/target-architecture.md)
- [Offene Fragen](docs/offene-fragen.md): questions for the business side, in German
- [To do later](docs/todo-later.md): error cases, placeholders and hardening still open
