# Working on HERMES Helfer

## Ground rules

- **No real data, no secrets.** Use the fictional demo data. Never commit names, internal system names, contracts, keys or passwords. While the repository is public (question F1), assume everything in it is visible on the internet.
- **People decide, AI drafts.** Never give an agent a tool that releases, approves or decides. Decisions go through the engine's permission checks (`packages/core/src/engine/permissions.ts`).
- **Everything is reviewed.** Changes reach `main` only through a pull request with green CI.

## Set up

Node.js 22.12 or newer (CI and production use 24). Then:

```bash
npm install
npm run dev
```

See the [README](README.md) for the dev users and the optional SQL Server setup.

## Make a change

1. Create a branch from `main`, for example `feature/sharepoint-sites` or `fix/gate-label`.
2. Keep each pull request to one topic. Tests come with the change: engine rules in `packages/core/test`, API behaviour in `apps/api/test`, user flows in `apps/web/e2e`.
3. Run the checks before you push:

   ```bash
   npm run format:check && npm run lint && npm run typecheck && npm test && npm run build
   npm run e2e    # for changes in the web app or the API
   ```

4. Open a pull request. The template asks what changed, how you tested it and what it means for security and data protection.
5. Update the documents in the same pull request:
   - a new error case, placeholder or postponed hardening → [`docs/todo-later.md`](docs/todo-later.md); delete items you resolved;
   - a question for the business side → [`docs/offene-fragen.md`](docs/offene-fragen.md), in German;
   - a design decision → [`docs/target-architecture.md`](docs/target-architecture.md).

## Database changes

Migrations live in `apps/api/src/store/sql/migrations.ts`. Never edit a migration that ran anywhere; add a new one. Keep them expand-only (new tables, columns, indexes), so the previous app version keeps working during a rollout. The SQL tests in CI run against SQL Server 2025.

## Infrastructure changes

Templates are in `infra/`. CI builds and lints them; `infra/bicepconfig.json` turns the important linter rules into errors. Describe in the pull request what changes for an existing environment and update [`docs/deployment.md`](docs/deployment.md).

## Commit messages

A short summary line in the imperative ("Add …", "Fix …"), then a blank line and the why. Mention the todo-later or question number when one applies (for example "E06", "F21").
