# automated-testing-suite (ats)

A multi-language quality gate CLI that replaces manual build-validator and app-validator checklists. Point it at any project and get a fully automated pipeline with console, JSON, and HTML output.

## Install

```bash
npm install -g @falxdev/automated-testing-suite
```

Or for local dev (from this repo):

```bash
pnpm link --global
```

## Usage

```bash
ats run <project-path>
```

### Watch mode

Re-runs gates automatically when files change:

```bash
ats watch <project-path>
```

Uses debounced file watching — gates re-run 500ms after the last change.

### Init

Scaffold an `.ats.yml` config file in a project:

```bash
ats init [project-path]        # creates .ats.yml with auto-detected defaults
ats init [project-path] --force  # overwrite existing .ats.yml
```

### Options

| Flag | Description |
|------|-------------|
| `--skip <gates>` | Comma-separated gates to skip (e.g. `--skip e2e,performance`) |
| `--only <gates>` | Run only these gates (e.g. `--only lint,typecheck,tests`) |
| `--no-fail-fast` | Continue running after a gate fails |
| `--report-dir <dir>` | Output directory for JSON/HTML reports (default: `./reports`) |
| `--include-perf` | Include Lighthouse / k6 performance gate (opt-in) |
| `--parallel` | Run all active gates concurrently — faster on multi-core machines. Disables fail-fast. |
| `--test-store <dir>` | Append the full `RunResult` JSON to this directory after every run (trend tracking) |

### Examples

```bash
# Full pipeline against a project
ats run ~/projects/my-app

# Skip slow gates for a quick check
ats run . --skip e2e,security,performance

# Only run linting and type checking
ats run . --only lint,typecheck

# Keep going after failures, write reports to a custom dir
ats run . --no-fail-fast --report-dir ./ci-reports

# Include performance testing (Lighthouse / k6)
ats run . --include-perf

# Run all gates in parallel for faster CI
ats run . --parallel

# Save every run to a history directory for trend tracking
ats run . --test-store ./run-history
```

## Supported Project Types

Auto-detected — no config required in the caller project.

| Type | Detection |
|------|-----------|
| Node.js | `package.json` present |
| TypeScript | `tsconfig.json` present |
| React | `react` in `package.json` dependencies |
| Python | `pyproject.toml` or `requirements.txt` present |
| Docker | `Dockerfile` or `docker-compose.yml` present |

## Gate Pipeline

Gates run in this order (or concurrently with `--parallel`). Each gate is skipped automatically if it doesn't apply to the detected project type.

| # | Gate | Node/React | Python | Docker |
|---|------|-----------|--------|--------|
| 1 | `lint` | ESLint | Ruff | — |
| 2 | `typecheck` | `tsc --noEmit` | mypy | — |
| 3 | `tests` | vitest / jest | pytest | — |
| 4 | `build` | `npm run build` | — | `docker compose config` |
| 5 | `audit` | `npm audit` (workspace-aware) | pip-audit | — |
| 6 | `ci-config` | Checks `.github/workflows/` for required steps | — | — |
| 7 | `e2e` | Playwright (if config present) | — | — |
| 8 | `ui-behavior` | Playwright UI behavior tests (`playwright test --reporter=json`) | — | — |
| 9 | `a11y` | axe-core accessibility tests (requires `axe-playwright` or `@axe-core/playwright`) | — | — |
| 10 | `security` | Semgrep | Bandit | — |
| 11 | `performance` | Lighthouse / k6 (opt-in via `--include-perf`) | — | — |

### Gate notes

- **audit**: In pnpm/npm/yarn workspaces, every workspace package is audited and results are aggregated.
- **ui-behavior**: Runs `playwright test --reporter=json`; parses structured pass/fail per test title. Skipped if no Playwright config is found.
- **a11y**: Runs `playwright test --grep "a11y|axe|accessibility"`; skipped if `axe-core` is not a dependency.
- **performance**: Opt-in only — pass `--include-perf` to activate.

## Verdicts

| Verdict | Meaning |
|---------|---------|
| ✅ **PASS** | All gates passed |
| ⚠️ **CONDITIONAL PASS** | Some gates warned (tool not installed, no tests found, etc.) |
| ❌ **FAIL** | One or more gates failed |

## Report Output

Every run writes two files to `./reports/` (configurable with `--report-dir`):

- `<project>-<timestamp>.json` — machine-readable full results
- `<project>-<timestamp>.html` — dark-themed human-readable report with fix hints

### Test Store (trend tracking)

Pass `--test-store <dir>` to also append a `RunResult` JSON to a history directory:

```bash
ats run . --test-store ./run-history
```

Each run creates a file named `<project-slug>-<timestamp>.json`. The directory accumulates one file per run — use these for dashboards, trend graphs, or regression detection.

## CI Integration

### GitHub Actions (reusable workflow)

```yaml
# .github/workflows/ci.yml
jobs:
  quality:
    uses: your-org/automated-testing-suite/.github/workflows/ats-reusable.yml@main
    with:
      project-path: .
      skip: e2e,performance
      fail-on-warn: false
```

**Inputs:**

| Input | Default | Description |
|-------|---------|-------------|
| `project-path` | `.` | Path to the project to test |
| `skip` | `""` | Comma-separated gates to skip |
| `node-version` | `20` | Node.js version for the runner |
| `ats-version` | `latest` | npm version of `automated-testing-suite` to install |
| `fail-on-warn` | `false` | Exit 1 on CONDITIONAL_PASS |

**Outputs:** `verdict` — `PASS`, `CONDITIONAL_PASS`, or `FAIL`

### Inline GitHub Actions step

```yaml
- name: Install ats
  run: npm install -g @falxdev/automated-testing-suite

- name: Run quality gates
  run: ats run . --skip e2e,performance
```

## Local Development

```bash
git clone https://github.com/adamwinuk-lgtm/automated-testing-suite
cd automated-testing-suite
pnpm install
pnpm dev          # watch mode
pnpm test         # vitest (200 tests)
pnpm build        # compile to dist/
pnpm lint
pnpm typecheck
```

## Requirements

- Node.js ≥ 20
- Gates use external tools only when present — `ats` never fails because a tool isn't installed (it warns instead)

## License

MIT
