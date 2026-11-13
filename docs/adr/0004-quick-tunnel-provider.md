# ADR 0004: Cloudflare quick tunnel behind a TunnelProvider interface

- Status: Accepted
- Date: 2026-11-14
- Requirements: FR-SIM-04, FR-SIM-12, FR-SIM-14, FR-SIM-15
- Design: SDS 3.5 (Tunnel providers)

## Context

The runner and the Windows PC cannot reach each other directly: the runner has
no public address and the PC must open no inbound ports. Something has to carry
the stream and the control requests between them. The options considered:

- **Cloudflare quick tunnel:** needs no account; `cloudflared` on the runner
  gives a random `trycloudflare.com` URL. Limits: no Server-Sent Events, up to
  200 requests in flight, and no uptime guarantee.
- **Tailscale:** a private network, often with a direct connection, but the
  user needs an account, the app on the PC and a key stored as a GitHub secret.
- **Cloudflare named tunnel:** a fixed address without the quick-tunnel limits,
  but the user needs their own Cloudflare account and domain.

## Decision

Use the **Cloudflare quick tunnel** as the only provider for now, because a
new user can start with no extra account. Put it behind a `TunnelProvider`
interface (`start`, `stop`, `checkClient`) so another provider can be added
later without touching the rest of SimBridge. Tailscale stays a later option
(Could, FR-SIM-15).

## Consequences

- First-time setup needs nothing beyond a GitHub account.
- The quick-tunnel limits shape other decisions, most directly ADR 0005
  (WebSockets instead of SSE).
- Whether the stream is fast and stable enough through a quick tunnel is the
  main unknown, and is exactly what the R0 spike measures. If it fails, the
  interface lets us try Tailscale without redesigning.
- Whatever the provider, the address still travels encrypted (ADR 0001), every
  request still needs the session token (ADR 0008), and the runner still ends
  itself.
