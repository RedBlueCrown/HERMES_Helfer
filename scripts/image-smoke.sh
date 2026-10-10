#!/usr/bin/env bash
# Smoke test of the container image (used in CI): it serves the web app and
# the API, runs as a non-root user, refuses unsafe production settings, and
# ships the migration job but no web source maps.
#
#   scripts/image-smoke.sh <image>
set -euo pipefail

IMAGE=${1:?usage: image-smoke.sh <image>}
NAME=hh-smoke
URL=http://127.0.0.1:8080

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap 'docker logs "$NAME" 2>&1 | tail -50; cleanup' ERR
trap cleanup EXIT

echo "--- runs as non-root"
user=$(docker inspect --format '{{.Config.User}}' "$IMAGE")
echo "user: ${user}"
[ -n "$user" ] && [ "$user" != "root" ] && [ "$user" != "0" ]

echo "--- refuses the image defaults without production settings"
if docker run --rm "$IMAGE" >/tmp/hh-prod.log 2>&1; then
  echo "expected the API to refuse to start"; exit 1
fi
grep -q "is not allowed with NODE_ENV=production" /tmp/hh-prod.log

echo "--- migration job is in the image"
if docker run --rm "$IMAGE" dist/migrate.js >/tmp/hh-migrate.log 2>&1; then
  echo "expected the migration job to ask for its settings"; exit 1
fi
grep -q "SQL_SERVER" /tmp/hh-migrate.log

echo "--- no web source maps"
docker run --rm --entrypoint node "$IMAGE" -e \
  "const f=require('fs').readdirSync('/app/web/assets'); if (f.some((n)=>n.endsWith('.map'))) process.exit(1); console.log(f.length + ' assets')"

echo "--- serves web app and API (local test settings)"
docker run -d --name "$NAME" -p 8080:8080 \
  -e NODE_ENV=development -e AUTH_MODE=dev -e AI_PROVIDER=mock -e STORE=memory \
  -e SEED_DEMO=true -e LOG_LEVEL=warn "$IMAGE" >/dev/null
for _ in $(seq 1 60); do curl -sf "$URL/api/ready" >/dev/null && break; sleep 0.5; done
curl -sf "$URL/api/ready" | grep -q '"ready"'
curl -sf "$URL/api/config" | grep -q '"authMode":"dev"'

headers=$(curl -sf -D - -o /tmp/hh-index.html "$URL/")
grep -q 'id="root"' /tmp/hh-index.html
echo "$headers" | grep -qi '^content-security-policy:.*default-src .self.'
echo "$headers" | grep -qi '^x-content-type-options: nosniff'
echo "$headers" | grep -qi '^cache-control: no-cache'
curl -sf "$URL/vorhaben/KPO" | grep -q 'id="root"'
[ "$(curl -s -o /dev/null -w '%{http_code}' "$URL/assets/missing.js")" = "404" ]
curl -sf -H "x-dev-user: u-anna" "$URL/api/projects" | grep -q '"code":"KPO"'
echo "image smoke test passed"
