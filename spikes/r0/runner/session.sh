#!/usr/bin/env bash
# The live part of the R0 spike on the macOS runner, called by
# .github/workflows/r0-spike.yml after the app is installed and launched:
#
#   1. start serve-sim (localhost only, with its own internal token)
#   2. start the gateway (the only thing the tunnel can reach)
#   3. start the Cloudflare quick tunnel and wait until it is reachable
#   4. print ONLY the encrypted session text (URL + token), plus the timing table
#   5. keep the session up for $MINUTES, or until POST /shutdown, then clean up
#
# It always ends on its own (FR-SIM-06/07 spirit): no client needs to connect.
# Nothing here may print the tunnel URL or a token in plain text.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$here/lib.sh"

: "${UDID:?}" "${MINUTES:?}" "${STATE_DIR:?}" "${TIMINGS:?}" "${CLOUDFLARED:?}" "${SERVE_SIM_VERSION:?}"
: "${R0_SPIKE_KEY:?R0_SPIKE_KEY secret is not set}"
GATEWAY_PORT="${GATEWAY_PORT:-8080}"
APP_PROCESS="${APP_PROCESS:-R0Sample}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

GATEWAY_PID=""
TUNNEL_PID=""
TIMINGS_SHOWN="no"

cleanup() {
  local status=$?
  echo "Cleaning up..."
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  [ -n "$GATEWAY_PID" ] && kill "$GATEWAY_PID" 2>/dev/null || true
  npx --yes "serve-sim@${SERVE_SIM_VERSION}" --kill "$UDID" >/dev/null 2>&1 || true
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
  stamp session_end || true
  if [ "$TIMINGS_SHOWN" = "no" ]; then
    echo "--- timings so far"
    node "$here/timings.mjs" "$TIMINGS" || true
  fi
  if [ -f "$STATE_DIR/gateway.log" ]; then
    echo "--- gateway log, last 40 lines (paths only, never tokens)"
    tail -n 40 "$STATE_DIR/gateway.log" | redact
  fi
  exit "$status"
}
trap cleanup EXIT

wait_for_http() { # <url> <seconds> [curl args...]
  local url="$1" limit="$2"
  shift 2
  for _ in $(seq 1 "$limit"); do
    if curl -fsS -o /dev/null --max-time 5 "$@" "$url" 2>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

# --- Tokens: random, masked before anything else can print them -------------
SS_TOKEN="$(openssl rand -hex 32)"
SESSION_TOKEN="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
echo "::add-mask::$SS_TOKEN"
echo "::add-mask::$SESSION_TOKEN"

# --- 1. serve-sim -------------------------------------------------------------
echo "Starting serve-sim ${SERVE_SIM_VERSION} for $UDID..."
if ! SERVE_SIM_AUTH_TOKEN="$SS_TOKEN" npx --yes "serve-sim@${SERVE_SIM_VERSION}" --detach --quiet "$UDID" \
  >"$STATE_DIR/serve-sim.json" 2>"$STATE_DIR/serve-sim.err"; then
  echo "::error::serve-sim failed to start"
  cat "$STATE_DIR/serve-sim.err"
  exit 1
fi
echo "serve-sim state (localhost URLs only):"
cat "$STATE_DIR/serve-sim.json"
echo

# Find the per-device base URL in serve-sim's JSON output, for example
# http://127.0.0.1:3100/helper/<udid>. Fall back to serve-sim's default port.
UPSTREAM_BASE="$(UDID="$UDID" node -e '
  const fs = require("fs");
  const udid = process.env.UDID;
  const text = fs.readFileSync(process.argv[1], "utf8").trim();
  let found;
  const visit = (v) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(visit);
    if (typeof v.streamUrl === "string" && (!v.device || v.device === udid)) found ??= v.streamUrl;
    Object.values(v).forEach(visit);
  };
  for (const chunk of [text, ...text.split("\n")]) {
    try { visit(JSON.parse(chunk)); } catch {}
  }
  process.stdout.write(found ? found.replace(/\/stream\.mjpeg.*$/, "") : `http://127.0.0.1:3100/helper/${udid}`);
' "$STATE_DIR/serve-sim.json")"
echo "serve-sim device routes: $UPSTREAM_BASE"

if ! wait_for_http "$UPSTREAM_BASE/config" 60 -H "Authorization: Bearer $SS_TOKEN"; then
  echo "::error::serve-sim did not answer $UPSTREAM_BASE/config within 60 s"
  cat "$STATE_DIR/serve-sim.err" || true
  exit 1
fi
stamp serve_sim_ready

# --- 2. Gateway ---------------------------------------------------------------
SESSION_TOKEN="$SESSION_TOKEN" UPSTREAM_BASE="$UPSTREAM_BASE" UPSTREAM_TOKEN="$SS_TOKEN" \
  SIM_UDID="$UDID" APP_PROCESS="$APP_PROCESS" SHUTDOWN_FLAG="$STATE_DIR/shutdown" \
  GATEWAY_PORT="$GATEWAY_PORT" \
  node "$here/../gateway/gateway.mjs" >"$STATE_DIR/gateway.log" 2>&1 &
