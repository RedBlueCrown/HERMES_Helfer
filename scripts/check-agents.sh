#!/usr/bin/env bash
# Checks the agents of a deployed HERMES Helfer against its model in Azure. The
# evaluation set (docs/staging.md) runs as the job caj-hh-<env>-eval inside the
# app's network, with the app's identity: fixed, fictional cases for every agent,
# the Delivery-Assistent included. It touches no project data and takes about
# five minutes. In Azure Cloud Shell (Bash), from the repository root:
#
#   scripts/check-agents.sh
#
# Optional settings (environment variables), as for scripts/deploy-azure.sh:
#   ENV_NAME=test
#   RESOURCE_GROUP=rg-hermes-helfer-test
set -euo pipefail

ENV_NAME=${ENV_NAME:-test}
RG=${RESOURCE_GROUP:-rg-hermes-helfer-$ENV_NAME}
JOB="caj-hh-$ENV_NAME-eval"

fail() {
  printf '\033[31mError:\033[0m %s\n' "$*" >&2
  exit 1
}

az containerapp job show -g "$RG" -n "$JOB" -o none 2>/dev/null ||
  fail "There is no job $JOB in $RG. Deploy the current version first: git pull, then scripts/deploy-azure.sh"

echo "Checking the agents against the model (about five minutes) …"
EXECUTION=$(az containerapp job start -g "$RG" -n "$JOB" --query name -o tsv)
status=Running
for _ in $(seq 1 120); do
  status=$(az containerapp job execution show -g "$RG" -n "$JOB" --job-execution-name "$EXECUTION" \
    --query properties.status -o tsv)
  case "$status" in
    Succeeded | Failed | Stopped | Degraded) break ;;
  esac
  sleep 10
done

echo
az containerapp job logs show -g "$RG" -n "$JOB" --execution "$EXECUTION" --container eval \
  --tail 300 --format text 2>/dev/null ||
  echo "The report is in the Azure portal: Container App Job $JOB → Execution history → $EXECUTION → Console logs."
echo
case "$status" in
  Succeeded) echo "All agents passed the check." ;;
  Failed) fail "At least one check failed; the report above names it and why." ;;
  *) fail "The check ended with the status $status." ;;
esac
