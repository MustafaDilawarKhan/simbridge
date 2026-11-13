# ADR 0005: WebSockets instead of SSE

- Status: Accepted
- Date: 2026-11-14
- Requirements: FR-SIM-13
- Design: SDS 1.3, 6.3

## Context

A live session pushes data from the runner to the PC all the time: log lines,
stat samples and control messages. The two usual ways to push data to a client
over HTTP are Server-Sent Events (SSE) and WebSockets. SSE is simpler, but
Cloudflare quick tunnels do not support it, and the quick tunnel is our only
tunnel for now (ADR 0004).

## Decision

Live logs, stats and control use **WebSockets, never SSE**. The paths are
`/ws/logs` and `/ws/stats`.

The video is a separate case: it starts as an MJPEG stream over plain HTTP. If
the R0 spike shows that the tunnel buffers MJPEG, the frames move onto a
WebSocket as well.

## Consequences

- Live streams work through a quick tunnel.
- WebSockets are two-way, so one connection can also carry control messages.
- A browser cannot set an `Authorization` header on a WebSocket, which leads to
  the first-message auth in ADR 0008.
- The client must handle reconnects itself; SSE would have done that for free.
- The R0 spike must prove a WebSocket log stream through the tunnel as part of
  its gate.
