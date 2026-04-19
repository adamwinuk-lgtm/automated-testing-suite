# automated-testing-suite (ats)

A multi-language quality gate CLI that replaces manual build-validator and app-validator checklists. Point it at any project and get a fully automated pipeline with console, JSON, and HTML output.

## Install

```bash
npm install -g automated-testing-suite
```

Or for local dev (from this repo):

```bash
pnpm link --global
```

## Usage

```bash
ats run <project-path>
```

### Options

| Flag | Description |
|------|-------------|
| `--skip <gates>` | Comma-separated gates to skip (e.g. `--skip e2e,performance`) |
| `--only <gates>` | Run only these gates (e.g. `--only lint,typecheck,tests`) |
| `--no-fail-fast` | Continue running after a gate fails |
| `--report-dir <dir>` | Output directory for JSON/HTML reports (default: `./reports`) |
| `--include-perf` | Include Lighthouse / k6 performance gate (opt-in) |

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

Gates run in this order. Each gate is skipped automatically if it doesn't apply to the detected project type.

| # | Gate | Node/React | Python | Docker |
|---|------|-----------|--------|--------|
| 1 | `lint` | ESLint | Ruff | — |
| 2 | `typecheck` | `tsc --noEmit` | mypy | — |
| 3 | `tests` | vitest / jest | pytest | — |
| 4 | `build` | `npm run build` | — | `docker compose config` |
| 5 | `audit` | `npm audit` | pip-audit | — |
| 6 | `ci-config` | Checks `.github/workflows/` for required steps | | |
| 7 | `e2e` | Playwright (if config present) | — | — |
| 8 | `security` | Semgrep | Bandit | — |
| 9 | `performance` | Lighthouse / k6 (opt-in) | — | — |

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
  run: npm install -g automated-testing-suite

- name: Run quality gates
  run: ats run . --skip e2e,performance
```

## Local Development

```bash
git clone https://github.com/adamwinuk-lgtm/automated-testing-suite
cd automated-testing-suite
pnpm install
pnpm dev          # watch mode
pnpm test         # vitest (91 tests)
pnpm build        # compile to dist/
pnpm lint
pnpm typecheck
```

## Requirements

- Node.js ≥ 20
- Gates use external tools only when present — `ats` never fails because a tool isn't installed (it warns instead)

## License

MIT
