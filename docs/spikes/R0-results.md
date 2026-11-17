# R0 results

The R0 proof of concept asks one question: can an iOS simulator on a GitHub
Mac be streamed to a Windows PC through a Cloudflare quick tunnel, fast enough
to use? The spike code is on the branch `archive/r0-spike-code`, and it runs
in the test repo `MustafaDilawarKhan/expo-rsc-movies`.

**Status (18 Nov 2026): in progress, no go/no-go yet.** Runs 1 to 5 are done.
Run 6 re-measures with H.264 video (ADR 0010).

## The gate

| Check                                     | Target          | Best so far                 | Verdict                            |
| ----------------------------------------- | --------------- | --------------------------- | ---------------------------------- |
| Simulator boot to tunnel ready            | under 180 s     | 252 s (run 5)               | Fail so far                        |
| Tap lag, median                           | under 400 ms    | not measured reliably yet   | Open, run 6                        |
| Video through the tunnel                  | works           | MJPEG and H.264 both arrive | Pass                               |
| WebSocket log stream through the tunnel   | works           | about 47,000 lines in run 5 | Pass                               |
| Frame rate (NFR-PERF-04, for information) | at least 15 fps | MJPEG about 5 fps           | Fail on MJPEG, re-measure on H.264 |

## Runs

All runs use the standard `macos-latest` runner (macOS 26, Apple Silicon,
Xcode 26.6, iOS 26.5 simulator, iPhone 17 Pro), and the test app built in
Release with the JavaScript bundled in.

| Run | GitHub run  | Result                                    | What it taught us                                                                                                                                                                                   |
| --- | ----------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 44125628682 | Stopped at the tunnel check               | The Mac could not reach its own tunnel in 120 s. Most likely the first DNS lookup of the new name failed and macOS cached that answer. Fix: ask 1.1.1.1 directly and connect with `curl --resolve`. |
| 2   | 44131815144 | Session live for 15 min, nobody connected | The fix works. The watcher on the PC side froze, so the developer was not told in time. Start-time gate measured: 297.7 s.                                                                          |
| 3   | 44145137724 | No Mac after 15 min, cancelled by GitHub  | GitHub's free Apple Silicon Macs were full ("capacity constraints").                                                                                                                                |
| 4   | 44148708133 | Same as run 3                             | Same.                                                                                                                                                                                               |
| 5   | 44152849822 | Session live for 30 min, measured         | The real app streamed live through the tunnel and taps reached it. The MJPEG frame rate was too low (see below). Start-time gate: 252.1 s.                                                          |

## Start time

From simulator boot to tunnel ready, in seconds:

| Phase                                                              |     Run 2 |     Run 5 |
| ------------------------------------------------------------------ | --------: | --------: |
| Boot, including iOS first-time setup and opening the Simulator app |     168.8 |     162.7 |
| Install the app                                                    |      60.7 |      35.6 |
| Launch the app                                                     |       2.0 |       6.1 |
| serve-sim streaming                                                |      18.1 |      28.1 |
| Gateway up                                                         |       3.3 |       1.4 |
| Cloudflare issues the tunnel address                               |       8.6 |       6.3 |
| The address answers on the internet                                |      36.3 |      11.8 |
| **Total (gate: 180)**                                              | **297.7** | **252.1** |

Not counted in the gate:

- **Waiting for a Mac:** 315 s (run 2) and 13 s (run 5). Runs 3 and 4 never got a Mac.
- **App build:** about 11 to 13 minutes on the 3-core runner. R1 skips the build when the native code is unchanged.

**Boot is about two thirds of the time.** The simulator is brand new on every
runner, so iOS runs its first-time setup (the `bootstatus` "data migration"
phase, about 90 s). Opening the Simulator app added about 45 s in run 1.

## Video and taps (run 5)

- **The picture arrives:** the first MJPEG frame came 1.1 to 2.1 s after
  connecting, and the frames showed the real app with real movie posters.
- **Taps reach the app:** taps on the keyboard typed "Aa" into the app's search
  box, and the app loaded results.
- **MJPEG is too heavy:** each frame is the full screen (1206 × 2622, about
  370 KB). The stream reached about 5 fps at about 1.8 MB/s (15 Mbit/s). The
  developer's line measured 20.36 Mbit/s down, so the stream used about three
  quarters of it. 15 fps at this size would need about 44 Mbit/s.
- **Tap lag was not measured reliably.** The tap points were wrong for iOS 26
  (the right-hand tab opened the search keyboard), and one typed letter is too
  small a change for the pixel check. The few taps that were timed took about
  0.8 to 2.1 s, partly because frames queued behind each other.
- **H.264 for comparison:** about 2.4 Mbit/s (298 KB/s) at low motion.

## Decisions so far

- **The tunnel check uses Cloudflare's DNS (1.1.1.1)**, because the Mac's own
  resolver can cache a "no such name" answer for a brand-new tunnel (run 1).
- **H.264 is the main video stream** and MJPEG the fallback, capped at
  8 Mbit/s (ADR 0010). The tap-lag gate is unchanged. The frame-rate target is
  judged on H.264.
- **R1 must treat a missing Mac as normal:** show "waiting for a GitHub Mac"
  apart from the start time, and start again when GitHub cancels a job for
  lack of capacity (runs 3 and 4).

## Next

1. **Run 6 with H.264:** a screenshot first to pick two tap points that
   visibly change the screen, then `measure` (tap lag and frame rate over
   H.264).
2. **Start time:** the boot phase alone takes most of the 3 minutes on a fresh
   runner. Ideas for R1:
   - boot the simulator while the saved build downloads (FR-SIM-02);
   - open the Simulator app without waiting for it;
   - install the app straight after boot.
     Whether the gate still counts from boot start or from session start is a
     decision for the developer once run 6 is in.
3. **Go/no-go** for R1, written here.
