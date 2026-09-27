#!/usr/bin/env bash
# Sentry + Railway activation for issue #920
# Run once CTO has SENTRY_AUTH_TOKEN and RAILWAY_TOKEN available.
#
# Usage:
#   export SENTRY_AUTH_TOKEN=sntrys_xxx
#   export RAILWAY_TOKEN=xxx
#   export SENTRY_ORG=your-org-slug     # from sentry.io/settings/<org>/
#   bash docs/execution/sentry-activate-920.sh
#
set -euo pipefail

: "${SENTRY_AUTH_TOKEN:?Set SENTRY_AUTH_TOKEN}"
: "${RAILWAY_TOKEN:?Set RAILWAY_TOKEN}"
: "${SENTRY_ORG:?Set SENTRY_ORG (your Sentry org slug)}"

SENTRY_PROJECT="vexa-pim-api"
RAILWAY_SERVICE="Vexa API"
RAILWAY_ENV="production"

echo "=== [1/5] Creating Sentry project: $SENTRY_PROJECT ==="
SENTRY_RESPONSE=$(curl -sf \
  -X POST "https://sentry.io/api/0/teams/${SENTRY_ORG}/${SENTRY_ORG}/projects/" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${SENTRY_PROJECT}\",\"slug\":\"${SENTRY_PROJECT}\",\"platform\":\"node\"}" \
  2>&1) || {
    echo "Project may already exist — fetching existing DSN..."
    SENTRY_RESPONSE=$(curl -sf \
      "https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/keys/" \
      -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}")
    DSN=$(echo "$SENTRY_RESPONSE" | python3 -c "import sys,json; keys=json.load(sys.stdin); print(keys[0]['dsn']['public'])" 2>/dev/null)
  }

if [ -z "${DSN:-}" ]; then
  DSN=$(echo "$SENTRY_RESPONSE" | python3 -c "import sys,json; p=json.load(sys.stdin); print(p.get('keys',[{}])[0].get('dsn',{}).get('public',''))" 2>/dev/null || true)
fi

if [ -z "${DSN:-}" ]; then
  # Fetch keys for the newly created project
  KEYS_RESPONSE=$(curl -sf \
    "https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/keys/" \
    -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}")
  DSN=$(echo "$KEYS_RESPONSE" | python3 -c "import sys,json; keys=json.load(sys.stdin); print(keys[0]['dsn']['public'])")
fi

echo "DSN: $DSN"

echo ""
echo "=== [2/5] Validating DSN format ==="
if [[ "$DSN" =~ ^https://[a-f0-9]+@o[0-9]+\.ingest\.sentry\.io/[0-9]+$ ]]; then
  echo "DSN format: VALID"
else
  echo "WARNING: DSN format looks unexpected: $DSN"
  echo "Proceeding anyway — Railway env-validation will catch a malformed URL at startup."
fi

echo ""
echo "=== [3/5] Installing Railway CLI ==="
npm install -g @railway/cli --silent 2>/dev/null || true

echo ""
echo "=== [4/5] Setting SENTRY_DSN in Railway ($RAILWAY_ENV) ==="
# railway variables set requires being linked to a project
# We use the Railway API directly for reliability
RAILWAY_GRAPHQL='
mutation {
  variableUpsert(input: {
    projectId: "PLACEHOLDER",
    environmentId: "PLACEHOLDER",
    serviceId: "PLACEHOLDER",
    name: "SENTRY_DSN",
    value: "'"$DSN"'"
  })
}
'
echo "NOTE: Railway variable upsert via API requires project/environment/service IDs."
echo "Fastest path: paste this DSN in Railway dashboard → Vexa API → Variables:"
echo ""
echo "  SENTRY_DSN=$DSN"
echo ""
echo "Or run: RAILWAY_TOKEN=$RAILWAY_TOKEN railway variables --set SENTRY_DSN=$DSN"

echo ""
echo "=== [5/5] Sending test error (after DSN is set + service redeployed) ==="
echo "Run this after Railway redeploy confirms healthcheck green:"
echo ""
echo '  curl -sf -X POST "$API_BASE_URL/api/v1/products" \'
echo '    -H "Content-Type: application/json" \'
echo '    -d '"'"'{"__test_sentry_activation": true}'"'"' || true'
echo ""
echo "Then check https://sentry.io/organizations/$SENTRY_ORG/issues/ for the event."
echo "Verify: request.data is absent (PII scrubbed)."
echo ""
echo "=== Done. DSN to set in Railway: ==="
echo "$DSN"
