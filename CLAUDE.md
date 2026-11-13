# SimBridge

SimBridge (working name) lets developers and AI agents build, run, test and debug
Flutter and React Native iOS apps from a Windows PC, with no Mac on the desk.
Builds and simulators run on GitHub Actions macOS runners; real-device testing
runs on a USB iPhone; AI agents drive everything through an MCP server.

## Current phase

**R0: proof of concept.** Goal: prove a simulator on a GitHub runner can be
streamed to Windows with usable lag, through a Cloudflare quick tunnel.

- Gate to pass before R1: under 3 min to a usable simulator, under 400 ms median
  tap lag, and the MJPEG stream plus a WebSocket log stream both work through
  the tunnel.
- How the gate is measured: the 3 min runs from simulator boot to tunnel ready
  (boot, install, launch, tunnel). The app build is timed separately, because R1
  sessions start from a saved build. The 95th percentile lag is reported for
  information only.
- The spike prints the tunnel URL and a per-run token only in encrypted form.
- Do NOT build R1 features (CLI, MCP server, desktop app) until the gate passes.
- Update this section whenever the phase changes.

## Source of truth

- `docs/SRS.md`: requirements. Every requirement has an ID (e.g. FR-SIM-06,
  NFR-PERF-02), a priority (Must, Should, Could) and a release (R0 to R4).
- `docs/SDS.md`: design. Components C1 to C13, the `DeviceBackend` interface
  (SDS 3.13), MCP tools (SDS 6.1), workflows (SDS 7), data (SDS 5).
- Before starting any module, read its SDS section and the FR IDs it lists.
- If the code must differ from the docs, update the docs in the same commit
  and say why in the commit message. Never let them drift silently.

## Architecture in one screen

- **Run modes** (all behind one `DeviceBackend` interface, so agent tools never change):
  - Mode A: real iPhone over USB (go-ios + WebDriverAgent), 0 runner minutes. R2.
  - Mode B: cloud simulator on a GitHub macOS runner (serve-sim + tunnel). R1.
  - Mode C: headless Maestro test in a short job. R3.
  - Android emulator on the PC (C13). R4, only if time allows.
- **Smart build:** fingerprint native files; reuse the saved build if unchanged (0 minutes).
- **Session hand-off:** runner posts the encrypted tunnel URL + token as a GitHub
  check run; the client polls for it (job outputs are not readable while a job runs).
- **Tunnel:** Cloudflare quick tunnel only, behind a `TunnelProvider` interface
  (SDS 3.5) so Tailscale can be added later without touching other code.
- **Live streams use WebSockets, never SSE:** quick tunnels do not support
  Server-Sent Events (FR-SIM-13). MJPEG through the tunnel is checked in R0.
- **Session token:** never in a URL. HTTP and the MJPEG stream use a short-lived
  HttpOnly cookie from `POST /auth`; WebSockets (`/ws/logs`, `/ws/stats`) send the
  token as their first message (SDS 6.3, ADR 0008). Only the R0 spike uses `?t=`.
- **Sign-in:** GitHub App with device flow and per-repo access; permission list in SDS 3.1.
  Never request more permissions than that table.
- **Device conditions are required (Must):** network, GPS, push, permissions (SDS 3.11).

## Planned repo layout

```
packages/
  core/            # C1-C4, C9-C12: auth, stack detector, build, sessions, telemetry,
                   #   recorder, conditions, budget
  backends/        # C5 cloud-sim, C6 device, C7 headless, C13 android
  cli/             # `simbridge` commands (SDS 6.2)
  mcp/             # MCP server (SDS 6.1)
  session-agent/   # runs on the macOS runner (SDS 7.2)
  desktop/         # Electron + React UI (built last)
workflows/         # templates copied into user repos: build, session, test
docs/              # SRS.md, SDS.md, adr/ (decision records), prompts/
```

`workflows/` is created in R1, not before.

## Tech stack

- TypeScript 6 (strict), Node.js 20, npm workspaces
- ESLint (typescript-eslint) and Prettier
- Vitest 4 for tests; Playwright for the Electron UI later
- Octokit (GitHub API), official MCP TypeScript SDK, better-sqlite3
- go-ios (device control), serve-sim (simulator stream), Maestro (tests),
  cloudflared (tunnel)

## Commands

Run from the repo root. CI runs the same checks on every pull request.

- Install: `npm install` (CI uses `npm ci`)
- Test: `npm test`
- Lint: `npm run lint`
- Format: `npm run format` to fix, `npm run format:check` to only check
- Typecheck: `npm run typecheck`
- Build all packages: `npm run build`
- Run CLI locally: not yet, the CLI arrives in R1

