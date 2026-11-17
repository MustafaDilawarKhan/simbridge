# ADR 0007: Flutter hot reload as an R3 timeboxed spike

- Status: Accepted
- Date: 2026-11-14
- Requirements: FR-SIM-10, FR-SIM-09
- Design: SDS 4.9, 6.3 (`POST /sync`)

## Context

Developers expect to see a code change in seconds. For React Native that is
straightforward: Metro runs on the Windows PC and serves new JavaScript to the
simulator through the tunnel (FR-SIM-09, R2).

Flutter is harder. Hot reload needs the Flutter tool attached to the running
app, and in Mode B the app runs on the runner while the source files are edited
on the PC. It looks feasible (sync the changed `.dart` files to the runner,
then signal the attached Flutter tool to reload), but it is unproven, and it
could absorb a lot of time if it turns out to be fragile.

## Decision

Flutter hot reload on the runner is a **Should**, scheduled for **R3**, and
starts with a **timeboxed spike** that gives a go or no-go early in R3. The
fallback order when reload fails is: hot restart, then a normal rebuild.

## Consequences

- R1 and R2 are not blocked by an uncertain feature; Flutter users rebuild to
  see changes until R3.
- If the spike says no-go, FR-SIM-10 is dropped or deferred and the rebuild
  path stays as the answer, with no redesign.
- If it says go, the session job must also check out the commit and restore a
  Flutter SDK, which adds start-up time and a new endpoint (`POST /sync`) that
  writes files on the runner and so needs careful input checks.
- The saved build for this path must be a debug build, since hot reload does not
  work on release builds.
