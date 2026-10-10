# Deploying the Azure pilot environment

How to set up HERMES Helfer in Azure (Increment 2). For the Azure platform team, together with an identity administrator. The templates are in [`infra/`](../infra).

Status: the templates compile and pass the linter in CI. They have **not yet been deployed** to a real subscription; the first deployment is part of Increment 2 (todo-later P07, P08, H03).

## What gets created

Everything is in one resource group in one EU region (default: the resource group's region, proposal Sweden Central, question F3).

| Resource | Purpose | Security settings |
|---|---|---|
| Container Apps environment | Runs the app in its own virtual network | Logs to Log Analytics, encrypted traffic between apps |
| Container app `ca-hh-<env>-api` | API and web app in one container, one instance | Managed identity, HTTPS only, optional IP allowlist, probes on `/api/health` and `/api/ready` |
| Container Apps job `caj-hh-<env>-migrate` | Database migrations, started by hand | Own managed identity, the only database admin |
| Azure SQL Database | Projektakte (events in an append-only ledger table) | Entra ID only, no public access (private endpoint), auditing without statement texts, Defender for SQL, delete lock |
| Storage account | Ledger digests of the database | Immutable container, no shared keys, only the SQL server and private endpoints get in, delete lock |
| Microsoft Foundry (AI Services) | Azure OpenAI model deployments | Entra ID only, no public access, no outbound calls, pinned model versions, default content filter with Prompt Shields |
| Container registry | Images | No admin user, pull with managed identities |
| Log Analytics, Application Insights | Logs, traces, metrics (architecture §9) | No keys: ingestion with managed identities |
| Virtual network, private DNS zones | Private endpoints for SQL, storage and AI | Network security group on the endpoint subnet |
| Two managed identities | `id-…-api` (app), `id-…-migrate` (migration job) | Least privilege: the app may read and append events, nothing more |

Not yet included (todo-later H03): Front Door with WAF, API Management as AI gateway, Sentinel connection, Key Vault (no secrets so far), Defender plans for containers and storage, budget alerts, deployment from GitHub Actions with OIDC.

## Before you start

- **Decisions:** region and processing (F3), model (F4), reachability and IP ranges (F25), groups per role (F26), database admins (F27).
- **Rights:** Owner on the resource group (the templates create role assignments and locks). For step 3 an identity administrator with the role Application Administrator.
- **Tools:** Azure CLI with Bicep (`az bicep install`). No local Docker needed; the image is built in the registry.
- **Model quota:** the model must be offered as *Standard* (regional) in the region, with enough quota:
  `az cognitiveservices model list -l swedencentral -o table`. Adjust `draftModel` and `chatModel` in [`infra/pilot.bicepparam`](../infra/pilot.bicepparam).

## Steps

Example names: environment `pilot`, resource group `rg-hermes-helfer-pilot`.

**1. Resource group**

```bash
az group create -n rg-hermes-helfer-pilot -l swedencentral
```

**2. Infrastructure without the app.** `image` is still empty, so only the environment, database, AI service, registry and monitoring are created.

```bash
az deployment group create -g rg-hermes-helfer-pilot \
  -f infra/main.bicep -p infra/pilot.bicepparam
```

Note the outputs `appUrl` and `registryName`. If the ledger digest upload fails on the first run (the storage role is not effective yet), run the same command again.

**3. App registrations** (identity administrator). Creates the API and web app registrations, the scope `access_as_user`, the four app roles, the organization-wide consent and, if given, the group assignments.

```bash
az deployment group create -g rg-hermes-helfer-pilot -f infra/entra.bicep \
  -p environmentName=pilot appUrl=<appUrl> \
  -p roleGroups='{"HH.User":["<group id>"],"HH.PMO":["<group id>"],"HH.Portfolio":[],"HH.Admin":[]}'
```

Note `apiClientId`, `webClientId` and `apiScope`. Only people in one of these groups get a token for the API ("assignment required").

**4. Image.** Built in the registry from the repository root:

```bash
az acr build -r <registryName> -t hermes-helfer:$(git rev-parse --short HEAD) .
```

**5. App and migration job.**

```bash
az deployment group create -g rg-hermes-helfer-pilot -f infra/main.bicep -p infra/pilot.bicepparam \
  -p image=<registryName>.azurecr.io/hermes-helfer:<tag> \
     entraApiClientId=<apiClientId> entraWebClientId=<webClientId> entraApiScope=<apiScope>
```

The app does not become ready yet: its database user does not exist before step 6.

**6. Migrations.** Creates the tables and the database user of the app with the role `hh_app`.

```bash
az containerapp job start -g rg-hermes-helfer-pilot -n caj-hh-pilot-migrate
az containerapp job execution list -g rg-hermes-helfer-pilot -n caj-hh-pilot-migrate -o table
```

The app connects on its next start; restart it if needed:
`az containerapp revision restart -g rg-hermes-helfer-pilot -n ca-hh-pilot-api --revision <name>`.

**7. Check.**

- `https://<appUrl>/api/ready` answers `{"status":"ready"}`.
- Sign in as a member of the PMO group, create a project, start a draft.
- In Application Insights: requests named by route (`GET /api/projects/:code`), dependencies to SQL and Azure OpenAI, metric `hh.ai_run.duration`.

**8. Conditional Access.** The identity team adds the enterprise application "HERMES Helfer (pilot)" to a policy with MFA and compliant devices.

**9. Lock the ledger digest retention** once the first digests are in the container `sqldbledgerdigests` (after about 30 minutes). Locking cannot be undone; afterwards the retention can only be extended.

```bash
az storage container immutability-policy show -g rg-hermes-helfer-pilot \
  --account-name <digestStorageName> -c sqldbledgerdigests --query etag
az storage container immutability-policy lock -g rg-hermes-helfer-pilot \
  --account-name <digestStorageName> -c sqldbledgerdigests --if-match <etag>
```

## Updating

1. Build the new image (step 4).
2. Deploy with the new `image` (step 5). The new revision gets traffic only once it is ready; until then the old one keeps serving.
3. If the release brings migrations, start the job (step 6). Migrations are expand-only, so the old version keeps working on the new schema during the switch.

**Rollback:** deploy the previous image tag. Never roll back the database schema.

## Operations

- **Logs:** Log Analytics, tables `ContainerAppConsoleLogs` (app logs, including the `ai_run` and `chat` audit entries) and `AppRequests`, `AppDependencies` (telemetry). Find a request by the correlation ID users see in error messages: `AppRequests | where Properties["hh.correlation_id"] == "<id>"`.
- **Database ledger:** a member of the database admin group (F27) checks the ledger against the stored digests:

  ```sql
  DECLARE @locations nvarchar(max) =
    (SELECT * FROM sys.database_ledger_digest_locations FOR JSON AUTO, INCLUDE_NULL_VALUES);
  EXECUTE sys.sp_verify_database_ledger_from_digest_storage @locations;
  ```

  The app's own check («Integrität prüfen») verifies the hash chain of one project; this one verifies the whole database.
- **Scaling:** the app runs as one instance on purpose (agent runs and cache, todo-later H02). Do not raise `maxReplicas` before H02.
