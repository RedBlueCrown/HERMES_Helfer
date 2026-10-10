#!/usr/bin/env bash
# Smoke test of the built bundles against a real SQL Server (used in CI):
# the migration job creates the schema and grants the app user its role, the
# API runs as that least-privileged user, data survives a restart, and the
# hash chain verifies.
#
# Needs: SQL Server reachable on localhost:1433, SA_PASSWORD, and a sqlcmd
# command in SQLCMD (CI runs it inside the service container).
set -euo pipefail

: "${SA_PASSWORD:?}" "${SQLCMD:?}"
DB=hh_smoke
APP_USER=hh_smoke_app
APP_PASSWORD="Aa1!$(openssl rand -hex 16)"
PORT=3001
API="http://127.0.0.1:${PORT}/api"
LOG=$(mktemp)

sqlcmd() { $SQLCMD -C -S localhost -U sa -P "$SA_PASSWORD" -b "$@"; }

echo "--- database and app login"
sqlcmd -Q "CREATE DATABASE ${DB}; ALTER DATABASE ${DB} SET ALLOW_SNAPSHOT_ISOLATION ON; ALTER DATABASE ${DB} SET READ_COMMITTED_SNAPSHOT ON;"
sqlcmd -Q "CREATE LOGIN ${APP_USER} WITH PASSWORD = N'${APP_PASSWORD}', CHECK_POLICY = OFF;"
sqlcmd -d "${DB}" -Q "CREATE USER ${APP_USER} FOR LOGIN ${APP_USER};"

common=(SQL_SERVER=localhost "SQL_DATABASE=${DB}" SQL_AUTH=password SQL_TRUST_SERVER_CERTIFICATE=true)

echo "--- migration job"
env "${common[@]}" SQL_USER=sa "SQL_PASSWORD=${SA_PASSWORD}" "APP_DB_USER=${APP_USER}" \
  node apps/api/dist/migrate.js
# A second run applies nothing and still succeeds.
env "${common[@]}" SQL_USER=sa "SQL_PASSWORD=${SA_PASSWORD}" "APP_DB_USER=${APP_USER}" \
  node apps/api/dist/migrate.js

start_api() {
  env "${common[@]}" "SQL_USER=${APP_USER}" "SQL_PASSWORD=${APP_PASSWORD}" STORE=sql \
    NODE_ENV=development AUTH_MODE=dev AI_PROVIDER=mock MOCK_AI_LATENCY_MS=0 \
    SEED_DEMO=true SEED_SYNTHETIC_PROJECTS=50 LOG_LEVEL=warn "PORT=${PORT}" \
    node apps/api/dist/main.js >>"$LOG" 2>&1 &
  API_PID=$!
  for _ in $(seq 1 120); do
    if curl -sf "${API}/ready" >/dev/null; then return 0; fi
    sleep 0.5
  done
  echo "API did not become ready"; cat "$LOG"; return 1
}
stop_api() { kill "$API_PID"; wait "$API_PID" || true; }
get() { curl -sf -H "x-dev-user: $1" "${API}$2"; }
total() { get u-peter "/projects?scope=all&limit=1" | node -pe 'JSON.parse(require("fs").readFileSync(0)).total'; }

trap 'stop_api 2>/dev/null || true; cat "$LOG"' ERR

echo "--- API as ${APP_USER}"
start_api
first=$(total)
echo "projects: ${first}"
[ "$first" -ge 55 ]
curl -sf -X POST -H "x-dev-user: u-peter" -H "content-type: application/json" \
  -d '{"code":"SMOKE-1","name":"Smoke-Test Vorhaben"}' "${API}/projects" | grep -q '"code":"SMOKE-1"'
get u-anna "/projects/CRM" | grep -q '"code":"CRM"'
curl -sf -X POST -H "x-dev-user: u-anna" -H "content-type: application/json" -d '{}' \
  "${API}/projects/CRM/audit/verify" | grep -q '"ok":true'
stop_api

echo "--- restart: data persists, demo data is not seeded twice"
start_api
second=$(total)
echo "projects after restart: ${second}"
[ "$second" -eq $((first + 1)) ]
get u-peter "/projects?scope=all&q=SMOKE-1" | grep -q '"code":"SMOKE-1"'
stop_api
echo "SQL smoke test passed"