GATEWAY_PID=$!
if ! wait_for_http "http://127.0.0.1:$GATEWAY_PORT/health" 30; then
  echo "::error::the gateway did not start"
  exit 1
fi
stamp gateway_ready

# --- 3. Cloudflare quick tunnel -------------------------------------------------
# Its output goes to a file that is never printed whole: it contains the URL.
"$CLOUDFLARED" tunnel --no-autoupdate --url "http://127.0.0.1:$GATEWAY_PORT" >"$STATE_DIR/cloudflared.log" 2>&1 &
TUNNEL_PID=$!

URL=""
for _ in $(seq 1 90); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$STATE_DIR/cloudflared.log" | head -n 1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done
if [ -z "$URL" ]; then
  echo "::error::cloudflared gave no tunnel URL within 90 s"
  tail -n 30 "$STATE_DIR/cloudflared.log" | redact
  exit 1
fi
echo "::add-mask::$URL"
echo "::add-mask::${URL#https://}"
stamp tunnel_url

# Check the tunnel from the Mac itself. A quick tunnel's name exists in DNS
# only a moment after cloudflared prints it. If the Mac asks its own resolver
# too early, it gets "no such name" and macOS caches that answer, so every
# retry fails for minutes (run 1 failed this way). So: ask Cloudflare's DNS
# (1.1.1.1) directly and connect to that address with curl --resolve, which
# never touches the Mac's resolver cache.
HOST="${URL#https://}"
TUNNEL_CHECK="not confirmed"
for _ in $(seq 1 120); do
  ip="$(dig +short +time=2 +tries=1 @1.1.1.1 "$HOST" A 2>/dev/null | grep -E '^[0-9.]+$' | head -n 1 || true)"
  if [ -n "$ip" ] &&
    curl -fsS -o /dev/null --max-time 5 --resolve "$HOST:443:$ip" "$URL/health" 2>"$STATE_DIR/tunnel-check.err"; then
    TUNNEL_CHECK="reached through 1.1.1.1"
    break
  fi
  sleep 1
done
if [ "$TUNNEL_CHECK" = "not confirmed" ]; then
  # Do not give up: the PC uses its own DNS and may still reach the tunnel.
  # Keep the session up so it can be tried from the PC, and say so clearly.
  echo "::warning::the Mac could not reach its own tunnel within 120 s; keeping the session up so the PC can try"
  echo "Last check error (redacted):"
  redact <"$STATE_DIR/tunnel-check.err" | tail -n 3 || true
  tail -n 30 "$STATE_DIR/cloudflared.log" | redact
else
  stamp tunnel_ready
fi
echo "Tunnel check from the Mac: $TUNNEL_CHECK"
echo "Tunnel connections (protocol and edge location):"
grep -E 'Registered tunnel connection' "$STATE_DIR/cloudflared.log" | redact | head -n 4 || true

# --- 4. Encrypted hand-off + timings -------------------------------------------
BLOB="$(SESSION_URL="$URL" SESSION_TOKEN="$SESSION_TOKEN" node "$here/encrypt-session.mjs")"
echo
echo "=============== ENCRYPTED SESSION: copy the whole next line ==============="
echo "$BLOB"
echo "==========================================================================="
echo "On your PC run:  node spikes/r0/tools/decrypt-url.mjs"
echo

node "$here/timings.mjs" "$TIMINGS" | tee -a "$SUMMARY"
TIMINGS_SHOWN="yes"
{
  echo
  echo "## Encrypted session"
  echo
  echo "Copy this line and decrypt it on your PC with \`node spikes/r0/tools/decrypt-url.mjs\`:"
  echo
  echo '```'
  echo "$BLOB"
  echo '```'
} >>"$SUMMARY"

# --- 5. Keep the session up, then end on our own ------------------------------
deadline=$(($(date +%s) + MINUTES * 60))
reason="time limit of $MINUTES min reached"
exit_code=0
last_note=0
while :; do
  now=$(date +%s)
  if [ "$now" -ge "$deadline" ]; then break; fi
  if [ -f "$STATE_DIR/shutdown" ]; then
    reason="ended from the viewer (POST /shutdown)"
    break
  fi
  if ! kill -0 "$GATEWAY_PID" 2>/dev/null; then
    reason="the gateway stopped unexpectedly"
    exit_code=1
    break
  fi
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    reason="the tunnel stopped unexpectedly"
    exit_code=1
    break
  fi
  if [ $((now - last_note)) -ge 60 ]; then
    echo "Session live: $(((deadline - now + 59) / 60)) min left"
    last_note=$now
  fi
  sleep 5
done

echo "Session ending: $reason"
printf '\n**Session ended:** %s\n' "$reason" >>"$SUMMARY"
exit "$exit_code"
