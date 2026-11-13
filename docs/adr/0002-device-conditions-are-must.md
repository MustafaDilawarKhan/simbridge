# ADR 0002: Device conditions are Must

- Status: Accepted
- Date: 2026-11-13
- Requirements: FR-CND-01 to 23
- Design: SDS 3.11, 4.7

## Context

Many mobile bugs appear only in real-world situations: a slow or missing
network, a different city, a push notification arriving, or a permission the
user denied. A tool that only shows the app under perfect conditions lets those
bugs reach users. Device conditions (network profile, GPS location, push
notifications, permissions) could have been treated as a nice extra to add
later.

## Decision

Device conditions are compulsory (priority **Must**) and every run mode must
support them through the Conditions Controller (C11). The work is split by
release:

- **R1:** location, push and permissions on the cloud simulator (Mode B), using
  `xcrun simctl`.
- **R2:** network shaping on the runner, and all conditions on a real iPhone
  (Mode A).

## Consequences

- C11 and its MCP tools are part of R1, not an afterthought, so the
  `DeviceBackend` interface carries condition methods from the start.
- Network shaping on the runner is the risky part: the rules must never touch
  the tunnel or GitHub traffic, or the session cuts itself off. This is a hard
  rule in `CLAUDE.md`, and a watchdog lifts all rules when the session ends.
- Some conditions cannot be done everywhere (for example, permissions cannot be
  revoked on a real iPhone without reinstalling the app); the tools must report
  that clearly.
