#!/usr/bin/env bash
# Shared helpers for the R0 spike workflow steps. Source it: `source spikes/r0/runner/lib.sh`.

# stamp <name>: append "<name> <unix ms>" to the timing log ($TIMINGS).
stamp() {
  printf '%s %s\n' "$1" "$(perl -MTime::HiRes=time -e 'printf("%d", time() * 1000)')" >>"${TIMINGS:?TIMINGS is not set}"
}

# redact: hide any quick-tunnel URL in text read from stdin.
redact() {
  sed -E 's#https://[a-z0-9-]+\.trycloudflare\.com#<tunnel-url>#g; s#[a-z0-9-]+\.trycloudflare\.com#<tunnel-host>#g'
}
