# SimBridge progress

A plain-words record of what has been done, what is next, and what is waiting
on you. Updated at every stop point. Last update: **17 Nov 2026**.

## Where we are

**Phase R0 (proof of concept), Stage 2 built, waiting for review.**

All the code for the streaming experiment is written and tested on your PC
against a pretend simulator. The next step is the first one that uses a GitHub
Mac: building the iOS app and streaming it. That step waits for you.

| Stage                            | State                                           |
| -------------------------------- | ----------------------------------------------- |
| 0. Read docs, check setup        | Done                                            |
| 1. Repository foundation         | Done, merged (PR #14)                           |
| 2. R0 spike code                 | Done, in review (branch `spike/r0-sim-stream`)  |
| 3. Run on a Mac, measure, decide | Not started: needs the secret and your go-ahead |
| R1 and later                     | Not started (only after R0 passes)              |

## Done so far

### Stage 0: setup (14 Nov 2026)

- Read CLAUDE.md, the SRS and the SDS, and checked the PC: Node 22, npm 10.9,
  git 2.47. GitHub CLI was installed later.
- Found contradictions in the docs and agreed fixes with you, for example how
  the 3-minute gate is measured and how the session token travels.
- Created the git repo and pushed the first commit to `main`.

### Stage 1: repository foundation (merged 17 Nov 2026, PR #14)

- **Workspace:** npm workspaces with strict TypeScript and six empty packages
  (`core`, `backends`, `cli`, `mcp`, `session-agent`, `desktop`).
- **Quality tooling:** ESLint, Prettier and Vitest, plus CI on Linux (free) that
  checks formatting, lint, types and tests on every pull request.
- **Repo docs:** README, CONTRIBUTING, pull request and issue templates, and the
  MIT licence.
- **Decision records:** ADRs 0001 to 0008, one short file per design decision.
- **Doc fixes:**
  - Node 20 everywhere;
  - GitHub App wording, not OAuth;
  - five phases, R0 to R4;
  - `/ws/logs` and `/ws/stats`;
  - the URL is printed only encrypted;
  - the token travels by cookie or first WebSocket message, never in a URL.
- **GitHub tracking:** labels `spike`, `docs`, `infra` and `feature`, milestones
  R0 to R4, and issues #1 to #13.

### Stage 2: R0 spike code (17 Nov 2026, branch `spike/r0-sim-stream`)

- **New requirement: sign in and sign out with GitHub** (FR-SET-08, FR-SET-09,
  ADR 0009, issue #15, built in R1).
  - Sign-in opens the browser at GitHub's page and shows a short code.
  - Sign-out deletes the saved tokens. It also offers to open GitHub's page
    where you can revoke access fully, because the app does not carry the
    secret that GitHub's API needs to revoke a token.
- **serve-sim checked** against its real README and source; the findings are
  in `spikes/r0/README.md`. The biggest finding: its own log channel uses SSE,
  which quick tunnels do not carry, so our gateway serves the logs itself.
- **Sample app** (`spikes/r0/sample-app`): one screen with a big counter
  button, the time of the last tap, and an Animate switch.
- **Gateway** (`spikes/r0/gateway`): the only thing the tunnel can reach.
  - It checks the token and proxies the video and taps to serve-sim.
  - It serves the app's logs over a WebSocket and a small viewer page.
- **Workflow** (`.github/workflows/r0-spike.yml`):
  - builds the app (Release, no Metro), then boots the simulator, installs and
    launches the app, and opens the tunnel;
  - prints the URL only encrypted, plus a timing table with the 3-minute gate;
  - ends by itself.
- **Tools for your PC** (`spikes/r0/tools`):
  - `decrypt-url` shows the viewer link;
  - `measure` measures tap lag, frame rate and the log stream;
  - `dry-run` tests everything locally against a pretend simulator. It passes
    all 19 checks.

## Secrets

| Name           | Value                      | Used by           | State                                                                                  |
| -------------- | -------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| `R0_SPIKE_KEY` | `<dummy: not created yet>` | R0 spike workflow | Placeholder. Create it when you want to run the spike (`spikes/r0/README.md`, step 1). |

No real secret is stored in the repo or in this file. Until `R0_SPIKE_KEY`
exists, the spike workflow stops in its first step, so it can never print the
tunnel URL in plain text.

## Decisions taken for you (17 Nov 2026)

You asked me to make the best choices, so these are now in the decisions log
in CLAUDE.md:

- **Spike packages:**
  - `ws`: the standard WebSocket library, used by the gateway;
  - `jpeg-js`: reads video frames in `measure`. Both are pure JavaScript with
    no further dependencies.
- **Boot the simulator after the build**, not during it, so the 3-minute gate
  measures what an R1 session will really feel like.
- **The workflow reads its own dispatch time** (read-only `actions: read`
  permission), so the timing table also shows the wait for a Mac.
- **Kept the extras:**
  - a viewer page and an "End session now" button;
  - an Animate switch for frame-rate tests;
  - an H.264 data-rate check;
  - the local dry run.
- **serve-sim is pinned to 0.1.49**, because it publishes new versions almost
  daily.

## What is next

1. **You:** review the Stage 2 pull request.
2. **You, when ready:** create `R0_SPIKE_KEY` (step 1 of the runbook).
3. **Me, after your go-ahead:** start the workflow, watch it, fix anything that
   fails (asking before every new run), and guide you through `decrypt-url` and
   `measure`.
4. **Me:** write `docs/spikes/R0-results.md` with the numbers and a go / no-go
   for R1.

## Known issues on your PC

- **Drive C: is full** (about 0.25 GB free). The Expo app could not be
  installed locally. That is fine for the spike, because the Mac builds it, but
  R1 development will need a few GB free. Emptying the Recycle Bin, removing
  old downloads and running Disk Clean-up usually help.
- **npm 10.9 sometimes crashes** with "Cannot read properties of null (reading
  'edgesOut')" when adding a package. Workaround: `npx npm@11 install ...`.
- **Node 20 reached end of life in April 2026.** We keep Node 20 as the minimum
  for now; decide before R1 whether to move to Node 22.
