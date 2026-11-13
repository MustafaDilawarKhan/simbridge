# ADR 0008: Session token travels as a cookie and a first WebSocket message

- Status: Accepted
- Date: 2026-11-14
- Requirements: NFR-SEC-03, NFR-SEC-04, FR-SIM-04, FR-SIM-13
- Design: SDS 6.3, SRS 4.5

## Context

Every Mode B session is protected by a random token, and the first design said
every request must carry the header `Authorization: Bearer <session token>`.

That rule cannot work in the desktop UI. A browser (and so the Electron window)
gives a page no way to add a header to two kinds of request we depend on:

- the `<img>` tag that shows the MJPEG video stream, and
- a WebSocket connection (logs, stats, control).

The easy workaround is to put the token in the URL (`?t=...`). That is unsafe
for a real release: URLs are written to logs, browser history and proxy
records, and the project's hard rules forbid tokens in logs.

## Decision

The session token is presented in two ways, and never in a URL:

1. **HTTP and the MJPEG stream:** the client sends the token once, in an
   `Authorization: Bearer` header, to `POST /auth`. The session agent replies
   with a short-lived cookie marked `HttpOnly` and `Secure`. All other HTTP
   endpoints, including `GET /stream`, accept only that cookie. `POST
   /heartbeat` renews it.
2. **WebSockets:** the client's first message must be
   `{ "type": "auth", "token": "<session token>" }`. The agent sends nothing
   before it and closes the socket if it is wrong or late.

The R0 spike is the one exception. It is throwaway code that answers a single
question about stream lag, so it passes a random per-run token as `?t=<token>`.
That shortcut must not be copied into R1.

## Consequences

- The desktop UI can show the stream with a plain `<img>` tag and open
  WebSockets without any proxy on the PC.
- `HttpOnly` keeps the cookie away from page scripts; a short lifetime limits
  the damage if it leaks.
- The session agent gains one endpoint (`POST /auth`) and a small amount of
  state (which cookies are valid, and until when).
- Non-browser clients (CLI, MCP server) follow the same two steps, so there is
  one auth path to test, not two.
- Still to settle when the session agent is built in R1: the cookie lifetime,
  its `SameSite` value (the UI and the tunnel are different origins), and the
  WebSocket auth timeout.
