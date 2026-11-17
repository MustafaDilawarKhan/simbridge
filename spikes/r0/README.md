# R0 spike runbook

This branch (`archive/r0-spike-code`) holds a **throwaway experiment**, kept out
of SimBridge's product code on purpose. It answers one question before any
product code is written:

> Can an iOS simulator on a GitHub Mac be streamed to a Windows PC through a
> Cloudflare quick tunnel, fast enough to use?

**Gate:**

- under 3 minutes from simulator boot to tunnel ready;
- median tap lag under 400 ms;
- the MJPEG video and a WebSocket log stream both work through the tunnel.

**Test app:**
[MustafaDilawarKhan/expo-rsc-movies](https://github.com/MustafaDilawarKhan/expo-rsc-movies),
a public fork of Evan Bacon's Expo movies app. SimBridge adds one file there,
the workflow `.github/workflows/simbridge-r0.yml` (a copy is in `workflow/`
here). It never changes the app itself. While it runs, the workflow fetches the
tools below from this branch, the same way real SimBridge will work with a
user's repo.

## How it fits together

```
Windows PC                         GitHub Mac runner (in expo-rsc-movies)
──────────                         ──────────────────────────────────────
browser / measure ──HTTPS/WSS──►  Cloudflare quick tunnel
                                        │
                                        ▼
                                   gateway (one port, checks ?t=token)
                                     │            │
                         stream + taps            /ws/logs
                                     ▼            ▼
                                   serve-sim    simctl log stream
                                     │
                                     ▼
                                   iOS Simulator running expo-rsc-movies
```

| Folder      | What it is                                                              |
| ----------- | ----------------------------------------------------------------------- |
| `workflow/` | The workflow file that lives in the test repo                           |
| `gateway/`  | Runs on the Mac: proxies serve-sim, serves `/ws/logs` and a viewer page |
| `runner/`   | Scripts the workflow runs on the Mac                                    |
| `tools/`    | Run on your PC: `decrypt-url`, `measure`, and the local `dry-run`       |
| `lib/`      | Shared code: encryption, MJPEG parsing, tap positions                   |
| `results/`  | `measure` writes one JSON file per run here (no URL or token inside)    |

On your PC this branch is checked out at
`C:\Users\Laptop\Desktop\simbridge-r0-spike`. You need Node.js 22 or newer
(`node -v`), because the tools use Node's built-in WebSocket.

## Step 0: install the tool packages (once)

```powershell
cd C:\Users\Laptop\Desktop\simbridge-r0-spike\spikes\r0
npm ci
```

## Step 1: the secret `R0_SPIKE_KEY`

The passphrase encrypts the tunnel URL, because job logs in a public repo are
readable by anyone.

- **Already created** on your PC at `C:\Users\Laptop\.simbridge\r0-spike-key.txt`.
  Only your Windows user can read it. Copy it into your password manager.
- **Stored** as the repository secret `R0_SPIKE_KEY` in `expo-rsc-movies`.

To replace it later, make a new random passphrase in PowerShell and store it
again:

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
gh secret set R0_SPIKE_KEY --repo MustafaDilawarKhan/expo-rsc-movies
```

Never put the passphrase in a file inside a repo, a commit, an issue or a chat.

## Step 2 (optional, free): dry run on your PC

This tests the gateway, the encryption and `measure` against a pretend
two-tab app. It uses no Mac and no runner minutes.

```powershell
node tools\dry-run.mjs
```

It should end with `Dry run passed.`

## Step 3: start a run (this uses a Mac runner)

A run takes about 25 to 45 minutes of runner time: about 10 to 20 for the
build, then the session (`minutes`). It is free while the repo is public.

- **Command line:**

  ```powershell
  gh workflow run simbridge-r0.yml --repo MustafaDilawarKhan/expo-rsc-movies -f minutes=15 -f device="iPhone 17 Pro"
  gh run watch --repo MustafaDilawarKhan/expo-rsc-movies
  ```

- **Browser:** `expo-rsc-movies` → **Actions** → **SimBridge R0 spike** →
  **Run workflow**.

## Step 4: get the session

When the step **Run the session** prints this block, the simulator is live:

```
=============== ENCRYPTED SESSION: copy the whole next line ===============
r0v1.AbC...
```

The same line is also on the run's **Summary** page, with the timing table.

Copy the `r0v1.` line, then on your PC:

```powershell
node tools\decrypt-url.mjs
```

Paste the line. The passphrase is read from your key file automatically if you
point to it first; otherwise type it (nothing shows while you type):

```powershell
$env:R0_SPIKE_KEY = Get-Content $env:USERPROFILE\.simbridge\r0-spike-key.txt -Raw
```

It prints the **Viewer link**. Open it in your browser:

- the simulator screen is on the left; click it to tap, or drag it to scroll;
- the top bar shows the position of your last click, for example
  `last click: 0.31,0.95`;
- the app's log lines appear on the right, through the WebSocket;
- **End session now** stops the runner at once.

Keep the viewer link private: anyone with it can control the simulator until
the session ends.

## Step 5: measure

The main video stream is **H.264** (decided after run 5: full-size MJPEG
frames need about 44 Mbit/s for 15 fps, more than a normal home line; H.264
uses a few Mbit/s). The viewer plays H.264 and has a link to switch to MJPEG.

`measure` taps two points in turn, A and B, and **each tap must visibly change
the screen** (for example open and close a page). On iOS 26 the app's tab bar
has a separate search button that opens a keyboard, so check the screen first:

```powershell
node tools\screenshot.mjs --out=screen.jpg
```

Open `screen.jpg`, or click in the viewer: the top bar shows `last click: x,y`.
Then, while the session is live (and without touching the viewer):

```powershell
node tools\measure.mjs --tap-a=0.92,0.58 --tap-b=0.88,0.94
```

Use your own two points. Paste the same `r0v1.` line. It takes about 2 minutes
and prints:

- time to the first picture (H.264);
- tap lag over H.264, 20 taps: the median and the 95th percentile (p95);
- H.264 frames per second and data rate while it scrolls the list;
- for comparison, MJPEG: a few taps, frames per second and data rate;
- whether the WebSocket log stream delivered messages.

It saves them to `results\<date>.json`. If most taps say `no change seen`, the
two points do not change the screen: take a screenshot and pick new ones.

## Step 6: end

Click **End session now** in the viewer, or let the time run out. The job
shuts down by itself either way, even if nobody ever connected. A 60-minute
limit is the last backstop.

## If something goes wrong

| What you see                                 | Likely cause and fix                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| Job fails at "Check the R0_SPIKE_KEY secret" | The secret is missing in `expo-rsc-movies`. See step 1.                                |
| Build step fails                             | Expo SDK 54 versus the runner's Xcode; read the log and fix before running again.      |
| `No available simulator called ...`          | The job lists the models that exist. Run again with one of them as `device`.           |
| `Could not decrypt`                          | Wrong passphrase, or the `r0v1.` line was not copied whole.                            |
| Viewer says `401` / `Missing or wrong token` | Use the full viewer link printed by `decrypt-url`, including `?t=...`.                 |
| Picture freezes but logs keep coming         | MJPEG buffering in the tunnel: an R0 finding. Note it and run `measure`.               |
| Movie lists stay empty                       | The app's data server (`flix--app.expo.app`) is down; streaming can still be measured. |
| The tunnel URL is not reachable              | Quick tunnels have no uptime guarantee. Start a new run.                               |

The serve-sim facts this spike relies on are in SimBridge's
`docs/spikes/serve-sim-findings.md` on `main`.
