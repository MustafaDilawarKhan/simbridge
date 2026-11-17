# Architecture Decision Records

An Architecture Decision Record (ADR) is one short file that explains one
design decision: the situation we were in (**context**), what we chose
(**decision**) and what follows from it (**consequences**). The decisions log
in [CLAUDE.md](../../CLAUDE.md) is the one-line index; the files here hold the
reasoning.

| No.  | Decision                                                                                   | Status   |
| ---- | ------------------------------------------------------------------------------------------ | -------- |
| 0001 | [Session hand-off by encrypted check run](0001-session-handoff-encrypted-check-run.md)     | Accepted |
| 0002 | [Device conditions are Must](0002-device-conditions-are-must.md)                           | Accepted |
| 0003 | [Android is R4](0003-android-is-r4.md)                                                     | Accepted |
| 0004 | [Cloudflare quick tunnel behind a TunnelProvider interface](0004-quick-tunnel-provider.md) | Accepted |
| 0005 | [WebSockets instead of SSE](0005-websockets-instead-of-sse.md)                             | Accepted |
| 0006 | [GitHub App sign-in](0006-github-app-sign-in.md)                                           | Accepted |
| 0007 | [Flutter hot reload as an R3 timeboxed spike](0007-flutter-hot-reload-r3-spike.md)         | Accepted |
| 0008 | [Session token as a cookie and a first WebSocket message](0008-session-token-transport.md) | Accepted |

## Adding a record

1. Copy the newest file, give it the next number and a short name.
2. Fill in Status, Date, Requirements, Context, Decision and Consequences. Keep
   it to one page and use plain words.
3. Add a row to the table above and a line to the decisions log in `CLAUDE.md`.
4. Never rewrite an accepted record. If a decision changes, write a new ADR and
   mark the old one "Superseded by ADR NNNN".
