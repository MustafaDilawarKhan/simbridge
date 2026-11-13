# ADR 0001: Session hand-off by encrypted check run

- Status: Accepted
- Date: 2026-11-13
- Requirements: FR-SIM-04, NFR-SEC-03, NFR-SEC-04
- Design: SDS 3.5, 4.1, 6.4, 7.2

## Context

In Mode B the simulator runs on a GitHub macOS runner. Once the runner has
opened its tunnel, the client on the Windows PC needs two things from it: the
tunnel URL and the session token. The runner cannot call the PC, because the PC
opens no inbound ports.

The obvious channel is a workflow job output. It does not work: job outputs
can only be read after the job has ended, and a session job is still running
when the client needs the URL. Printing the URL in the job log is also ruled
out, because logs of a public repo are readable by anyone.

## Decision

The client creates a one-time key pair for each session and passes the public
key to the workflow as an input. The runner encrypts the tunnel URL and session
token with that public key and posts the result as the summary of a GitHub
check run named after the session (`simbridge-session-<id>`). The client polls
the check runs until it appears, then decrypts it with its private key.

## Consequences

- The URL and token are readable only by the client that started the session,
  even in a public repo.
- The session workflow needs the `checks: write` permission; the GitHub App
  needs `Checks: read`.
- The client must poll, which adds a short delay and a few API calls to every
  session start.
- The R0 spike uses a simpler stand-in (a passphrase stored as a repo secret,
  with the encrypted text printed in the log). That shortcut is not carried
  into R1.
