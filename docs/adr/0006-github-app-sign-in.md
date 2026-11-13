# ADR 0006: GitHub App sign-in

- Status: Accepted
- Date: 2026-11-14
- Requirements: FR-SET-01, NFR-SEC-01, NFR-SEC-02
- Design: SDS 3.1

## Context

SimBridge acts on the user's GitHub repo: it dispatches workflows, reads runs
and artifacts, and opens a pull request that adds workflow files. It needs the
user's permission to do that. GitHub offers two ways to ask:

- An **OAuth App** asks for broad scopes. The `repo` scope gives access to
  every repo the user can reach, and its tokens do not expire.
- A **GitHub App** is installed only on the repos the user picks, asks for
  fine-grained permissions, and issues user tokens that expire and refresh.

## Decision

Sign-in uses a **GitHub App** with the **device flow** (the user types a short
code on github.com). The app requests only the permissions listed in SDS 3.1,
on only the repos the user selects.

## Consequences

- Least privilege: SimBridge cannot touch repos the user did not pick.
- The device flow needs no client secret, so no secret ships inside the app.
- Tokens expire and must be refreshed; they are stored in the Windows
  Credential Manager, never in plain files.
- A GitHub App has to be registered and maintained for the project, and users
  go through an "install" step, which is one more screen than an OAuth App.
- The permission table in SDS 3.1 is a hard limit: never request more than it
  lists.
