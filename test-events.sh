#!/usr/bin/env bash
# End-to-end test for POST /v1/events (SiteWatch agent HMAC auth)
# Works on macOS with LibreSSL and Linux with OpenSSL.
set -euo pipefail

BASE="http://localhost:3000"

# ── 1. Register + login ────────────────────────────────────────────────────────
echo "==> Registering user..."
REG=$(curl -sf -X POST "$BASE/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"agent-test@example.com","password":"Test1234!","orgName":"AgentTestOrg"}')
echo "$REG" | python3 -m json.tool --no-ensure-ascii 2>/dev/null || echo "$REG"

echo ""
echo "==> Logging in..."
LOGIN=$(curl -sf -X POST "$BASE/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"agent-test@example.com","password":"Test1234!"}')
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
echo "Token: ${TOKEN:0:40}..."

# ── 2. Create a site (get pairing code) ───────────────────────────────────────
echo ""
echo "==> Creating site..."
SITE_RESP=$(curl -sf -X POST "$BASE/v1/sites" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"url":"https://example.com","name":"Test Site","checkIntervalSec":300}')
echo "$SITE_RESP" | python3 -m json.tool --no-ensure-ascii 2>/dev/null || echo "$SITE_RESP"

SITE_ID=$(echo "$SITE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['site']['id'])")
PAIRING_CODE=$(echo "$SITE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['pairingCode'])")
echo "Site ID:      $SITE_ID"
echo "Pairing code: $PAIRING_CODE"

# ── 3. Pair (simulate WP plugin activation) ───────────────────────────────────
echo ""
echo "==> Pairing site..."
SITE_KEY="test-site-key-aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"
PAIR_BODY="{\"pairingCode\":\"$PAIRING_CODE\",\"siteUrl\":\"https://example.com\",\"siteKey\":\"$SITE_KEY\"}"
PAIR_RESP=$(curl -sf -X POST "$BASE/v1/sites/pair" \
  -H "Content-Type: application/json" \
  -d "$PAIR_BODY")
echo "$PAIR_RESP" | python3 -m json.tool --no-ensure-ascii 2>/dev/null || echo "$PAIR_RESP"

# ── 4. Send signed events ──────────────────────────────────────────────────────
echo ""
echo "==> Sending HMAC-signed events..."

NOW=$(python3 -c "from datetime import datetime, timezone; print(datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))")
TS=$(python3 -c "import time; print(int(time.time()*1000))")

# Build body with exact whitespace (no extra spaces — we hash what we send)
BODY="{\"site_id\":\"$SITE_ID\",\"events\":[{\"type\":\"user.login\",\"severity_hint\":\"info\",\"occurred_at\":\"$NOW\",\"actor\":{\"id\":1,\"login\":\"admin\"},\"data\":{\"ip\":\"1.2.3.4\"}}]}"

# Compute HMAC — LibreSSL outputs just hex; OpenSSL outputs "HMAC-SHA256(stdin)= <hex>"
# Using python3 for portability across both:
SIG="sha256=$(python3 -c "
import hmac, hashlib, sys
key = '$SITE_KEY'.encode()
msg = ('${TS}.' + '''$BODY''').encode()
print(hmac.new(key, msg, hashlib.sha256).hexdigest())
")"

echo "Timestamp:  $TS"
echo "Signature:  $SIG"
echo "Body:       $BODY"
echo ""

EVENTS_RESP=$(curl -sf -X POST "$BASE/v1/events" \
  -H "Content-Type: application/json" \
  -H "X-SiteWatch-Signature: $SIG" \
  -H "X-SiteWatch-Timestamp: $TS" \
  -H "X-SiteWatch-Site-Id: $SITE_ID" \
  -d "$BODY")
echo "Response:   $EVENTS_RESP"

# ── 5. Verify event was stored ─────────────────────────────────────────────────
echo ""
echo "==> Verifying event stored via dashboard..."
DASH=$(curl -sf -X GET "$BASE/v1/dashboard" \
  -H "Authorization: Bearer $TOKEN")
echo "$DASH" | python3 -m json.tool --no-ensure-ascii 2>/dev/null || echo "$DASH"

echo ""
echo "==> All done."