## How to work in this repo

- **Plan first** for any new module or anything touching more than 2 files.
- **One module at a time.** Small commits; each commit leaves tests passing.
- **Reference requirement IDs** in commit messages, test names and code
  comments where a rule comes from the SRS (e.g. `// FR-SIM-06 idle shutdown`).
- **Write tests with the code**, named after the requirement they prove.
- **Pure logic first, I/O at the edges:** stack detection, fingerprinting,
  budget rules and recording format must be testable without GitHub or a device.
- **Explain changes in simple words** in summaries; the developer is learning.
- Ask before adding a new dependency, a new workflow permission, or anything
  that costs runner minutes.

## Hard rules (never break these)

- **Every runner job must end on its own:** idle timeout + hard cap +
  `timeout-minutes` backstop. A crashed PC must never leave a Mac billing.
- **Standard runners only** (`macos-latest`) unless the user opts in.
- **Never print secrets, tokens or tunnel URLs** in logs, recordings or bug bundles.
- **Secrets:** GitHub tokens and APNs/Firebase keys live in the Windows Credential
  Manager; signing material lives only in GitHub secrets.
- **No inbound ports** on the user's PC; runner connections are outbound tunnels.
- **Never bundle or redistribute Xcode, macOS or the iOS SDK.**
- **Workflows only build and test the repo they live in** (GitHub terms).
- **Network shaping on the runner must exclude the tunnel and GitHub traffic**
  (SDS 3.11), or the session cuts itself off.

## Decisions log

Add one line per decision: date, decision, why.

- 2026-11-13: Session URL hand-off via encrypted check run, not job outputs (outputs unreadable mid-job).
- 2026-11-13: Device conditions are Must; simulator location/push/permissions in R1, network shaping + iPhone in R2.
- 2026-11-13: Android is R4, built only if time allows; runs fully on the PC.
- 2026-11-14: Cloudflare quick tunnel for now, behind a TunnelProvider interface; Tailscale is a later Could (FR-SIM-12 to 15).
- 2026-11-14: WebSockets instead of SSE for logs, stats and control (quick tunnels do not support SSE).
- 2026-11-14: GitHub App (device flow, per-repo) for sign-in, not an OAuth App (FR-SET-01).
- 2026-11-14: Flutter hot reload on the runner is a Should in R3, starting with a timeboxed spike; rebuild is the fallback (FR-SIM-10, SDS 4.9).
- 2026-11-14: R0 gate measured from simulator boot to tunnel ready, build timed separately; tap lag judged on the median, p95 reported (the spike builds in-job, R1 will not).
- 2026-11-14: Session token goes by HttpOnly cookie (HTTP, MJPEG) and first WebSocket message, never in a URL; browsers cannot set an Authorization header on an image stream or a WebSocket (ADR 0008). R0 spike alone uses `?t=`.
- 2026-11-14: WebSocket paths are `/ws/logs` and `/ws/stats` (SDS 6.3).
- 2026-11-14: Node.js 20 is the minimum everywhere; CI pins 20.
- 2026-11-14: TypeScript 6 and Vitest 4, not the newest majors: typescript-eslint does not support TypeScript 7 yet, and Vitest 5 needs Node 22.
- 2026-11-14: Licence is MIT.

## Open items

Known gaps with no action yet. Remove a line when it is resolved.

- **R1 planning, stale JavaScript:** a JS-only change would reuse a saved build
  that still holds the old JavaScript, because the fingerprint covers only native
  files and Metro live reload arrives in R2 (FR-SIM-09). Plan: include JS sources
  in the fingerprint, plus a cheap "re-bundle only" path that rebuilds just the JS
  bundle and swaps it into the saved .app. Revise NFR-COST-01 and SDS 3.3 then.
- **R1, session cookie details:** lifetime, `SameSite` value and WebSocket auth
  timeout (ADR 0008).
- **Node.js version:** Node 20 reached end of life in April 2026 and new tool
  majors (Vitest 5) already need Node 22. Decide before R1 whether to move the
  minimum to Node 22; that would also unlock Vitest 5.
- **npm 10.9 resolver crash:** `npm install <new package>` can fail with
  "Cannot read properties of null (reading 'edgesOut')". Workaround: run that
  one install with `npx npm@11 install ...`. `npm ci` and a plain `npm install`
  from the lockfile work fine on npm 10.
