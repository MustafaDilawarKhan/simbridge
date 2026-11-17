# R0 spike runbook

This folder is a **throwaway experiment**. It answers one question before any
product code is written:

> Can an iOS simulator on a GitHub Mac be streamed to a Windows PC through a
> Cloudflare quick tunnel, fast enough to use?

**Gate:**

- under 3 minutes from simulator boot to tunnel ready;
- median tap lag under 400 ms;
- the MJPEG video and a WebSocket log stream both work through the tunnel.

When R0 is decided, delete this folder and `.github/workflows/r0-spike.yml`.

## How it fits together

```
Windows PC                         GitHub Mac runner (macos-latest)
──────────                         ────────────────────────────────
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
                                   iOS Simulator running sample-app
```

| Folder        | What it is                                                              |
| ------------- | ----------------------------------------------------------------------- |
| `sample-app/` | One-screen Expo app: counter button, last tap time, Animate switch      |
| `gateway/`    | Runs on the Mac: proxies serve-sim, serves `/ws/logs` and a viewer page |
| `runner/`     | Scripts the workflow runs on the Mac                                    |
| `tools/`      | Run on your PC: `decrypt-url`, `measure`, and the local `dry-run`       |
| `lib/`        | Shared code: encryption, MJPEG parsing, screen layout                   |
| `results/`    | `measure` writes one JSON file per run here (no URL or token inside)    |

You need Node.js 22 or newer on the PC (`node -v`), because the tools use
Node's built-in WebSocket.

## Step 0: install the tool packages (once)

```powershell
cd spikes\r0
npm ci
```

## Step 1: create the secret `R0_SPIKE_KEY`

> **Status: not created yet.** The name is a placeholder until you decide to
> run the spike. Without it the workflow stops in its first step, after a few
> seconds, and prints nothing sensitive.

The secret is a passphrase. The workflow uses it to encrypt the tunnel URL,
because job logs in a public repo are readable by anyone. You use the same
passphrase on your PC to decrypt it.

1. Make a strong random passphrase in PowerShell:

   ```powershell
   $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
   ```

2. Save it in your password manager.
3. Store it as a repository secret. `gh` asks for the value and does not show
   it on screen:

   ```powershell
   gh secret set R0_SPIKE_KEY --repo MustafaDilawarKhan/simbridge
   ```

Never put the passphrase in a file, a commit, an issue or a chat.

## Step 2 (optional, free): dry run on your PC

This tests the gateway, the encryption and `measure` against a pretend
simulator. It uses no Mac and no runner minutes.

```powershell
cd spikes\r0
node tools\dry-run.mjs
```

It should end with `Dry run passed.`

## Step 3: start a run (this uses a Mac runner)

A run takes about 25 to 45 minutes of runner time: about 10 to 15 for the build,
then the session (`minutes`). It is free while the repo is public.

The workflow file must be on `main` before GitHub lets you start it, so merge
the spike pull request first. Then use either of these:

- **Command line:**

  ```powershell
  gh workflow run r0-spike.yml --repo MustafaDilawarKhan/simbridge -f minutes=15 -f device="iPhone 17 Pro"
  gh run watch --repo MustafaDilawarKhan/simbridge
  ```

- **Browser:** **Actions** tab → **R0 spike - simulator stream** → **Run
  workflow**.

## Step 4: get the session

When the step **Run the session** prints this block, the simulator is live:

```
=============== ENCRYPTED SESSION: copy the whole next line ===============
r0v1.AbC...
```

The same line is also in the run's **Summary** page, with the timing table.

Copy the `r0v1.` line, then on your PC:

```powershell
cd spikes\r0
node tools\decrypt-url.mjs
```

Paste the line, then type the passphrase (nothing shows while you type). It
prints the **Viewer link**. Open it in your browser:

- the simulator screen is on the left; click it to tap;
- the app's log lines appear on the right, through the WebSocket;
- **End session now** stops the runner at once.

Keep the viewer link private: anyone with it can control the simulator until
the session ends.

## Step 5: measure

While the session is live:

```powershell
cd spikes\r0
node tools\measure.mjs
```

Paste the same `r0v1.` line and the passphrase. It takes about 2 minutes and
prints the results:

- time to first frame;
- tap lag over 20 taps, as the median and the 95th percentile (p95);
- MJPEG frames per second and data rate while the bar animates;
- the data rate of serve-sim's H.264 stream, for comparison;
- whether the WebSocket log stream received the tap lines.

It saves them to `results\<date>.json`.

Don't tap the simulator while `measure` runs; it does its own taps.

## Step 6: end

Click **End session now** in the viewer, or let the time run out. The job
shuts down by itself either way, even if nobody ever connected. A 60-minute
limit is the last backstop.

## If something goes wrong

| What you see                                  | Likely cause and fix                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| Job fails at "Check the R0_SPIKE_KEY secret"  | The secret is not set yet. Do step 1.                                         |
| `No available simulator called ...`           | The job lists the models that exist. Run again with one of them as `device`.  |
| `Could not decrypt`                           | Wrong passphrase, or the `r0v1.` line was not copied whole.                   |
| Viewer says `401` / `Missing or wrong token`  | Use the full viewer link printed by `decrypt-url`, including `?t=...`.        |
| Picture freezes but logs keep coming          | MJPEG buffering in the tunnel: an R0 finding. Note it and run `measure`.      |
| `measure` says `no change seen` for some taps | Counted as missed taps. Many misses mean taps are not reaching the simulator. |
| The tunnel URL is not reachable               | Quick tunnels have no uptime guarantee. Start a new run.                      |

## What we checked about serve-sim (0.1.49)

These were checked against its README and source on 17 Nov 2026, before writing
this spike:

- **Hardware:** it runs on Apple Silicon Macs only. `macos-latest` is macOS 26
  on Apple Silicon.
- **Runs without a screen:** its own CI runs it on GitHub Mac runners.
- **Video:**
  - MJPEG at `/helper/<udid>/stream.mjpeg`;
  - H.264 at `/helper/<udid>/stream.avcc`: 4-byte length, a 1-byte tag
    (`0x02` keyframe, `0x03` delta), then the data.
- **Taps:** a WebSocket at `/helper/<udid>/ws`.
  - Each message is the byte `0x03` followed by JSON
    `{"type":"begin"|"move"|"end","x":0..1,"y":0..1}`.
  - It accepts only same-origin connections.
- **Access:** it answers only its own machine unless started with an auth
  token. Requests carrying Cloudflare's forwarding headers count as remote.
- **Logs:** its log, accessibility and state channels use SSE. That is why the
  gateway serves `/ws/logs` itself.
