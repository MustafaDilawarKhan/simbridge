# Contributing to SimBridge

Thanks for helping. This page explains how work moves from an idea to `main`.
Read [CLAUDE.md](CLAUDE.md) first: it is the project rulebook and holds the
current phase and the hard rules.

## The short version

1. Pick or open an issue.
2. Create a branch from `main`.
3. Make small commits, with tests.
4. Run the checks locally.
5. Open a pull request and fill in the template.

Nobody pushes straight to `main`. Every change arrives through a pull request
with green CI.

## Branch names

Use `<type>/<short-description>` in lower case with hyphens.

| Type     | Use it for                              | Example                  |
| -------- | --------------------------------------- | ------------------------ |
| `feat/`  | A new feature or module                 | `feat/c2-stack-detector` |
| `fix/`   | A bug fix                               | `fix/idle-timer-reset`   |
| `docs/`  | Documentation only                      | `docs/srs-r1-gate`       |
| `chore/` | Tooling, CI, dependencies               | `chore/foundation`       |
| `test/`  | Tests only                              | `test/fingerprint-edge`  |
| `spike/` | Throwaway experiments (under `spikes/`) | `spike/r0-sim-stream`    |

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<optional scope>): <what changed, in the imperative>

<optional body: why, not how>
```

- Types: `feat`, `fix`, `docs`, `test`, `chore`, `ci`, `refactor`.
- Keep commits small. Each commit should leave the tests passing.
- Put the requirement ID in the message when the change comes from the SRS.

Examples:

```
feat(spike): idle exit FR-SIM-06
test(core): matching fingerprint reuses the saved build FR-BLD-02
docs(sds): session token moves to a cookie (ADR 0008)
```

## How requirement IDs are used

Every requirement in [docs/SRS.md](docs/SRS.md) has an ID, for example
`FR-SIM-06` (functional) or `NFR-PERF-02` (non-functional). The IDs tie the
documents, the code and the tests together, so anyone can trace a rule from the
SRS to the line that implements it.

- **Before you start a module**, read its section in [docs/SDS.md](docs/SDS.md)
  and the requirement IDs it lists.
- **In commits:** name the ID the change implements (see above).
- **In tests:** name the test after the requirement it proves, for example
  `it('FR-SIM-06 ends the session after the idle timeout')`.
- **In code:** add a short comment where a rule comes from the SRS, for example
  `// FR-SIM-06 idle shutdown`.
- **In pull requests:** list the IDs in the template.

If the code has to differ from the SRS or SDS, update the document **in the
same pull request** and say why. The docs and the code must never drift apart
silently. A decision that changes the design also gets a new record in
[docs/adr/](docs/adr/README.md) and a line in the decisions log in `CLAUDE.md`.

## Run the checks before you push

```bash
npm run format      # fix formatting (CI runs format:check)
npm run lint
npm run typecheck
npm test
```

CI runs the same four checks on every pull request.

## Pull request checklist

- [ ] The branch name and commit messages follow the rules above.
- [ ] Format, lint, typecheck and tests pass locally.
- [ ] New logic has tests, named after the requirement IDs they prove.
- [ ] Requirement IDs are listed in the pull request.
- [ ] SRS, SDS, ADRs and `CLAUDE.md` are updated if behaviour or design changed.
- [ ] No secrets, tokens, tunnel URLs or `.env` files are in the diff.
- [ ] No new dependency, workflow permission or runner-minute cost without
      agreement in the issue first.

## Hard rules

The full list is in [CLAUDE.md](CLAUDE.md). The ones that catch people out:

- Every runner job must end on its own (idle timeout, hard cap and
  `timeout-minutes`).
- Never print secrets, tokens or tunnel URLs in logs.
- Standard runners only (`macos-latest`).
- Ask before anything that costs runner minutes.

## Adding a dependency

Open or comment on an issue first and say what the package is for. Add it with
`npm install <name> -w <workspace>` (or `--save-dev` at the root for tooling),
and commit `package-lock.json` with it.
