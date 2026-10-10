#!/usr/bin/env bash
# Deploys HERMES Helfer into your Azure subscription: infrastructure, Entra ID
# app registrations, container image and database migrations. Everything runs
# with your own Azure CLI sign-in; nothing is stored in this repository.
#
# From the repository root, in Azure Cloud Shell (Bash) or anywhere with the
# Azure CLI, jq, git and curl:
#
#   az login
#   scripts/deploy-azure.sh
#
# Optional settings (environment variables):
#   ENV_NAME=test                     short name, part of every resource name
#   LOCATION=swedencentral            Azure region (EU)
#   RESOURCE_GROUP=rg-hermes-helfer-test
#   PARAMS=infra/test.bicepparam      the pilot uses infra/pilot.bicepparam
#   YES=1                             do not ask before deploying
#   SKIP_BUILD=1 TAG=<tag>            use an image already in the registry
#
# Needs Owner on the subscription (or the resource group) and, in Entra ID,
# Application Administrator or Cloud Application Administrator. Run it again
# to deploy a new version. scripts/destroy-azure.sh removes everything.
set -euo pipefail

ENV_NAME=${ENV_NAME:-test}
LOCATION=${LOCATION:-swedencentral}
RG=${RESOURCE_GROUP:-rg-hermes-helfer-$ENV_NAME}
PARAMS=${PARAMS:-infra/test.bicepparam}
APP="ca-hh-$ENV_NAME-api"

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() {
  printf '\033[31mError:\033[0m %s\n' "$*" >&2
  exit 1
}

cd "$(dirname "$0")/.."
for tool in az jq git curl; do command -v "$tool" >/dev/null || fail "$tool is not installed."; done
az account show >/dev/null 2>&1 || fail "Not signed in to Azure. Run: az login"
[[ "$ENV_NAME" =~ ^[a-z0-9]{2,12}$ ]] || fail "ENV_NAME must be 2 to 12 lowercase letters or digits."

SUBSCRIPTION=$(az account show --query name -o tsv)
USER_ID=$(az ad signed-in-user show --query id -o tsv 2>/dev/null || true)
[ -n "$USER_ID" ] || fail "Sign in as a person (az login), so the script can give you the PMO role."

echo "Subscription:   $SUBSCRIPTION"
echo "Resource group: $RG ($LOCATION)"
echo "Environment:    $ENV_NAME, parameters $PARAMS"
if [ "${YES:-}" != 1 ]; then
  read -r -p "Deploy? [y/N] " answer
  [ "$answer" = y ] || exit 1
fi

step "Azure CLI extension, Bicep and resource providers"
az extension add --name containerapp --upgrade -o none
az bicep upgrade -o none 2>/dev/null || az bicep install -o none
for ns in Microsoft.App Microsoft.ContainerRegistry Microsoft.Sql Microsoft.CognitiveServices \
  Microsoft.OperationalInsights Microsoft.Insights Microsoft.Network Microsoft.Storage Microsoft.ManagedIdentity; do
  az provider register --namespace "$ns" --wait -o none
done

step "Model in $LOCATION"
PARAMS_JSON=$(az bicep build-params --file "$PARAMS" --stdout | jq -r '.parametersJson')
model() { jq -r ".parameters.draftModel.value.$1" <<<"$PARAMS_JSON"; }
MODEL=$(model model)
VERSION=$(model version)
SKU=$(model sku)
CAPACITY=$(model capacity)
offered=$(az cognitiveservices model list -l "$LOCATION" \
  --query "[?model.name=='$MODEL' && model.version=='$VERSION'].model.skus[].name" -o tsv | sort -u)
grep -qx "$SKU" <<<"$offered" ||
  fail "$MODEL ($VERSION) is not offered as $SKU in $LOCATION (offered: ${offered:-none}). Choose another model in $PARAMS; list: az cognitiveservices model list -l $LOCATION -o table"
quota=$(az cognitiveservices usage list -l "$LOCATION" \
  --query "[?name.value=='OpenAI.$SKU.$MODEL'] | [0].[limit, currentValue]" -o tsv 2>/dev/null || true)
echo "$MODEL $VERSION ($SKU) is offered. Quota in thousand tokens per minute (limit, used): ${quota:-unknown}; this deployment needs $CAPACITY."

step "Resource group"
az group create -n "$RG" -l "$LOCATION" --tags application=hermes-helfer environment="$ENV_NAME" -o none

# Deploys main.bicep with the parameter file; extra parameters override it.
# Role assignments can take a few minutes to take effect, so a failure is retried once.
deploy() {
  local name=$1
  shift
  local args=(-g "$RG" -n "hermes-helfer-$name" --parameters "$PARAMS"
    --parameters environmentName="$ENV_NAME" "$@" --query properties.outputs -o json)
  az deployment group create "${args[@]}" || {
    echo "Retrying in 90 seconds (role assignments may not be effective yet) …" >&2
    sleep 90
    az deployment group create "${args[@]}"
  }
}

