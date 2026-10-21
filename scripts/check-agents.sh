#!/usr/bin/env bash
# Checks the agents of a deployed HERMES Helfer against its model in Azure. The
# evaluation set (docs/staging.md) runs as the job caj-hh-<env>-eval inside the
# app's network, with the app's identity: fixed, fictional cases for every agent,
# the Delivery-Assistent included. It touches no project data and takes about
# five minutes. In Azure Cloud Shell (Bash), from the repository root:
#
#   scripts/check-agents.sh
#
# Besides the report in the console it saves eval-azure-<time>.json (the
# model's answers) and eval-azure-<time>.html (a page to read, compare and rate
# them) in the current folder: in Cloud Shell, «Manage files» → «Download».
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
LOGS=$(az containerapp job logs show -g "$RG" -n "$JOB" --execution "$EXECUTION" --container eval \
  --tail 300 --format text 2>/dev/null) || LOGS=""
if [ -n "$LOGS" ]; then
  grep -v "EVAL-" <<<"$LOGS" || true
else
  echo "The report is in the Azure portal: Container App Job $JOB → Execution history → $EXECUTION → Console logs."
fi
echo

# The job prints the report file and the page compressed into its log, in lines
# «EVAL-JSON i/n <base64>»; put each file together again.
extract() {
  local parts total
  parts=$(grep -oE "EVAL-$1 [0-9]+/[0-9]+ [A-Za-z0-9+/=]+" <<<"$LOGS" | sort -u | sort -t' ' -k2,2n) || return 1
  total=$(head -n1 <<<"$parts" | cut -d' ' -f2 | cut -d/ -f2)
  [ -n "$total" ] && [ "$(wc -l <<<"$parts")" -eq "$total" ] || return 1
  cut -d' ' -f3 <<<"$parts" | tr -d '\n' | base64 -d | gunzip >"$2"
}
STAMP=$(date -u +%Y%m%d-%H%M)
if [ -n "$LOGS" ] && extract JSON "eval-azure-$STAMP.json" && extract HTML "eval-azure-$STAMP.html"; then
  echo "Saved: eval-azure-$STAMP.html (answers and checks, to read and rate) and eval-azure-$STAMP.json."
  echo "In Cloud Shell: «Manage files» → «Download» → $(pwd)/eval-azure-$STAMP.html"
else
  rm -f "eval-azure-$STAMP.json" "eval-azure-$STAMP.html"
  echo "The answers could not be saved as files (the log was incomplete); the report above is complete."
fi
echo
case "$status" in
  Succeeded) echo "All agents passed the check." ;;
  Failed) fail "At least one check failed; the report above names it and why." ;;
  *) fail "The check ended with the status $status." ;;
esac
