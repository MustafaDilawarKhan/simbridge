# SimBridge

[![CI](https://github.com/MustafaDilawarKhan/simbridge/actions/workflows/ci.yml/badge.svg)](https://github.com/MustafaDilawarKhan/simbridge/actions/workflows/ci.yml)

SimBridge (working name) lets developers and AI agents build, run, test and
debug Flutter and React Native iOS apps from a Windows PC, with no Mac on the
desk. It uses GitHub Actions macOS runners for building and simulating, and a
USB-connected iPhone for zero-cost testing.

## Status: R0 proof of concept

Nothing here is usable yet. The project is in its first phase, **R0**, which
answers one question before any product code is written:

> Can an iOS simulator running on a GitHub macOS runner be streamed to a Windows
> PC through a Cloudflare quick tunnel with usable lag?

The gate to pass before R1 starts:

- under 3 minutes from simulator boot to a usable simulator,
- under 400 ms median tap lag,
- the MJPEG video stream and a WebSocket log stream both work through the tunnel.

| Phase | What it adds                                                 | State       |
| ----- | ------------------------------------------------------------ | ----------- |
| R0    | Proof of concept: simulator stream through a tunnel          | In progress |
| R1    | Cloud simulator (Mode B), smart builds, MCP tools, CLI       | Not started |
| R2    | Real iPhone over USB (Mode A), signing, stats, record/replay | Not started |
| R3    | Headless tests (Mode C), bug bundles, visual diff            | Not started |
| R4    | Android emulator on the PC, only if time allows              | Not started |

## How it will work

- **Mode A, real iPhone:** an iPhone on USB, controlled from Windows with go-ios
  and WebDriverAgent. Uses no runner minutes.
- **Mode B, cloud simulator:** a simulator on a GitHub macOS runner, streamed to
  the PC with serve-sim through an outbound tunnel.
- **Mode C, headless test:** a short runner job that runs a Maestro test flow.
- **Smart build:** native files are fingerprinted, and a saved build is reused
  when nothing native changed.
- **Agents:** an MCP server exposes the same tools whichever mode runs the app.

## Documentation

- [docs/SRS.md](docs/SRS.md): requirements. Every requirement has an ID such as
  `FR-SIM-06` or `NFR-PERF-02`.
- [docs/SDS.md](docs/SDS.md): design. Components C1 to C13, interfaces and
  workflows.
- [docs/adr/](docs/adr/README.md): Architecture Decision Records, one short file
  per decision.
- [CLAUDE.md](CLAUDE.md): the project rulebook: current phase, hard rules and the
  decisions log.

## Repository layout

```
packages/
  core/            core services (auth, stack detector, build, sessions, ...)
  backends/        device backends behind one DeviceBackend interface
  cli/             the simbridge command-line tool
  mcp/             MCP server for AI agents
  session-agent/   runs on the macOS runner during a session
  desktop/         Electron + React desktop app (built last)
docs/              SRS, SDS, decision records
```

The packages are empty skeletons until the R0 gate passes.

## Getting started for contributors

You need [Node.js](https://nodejs.org) 20 or newer and git. No Mac is needed.

```bash
git clone https://github.com/MustafaDilawarKhan/simbridge.git
cd simbridge
npm install
```

Then check that everything works:

```bash
npm run lint        # code problems
npm run typecheck   # TypeScript errors
npm test            # unit tests
npm run format      # fix formatting
npm run build       # compile all packages
```

Before you change anything, read [CONTRIBUTING.md](CONTRIBUTING.md) and
[CLAUDE.md](CLAUDE.md).

## Licence

[MIT](LICENSE)