step "Infrastructure (takes 10 to 20 minutes the first time)"
OUT=$(deploy infra)
APP_URL=$(jq -r '.appUrl.value' <<<"$OUT")
REGISTRY=$(jq -r '.registryName.value' <<<"$OUT")
LOGIN_SERVER=$(jq -r '.registryLoginServer.value' <<<"$OUT")
JOB=$(jq -r '.migrationJobName.value' <<<"$OUT")

step "Entra ID app registrations"
ENTRA=$(az deployment group create -g "$RG" -n hermes-helfer-entra --template-file infra/entra.bicep \
  --parameters environmentName="$ENV_NAME" appUrl="$APP_URL" --query properties.outputs -o json)
API_ID=$(jq -r '.apiClientId.value' <<<"$ENTRA")
WEB_ID=$(jq -r '.webClientId.value' <<<"$ENTRA")
SCOPE=$(jq -r '.apiScope.value' <<<"$ENTRA")

# The PMO role for you, so you can sign in, see all projects and create them.
API_SP=$(az ad sp show --id "$API_ID" --query id -o tsv)
PMO_ROLE=$(az ad sp show --id "$API_ID" --query "appRoles[?value=='HH.PMO'].id | [0]" -o tsv)
if ! assignment=$(az rest --method post \
  --url "https://graph.microsoft.com/v1.0/servicePrincipals/$API_SP/appRoleAssignedTo" \
  --body "{\"principalId\":\"$USER_ID\",\"resourceId\":\"$API_SP\",\"appRoleId\":\"$PMO_ROLE\"}" 2>&1); then
  grep -qi "already exists" <<<"$assignment" || fail "Could not give you the PMO role: $assignment"
fi
echo "You have the role HH.PMO."

if [ "${SKIP_BUILD:-}" = 1 ]; then
  [ -n "${TAG:-}" ] || fail "SKIP_BUILD=1 needs TAG, the tag of an image already in the registry."
  echo "Using the image hermes-helfer:$TAG from the registry."
else
  step "Container image (built in the registry, no local Docker needed)"
  TAG=$(git rev-parse --short HEAD)
  [ -z "$(git status --porcelain)" ] || TAG="$TAG-local$(date +%s)"
  az acr build -r "$REGISTRY" -t "hermes-helfer:$TAG" . -o none ||
    fail "Building the image failed. Without ACR Tasks: az acr login -n $REGISTRY; docker build -t $LOGIN_SERVER/hermes-helfer:$TAG .; docker push $LOGIN_SERVER/hermes-helfer:$TAG; then run this script with SKIP_BUILD=1 TAG=$TAG."
fi

step "App and migration job"
deploy app image="$LOGIN_SERVER/hermes-helfer:$TAG" entraApiClientId="$API_ID" \
  entraWebClientId="$WEB_ID" entraApiScope="$SCOPE" >/dev/null

step "Database migrations"
EXECUTION=$(az containerapp job start -g "$RG" -n "$JOB" --query name -o tsv)
status=Running
for _ in $(seq 1 60); do
  status=$(az containerapp job execution show -g "$RG" -n "$JOB" --job-execution-name "$EXECUTION" \
    --query properties.status -o tsv)
  case "$status" in
    Succeeded) break ;;
    Failed | Stopped | Degraded) fail "The migration job ended with $status. Its logs: Log Analytics, table ContainerAppConsoleLogs, job $JOB." ;;
  esac
  sleep 10
done
[ "$status" = Succeeded ] || fail "The migration job did not finish within 10 minutes."
echo "Migrations applied."

step "Starting the app"
# The app may have started before its database user existed; restart it.
REVISION=$(az containerapp show -g "$RG" -n "$APP" --query properties.latestRevisionName -o tsv)
az containerapp revision restart -g "$RG" -n "$APP" --revision "$REVISION" -o none
ready=no
for _ in $(seq 1 60); do
  if curl -fsS "$APP_URL/api/ready" >/dev/null 2>&1; then
    ready=yes
    break
  fi
  sleep 10
done
[ "$ready" = yes ] || fail "The app is not ready. Its logs: az containerapp logs show -g $RG -n $APP --tail 50"

cat <<EOF

HERMES Helfer is running: $APP_URL

Sign in with your account; you have the PMO role.
1. Create a project ("Neues Vorhaben") and make yourself project lead (PL).
2. Open a deliverable and start a draft: Azure OpenAI ($MODEL) writes it, the Kritiker checks it.
3. Ask the assistant, for example «Was ist als Nächstes?».
Other people need one of the app roles: Entra admin center → Enterprise applications →
"HERMES Helfer API ($ENV_NAME)" → Users and groups.

Logs and telemetry: Application Insights in $RG. Remove everything: ENV_NAME=$ENV_NAME scripts/destroy-azure.sh
EOF
