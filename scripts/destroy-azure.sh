#!/usr/bin/env bash
# Removes an environment created by deploy-azure.sh: the resource group with
# all data, the two Entra ID app registrations, and the deleted AI resource
# (purged, so a new deployment can reuse its name). Asks before deleting.
#
#   ENV_NAME=test scripts/destroy-azure.sh
set -euo pipefail

ENV_NAME=${ENV_NAME:-test}
RG=${RESOURCE_GROUP:-rg-hermes-helfer-$ENV_NAME}

fail() {
  printf '\033[31mError:\033[0m %s\n' "$*" >&2
  exit 1
}

az account show >/dev/null 2>&1 || fail "Not signed in to Azure. Run: az login"
az group show -n "$RG" -o none 2>/dev/null || fail "Resource group $RG not found."

echo "This deletes $RG with all its data, and the app registrations of '$ENV_NAME'."
read -r -p "Type the resource group name to confirm: " answer
[ "$answer" = "$RG" ] || exit 1

# Delete locks (the pilot parameters set them).
for lock in $(az lock list -g "$RG" --query "[].id" -o tsv); do
  az lock delete --ids "$lock"
done

# An unlocked retention policy on the digest container would block deleting the storage.
for account in $(az storage account list -g "$RG" --query "[].name" -o tsv); do
  etag=$(az storage container immutability-policy show -g "$RG" --account-name "$account" \
    -c sqldbledgerdigests --query etag -o tsv 2>/dev/null || true)
  if [ -n "$etag" ]; then
    az storage container immutability-policy delete -g "$RG" --account-name "$account" \
      -c sqldbledgerdigests --if-match "$etag" -o none ||
      fail "The retention policy of $account is locked; the digests can only be deleted after it expires."
  fi
done

ai=$(az cognitiveservices account list -g "$RG" --query "[].[name, location]" -o tsv)

echo "Deleting $RG (takes several minutes) …"
az group delete -n "$RG" --yes

while read -r name location; do
  [ -z "$name" ] || az cognitiveservices account purge -g "$RG" -n "$name" -l "$location"
done <<<"$ai"

for display in "HERMES Helfer API ($ENV_NAME)" "HERMES Helfer ($ENV_NAME)"; do
  for id in $(az ad app list --display-name "$display" --query "[].id" -o tsv); do
    az ad app delete --id "$id"
  done
done

echo "Removed."
