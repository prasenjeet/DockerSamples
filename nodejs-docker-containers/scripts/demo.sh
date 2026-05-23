#!/usr/bin/env bash
# =============================================================================
# Demo script — exercises the running stack
# Usage: ./scripts/demo.sh
# =============================================================================
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
METRICS_URL="${METRICS_URL:-http://localhost:9090}"

section() { echo; echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; echo "  $1"; echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; }

section "Health check (main-app)"
curl -sf "$BASE_URL/health" | python3 -m json.tool

section "List notes (seeded by init-db-migrator)"
curl -sf "$BASE_URL/api/notes" | python3 -m json.tool

section "Create a new note"
NOTE=$(curl -sf -X POST "$BASE_URL/api/notes" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Note","content":"Created by demo.sh to show the sidecar log-shipper at work"}')
echo "$NOTE" | python3 -m json.tool
NOTE_ID=$(echo "$NOTE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

section "Fetch the created note"
curl -sf "$BASE_URL/api/notes/$NOTE_ID" | python3 -m json.tool

section "Raw Prometheus metrics from sidecar-metrics-exporter (port 9090)"
curl -sf "$METRICS_URL/metrics"

section "Delete the test note"
curl -sf -X DELETE "$BASE_URL/api/notes/$NOTE_ID" | python3 -m json.tool

section "Open metrics dashboard"
echo "Visit: $METRICS_URL/dashboard"
echo
echo "Demo complete."
