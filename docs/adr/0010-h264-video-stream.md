# ADR 0010: H.264 is the main video stream, MJPEG the fallback

- Status: Accepted
- Date: 2026-11-18
- Requirements: NFR-PERF-02, NFR-PERF-04, FR-UI-01, FR-SIM-13
- Design: SDS 6.3
- Evidence: [R0 results](../spikes/R0-results.md), run 5

## Context

The design started with MJPEG for the simulator video: every browser can show
it in an `<img>` tag, so it is the simplest stream. ADR 0005 left one question
open: whether MJPEG works well through the Cloudflare quick tunnel.

R0 run 5 answered it. MJPEG does pass through the tunnel, but:

- serve-sim 0.1.49 sends every MJPEG frame at the full screen size
  (1206 × 2622 for an iPhone 17 Pro, about 370 KB per frame) and has no setting
  to make frames smaller (the JPEG quality is fixed at 0.7 in its source).
- On the developer's 20 Mbit/s home line the stream reached only about 5 frames
  per second while using about 15 Mbit/s. 15 fps would need about 44 Mbit/s.
- Frames queued in the buffers between the Mac and the PC, so the picture ran
  late and taps looked slow.

serve-sim's own browser preview uses H.264 instead (`/stream.avcc`), decoded by
the browser's WebCodecs `VideoDecoder`. It sends only what changes between
frames: about 2.4 Mbit/s in run 5, and its data rate can be capped with
`SERVE_SIM_MAX_BITRATE`.

## Decision

- The session video is **H.264**, served from serve-sim's `/stream.avcc`,
  capped at 8 Mbit/s by default, and decoded in the desktop app with WebCodecs
  (Electron includes it).
- **MJPEG stays as the fallback** when H.264 cannot be decoded, and for single
  screenshots.
- The frame-rate target NFR-PERF-04 (at least 15 fps in Mode B) is judged on
  the H.264 stream, on a 20 Mbit/s connection. The tap-lag target NFR-PERF-02
  (median under 400 ms) is unchanged.
- This settles the video question left open in ADR 0005: the video stays on
  plain HTTP, and the logs, stats and control stay on WebSockets.

## Consequences

- SimBridge works on ordinary home connections, not only fast ones.
- The client needs an H.264 decoder. Chromium has one, so the desktop app does;
  an agent that only wants pictures uses `GET /screenshot`.
- H.264 frames depend on earlier frames, so a viewer that joins late waits for
  the next keyframe. serve-sim sends a JPEG "seed" picture first to cover that.
- The R0 gate is re-measured over H.264 (run 6 onwards).
