# ADR 0009: Sign-out forgets local tokens and offers GitHub's revoke page

- Status: Accepted
- Date: 2026-11-17
- Requirements: FR-SET-01, FR-SET-08, FR-SET-09, NFR-SEC-01, NFR-SEC-02
- Design: SDS 3.1

## Context

Users sign in with GitHub through the GitHub App device flow (ADR 0006): the
app opens the browser, the user types a short code on github.com and approves
access. Users also need a clear way to sign out, for example on a shared PC or
when switching accounts.

"Signing out" can mean two things:

1. **Forget the token on this PC.** SimBridge deletes the tokens it stored in
   the Windows Credential Manager.
2. **Revoke the token on GitHub,** so it stops working everywhere.

GitHub's API can revoke a GitHub App user token, but only when the call is
authenticated with the App's **client secret**. SimBridge uses the device flow
precisely so that no client secret ships inside the app (ADR 0006), so it
cannot make that call.

## Decision

- **Sign-in** opens the default browser at `https://github.com/login/device`,
  shows the one-time code and copies it to the clipboard. If no browser can be
  opened, the link is shown instead.
- **Sign-out** (UI button and `simbridge logout`):
  - offers to end any live session first;
  - deletes the access and refresh tokens from the Windows Credential Manager
    and clears account-bound caches (repo list, current user), keeping local
    recordings and settings;
  - offers to open `https://github.com/settings/apps/authorizations`, where
    the user can revoke SimBridge's access with one click
    (`simbridge logout --revoke` opens it directly).
- Sign-in and sign-out are human-only; no MCP tool exposes them.

## Consequences

- No client secret is ever shipped, so a copy of the app cannot be used to
  impersonate SimBridge.
- After sign-out, nothing on the PC can call GitHub as the user.
- Full revocation is one extra click on GitHub. Until then, a copied token
  still works until it expires (GitHub App user tokens expire after 8 hours;
  refresh tokens after 6 months).
- An agent cannot lock the user out or switch accounts behind their back.
