# SimBridge kickoff prompt for Claude Code

How to use:
1. Clone https://github.com/MustafaDilawarKhan/simbridge on your Windows PC.
2. Put `CLAUDE.md` in the repo root and `SRS.md` + `SDS.md` in `docs/`.
3. Open the repo in Claude Code, press Shift+Tab until you are in **plan mode**.
4. Paste everything between the two lines below.

---

You are the lead engineer starting the SimBridge project in this repository
(https://github.com/MustafaDilawarKhan/simbridge). I am the developer: a final-year
computing student, comfortable with code but new to iOS tooling. Work
systematically and professionally, and explain what you do in simple words.

## 0. Read first, then report back

Before writing anything:

1. Read `CLAUDE.md` fully. It is the project rulebook; follow it in every step.
2. Read `docs/SRS.md` sections 1, 2, 3.6 (M6), 5 and 7, and `docs/SDS.md`
   sections 1, 2, 3.5 (C5 + Tunnel providers), 4.1, 6.3 and 7.
3. Inspect the repo: `git status`, `git log --oneline`, the file tree, and run
   `gh repo view --json visibility,defaultBranchRef` to learn whether the repo is
   public or private.
4. Check my machine: `node -v` (need 20+), `npm -v`, `git --version`, `gh --version`
   and `gh auth status`. If anything is missing, tell me exactly what to install
   and stop until I confirm.

Then give me a short report:
- what the project is and what the current phase (R0) must prove, in 5 lines max
- the repo state and visibility, and what visibility means for cost
  (public repos run standard macOS runners for free; private repos burn included
  minutes at 10x)
- anything in the docs that looks contradictory or unclear

Wait for my "go" before Stage 1.

## Ground rules for the whole session

- **Plan before each stage**, show me the plan, and wait for my approval.
- **Work on a branch per stage** (`chore/foundation`, `spike/r0-...`), small
  commits using Conventional Commits (`feat:`, `chore:`, `docs:`, `test:`), with
  requirement IDs in the message where relevant (e.g. `feat(spike): idle exit
  FR-SIM-06`). Open a pull request at the end of each stage with `gh pr create`,
  and do not merge it yourself.
- **Never** commit secrets, tokens, tunnel URLs or `.env` files.
- **Ask before** adding a dependency not named in this prompt, choosing a licence,
  creating GitHub secrets, or triggering any workflow (workflows can cost minutes).
- **Do not build R1 features** (CLI, MCP server, desktop app, session agent
  package). R0 is a throwaway spike that answers one question.
- If a tool or command behaves differently from what the docs assume (for
  example serve-sim's options or endpoints), **read its README or source first**,
  then tell me what differs. Never guess an API.
- At each stop point, summarise in plain words: what you did, what I should
  check, and what comes next.

## Stage 1: Repository foundation (branch `chore/foundation`)

Goal: a clean, professional monorepo skeleton that every later stage builds on.
Keep it minimal: structure and tooling only, no product code.

1. **Workspace:** npm workspaces with TypeScript (strict), Node 20.
   - Root `package.json` with scripts: `build`, `test`, `lint`, `format`, `typecheck`.
   - `tsconfig.base.json` shared by packages.
   - Create the package folders from CLAUDE.md's planned layout (`packages/core`,
     `packages/backends`, `packages/cli`, `packages/mcp`,
     `packages/session-agent`, `packages/desktop`), each with only a
     `package.json`, a `README.md` (one paragraph: its purpose and SDS section)
     and an empty `src/index.ts`. No logic yet.
2. **Quality tooling:** ESLint (typescript-eslint), Prettier, Vitest with one
   trivial passing test in `packages/core` so the pipeline is proven.
   `.editorconfig`, `.gitattributes` (LF line endings, important on Windows),
   `.gitignore` (Node, build output, `.env*`, OS files).
3. **CI:** `.github/workflows/ci.yml` on `ubuntu-latest` only (cheap): install,
   lint, typecheck, test, on push and pull request. Least permissions
   (`contents: read`). No macOS jobs in CI.
4. **Repo docs:**
   - `README.md`: what SimBridge is (from SRS 1), status "R0 proof of concept",
     links to `docs/SRS.md`, `docs/SDS.md`, `CLAUDE.md`, and a "Getting
     started for contributors" section.
   - `CONTRIBUTING.md`: branch naming, commit style, PR checklist, how
     requirement IDs are used.
   - `docs/adr/`: Architecture Decision Records, one short file each (context,
     decision, consequences) for the decisions already in CLAUDE.md's log:
     0001 session hand-off by encrypted check run; 0002 device conditions are
     Must; 0003 Android is R4; 0004 Cloudflare quick tunnel behind a
     TunnelProvider interface; 0005 WebSockets instead of SSE; 0006 GitHub App
     sign-in; 0007 Flutter hot reload as an R3 timeboxed spike.
   - `.github/pull_request_template.md` (summary, requirement IDs, tests, docs
     updated?) and issue templates for bug and task.
5. **Licence:** ask me to choose MIT or Apache-2.0 (the SRS allows either),
   then add `LICENSE`.
6. **Project tracking:** propose (do not create yet) GitHub milestones R0 to R4
   and a list of R0 issues. Create them with `gh` only after I approve.

**Stop point 1:** run `npm install`, `npm run lint`, `npm run typecheck` and
`npm test` locally, show me the results, push the branch, open the PR, and
wait for my review.

## Stage 2: R0 spike (branch `spike/r0-sim-stream`)

Goal (from CLAUDE.md): prove a simulator on a GitHub macOS runner can be streamed
to my Windows PC through a Cloudflare quick tunnel with usable lag.
Gate: under 3 min from dispatch to a usable simulator, under 400 ms tap lag,
and both the MJPEG stream and a WebSocket log stream work through the tunnel.

Everything for the spike lives under `spikes/r0/` plus one workflow file, so
it can be deleted later without touching product code.

1. **Sample app:** a tiny Expo app in `spikes/r0/sample-app` (blank TypeScript
   template) with one screen: a counter button and a text that shows the time
   of the last tap. That gives a visible change for measuring tap lag.
2. **Workflow** `.github/workflows/r0-spike.yml`:
   - `workflow_dispatch` with inputs `minutes` (default 15, max 30) and
     `device` (default an iPhone model available on the runner image; check the
     runner's simulator list in a step and print it).
   - `runs-on: macos-latest`, `timeout-minutes: 40` as a backstop, least
     permissions.
   - Build the app for the simulator **without Metro**: `expo prebuild -p ios`,
     then `xcodebuild` with `-sdk iphonesimulator` and the **Release**
     configuration so the JavaScript bundle is embedded (a Debug build would
     look for a Metro server that does not exist). No signing.
   - Boot the simulator, install and launch the app.
   - Start serve-sim (read its README for the right flags; it streams the
     simulator and accepts taps).
   - Start a tiny Node "spike gateway" on one local port that forwards stream
     and input requests to serve-sim and also serves a WebSocket at `/ws/logs`
     that pushes the simulator's log lines for the app. This tests FR-SIM-13
     (WebSockets, no SSE) through the same tunnel.
   - Start `cloudflared tunnel --url http://localhost:<gateway port>`, read the
     trycloudflare.com URL from its output.
   - **Do not print the URL in plain text.** Public repo logs are readable by
     anyone. Encrypt it with a passphrase stored as the repo secret
     `R0_SPIKE_KEY` (ask me to create it; never create or print it yourself)
     and print only the encrypted text. Also mask it with `::add-mask::`.
   - Record timestamps for: job start, build done, simulator booted, app
     launched, tunnel ready. Print them as a small table and write them to the
     job summary.
   - Keep the job alive for `minutes`, then stop cloudflared and exit cleanly.
     The job must end on its own even if nobody connects (FR-SIM-06/07 spirit).
3. **Local tools** in `spikes/r0/tools` (Node, run on Windows):
   - `decrypt-url`: takes the encrypted text and the passphrase, prints the URL.
   - `measure`: connects to the URL and reports
     - time to first video frame,
     - tap lag: sends a tap on the counter button, timestamps it, and measures
       until the next frame that differs in the button area; repeat 20 times
       and report median and 95th percentile,
     - whether `/ws/logs` connects and receives lines,
     - stream frame rate over 30 seconds.
     Write results to `spikes/r0/results/<date>.json`.
   - Keep the tools simple and documented; no packages beyond what you name in
     the plan and I approve.
4. **Runbook** `spikes/r0/README.md`: exact step-by-step instructions for me:
   create the secret, run the workflow from the Actions tab or
   `gh workflow run`, decrypt the URL, open it in the browser, run `measure`.

**Stop point 2:** show me the files, explain each step of the workflow in plain
words, push, open the PR, and wait. I will create the secret and approve
before any workflow run.

## Stage 3: Run, measure, decide

1. With my approval, trigger the workflow with `gh workflow run` and follow it
   with `gh run watch`. If it fails, read the logs, explain the cause simply,
   fix, and retry (ask before every new run).
2. When it is live, guide me through decrypting the URL and running `measure`.
3. Write `docs/spikes/R0-results.md`: the numbers against the gate, timing
   breakdown from the job summary, what felt usable, problems found (especially
   anything about MJPEG or WebSockets through the quick tunnel), and a clear
   **go / no-go** recommendation for R1, with what to change if no-go
   (for example: move frames to a WebSocket, or try Tailscale per FR-SIM-15).
4. Update `CLAUDE.md` (current phase and decisions log) and, if the design
   changes, the matching SDS sections, in the same PR.

**Stop point 3:** final summary and the proposed R1 plan, broken into the
module order from my notes: monorepo packages are ready, then C2 Stack
Detector, C3 Build Orchestrator, session agent + C5, C4 + CLI, C8 MCP server,
C11 simulator conditions, desktop UI last. Do not start R1 until I say so.

Start with section 0 now.

---

## Template for later sessions

Paste this at the start of each new Claude Code session:

> Read CLAUDE.md. Today's task: <module, e.g. C2 Stack Detector>.
> Read SDS section <x.y> and the FR IDs it lists in SRS.
> Plan first: files to create or change, the tests you will write (named after
> the FR IDs), and anything unclear in the docs. Wait for my approval, then
> work on a branch, commit in small steps, run lint, typecheck and tests, open a
> PR, and update CLAUDE.md or the docs if anything changed.
