# ADR 0003: Android is R4

- Status: Accepted
- Date: 2026-11-13
- Requirements: FR-AND-01 to 17, NFR-MNT-01
- Design: SDS 3.14, 4.8

## Context

SimBridge exists to solve one hard problem: iOS development without a Mac.
Android does not have that problem, because Google's SDK, emulator and build
tools already run on Windows. Android support is still useful, since Flutter
and React Native apps target both platforms and agents could use the same tools
for both. Project time is limited.

## Decision

Android support is planned for release **R4**, after all iOS releases, and is
built **only if time allows**. It runs fully on the Windows PC (C13: Android
Setup Manager, Android Build Runner and Emulator Backend), with no runner, no
tunnel and no GitHub minutes.

## Consequences

- R0 to R3 focus entirely on iOS, where the project's value and risk are.
- The `DeviceBackend` interface must stay platform-neutral, so an Android
  backend can be added later without changing any agent tool (NFR-MNT-01).
- If time runs out, the project is still complete without Android.
- Nothing Android-specific is built or installed before R4.
