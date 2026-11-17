# serve-sim findings (R0 research)

- Date: 17 Nov 2026
- Version checked: serve-sim 0.1.49 (npm), source at commit `489a427` of
  [EvanBacon/serve-sim](https://github.com/EvanBacon/serve-sim), licence Apache-2.0
- Method: read its README, source and its own GitHub Actions setup
- Affects: SDS 3.5 (C5), SDS 6.3 (runner session API), ADR 0008, issue #13

serve-sim is the tool that streams and controls the iOS Simulator on the
runner. Our docs were written before anyone read its source, and several
assumptions turned out different.

## What it does

| Topic          | What we found                                                                                                                                                                                 | What it means for SimBridge                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Hardware       | Apple Silicon Macs only.                                                                                                                                                                      | Fine: `macos-latest` is macOS 26 on Apple Silicon (Xcode 26.6, iPhone 17 simulators).                                           |
| Runner use     | Its own CI boots a simulator on a GitHub `macos-26` runner and runs tap tests there; it runs `open -ga Simulator` after booting.                                                              | It works on a runner with no screen. Copy the `open -ga Simulator` step.                                                        |
| Video          | MJPEG at `/helper/<udid>/stream.mjpeg`. H.264 at `/helper/<udid>/stream.avcc`: a 4-byte length, a 1-byte tag (`0x01` setup, `0x02` keyframe, `0x03` delta, `0x04` first JPEG), then the data. | MJPEG works as planned. H.264 uses 5 to 10 times less data and is the ready-made fallback if MJPEG is too heavy for the tunnel. |
| Taps and input | A WebSocket at `/helper/<udid>/ws`. A tap is the byte `0x03` followed by JSON `{"type":"begin"\|"move"\|"end","x":0..1,"y":0..1}`. Same-origin connections only.                              | Not `POST /input`. The session agent turns our `POST /input` into these messages and sets a matching `Origin`.                  |
| Access control | Answers only its own machine unless started with `--auth-token` (or `SERVE_SIM_AUTH_TOKEN`). Requests with forwarding headers (Cloudflare, Tailscale, ngrok) count as remote.                 | Start it with an internal token, and let only the session agent talk to it.                                                     |
| Browser auth   | Token in the URL fragment, then `POST /auth`, which sets an HttpOnly, `SameSite=Lax` cookie. Never accepts `?token=`.                                                                         | Almost exactly ADR 0008. R1 may reuse this design or serve-sim's own implementation (issue #13).                                |
| Logs and state | Its log, accessibility, state and event channels use **SSE**.                                                                                                                                 | They may not pass a quick tunnel (FR-SIM-13). The session agent must serve logs over its own WebSocket.                         |
| Start-up       | `serve-sim --detach --quiet <udid>` starts a background helper (default port 3100, bound to 127.0.0.1) and prints its state as JSON.                                                          | The session agent can start it and read the URLs from that JSON.                                                                |
| Releases       | Version 0.x, published almost daily, no GitHub releases.                                                                                                                                      | Always pin an exact version.                                                                                                    |

## Still to confirm on a real runner (R0 run)

- Whether MJPEG flows smoothly through a Cloudflare quick tunnel or gets
  buffered.
- Real tap lag and frame rate from a Windows PC.
- Whether serve-sim sends frames only when the screen changes (it has an
  "idle floor" setting), which affects frame-rate numbers.
