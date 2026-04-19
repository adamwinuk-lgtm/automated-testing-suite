# Automated Testing Suite (ats)

## What This Is

`ats` is a CLI tool that replaces the agentic team's manual build-validator and app-validator checklists. Projects call `ats run <path>` and get a fully automated, multi-language quality gate pipeline with console, JSON, and HTML output.

**Supported project types** (auto-detected, no config required in caller):
- Node.js / TypeScript
- Python
- React / frontend
- Docker / shell

## Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Watch mode (tsx watch src/cli.ts)
pnpm build            # Compile to dist/ (tsup)
pnpm test             # Run Vitest test suite
pnpm lint             # ESLint
pnpm typecheck        # tsc --noEmit
```

## Running the Tool

```bash
# After build:
node dist/cli.js run <project-path>

# Common options:
node dist/cli.js run <path> --skip e2e,performance
node dist/cli.js run <path> --only lint,typecheck,tests
node dist/cli.js run <path> --no-fail-fast
node dist/cli.js run <path> --report-dir ./custom-reports

# After linking globally (pnpm link --global):
ats run <path>
```

## Gate Execution Order

1. `lint` — eslint (TS/React), ruff (Python)
2. `typecheck` — tsc --noEmit (TS), mypy (Python)
3. `tests` — vitest/jest (TS/React), pytest (Python)
4. `build` — npm/pnpm run build (skipped for Python/Docker)
5. `audit` — npm audit (Node), pip-audit (Python)
6. `ci-config` — verify .github/workflows/ci.yml includes required steps
7. `e2e` — Playwright (web projects only)
8. `security` — Semgrep (all), bandit (Python)
9. `performance` — Lighthouse (web), k6 (APIs) — opt-in via `--include-perf`

## Agentic Team

This project uses the full agentic team workflow. See `~/.claude/CLAUDE.md` (global) for the complete agent roster and sprint playbook.

**Agent assignments for this project:**
- **Raj** — CLI logic, gate implementations, runner orchestration
- **Zara** — HTML reporter, console output styling
- **Marcus** — Gate architecture, type design, extension patterns
- **Maya** — Test coverage for gates and detectors
- **Jordan** — CI integration, GitHub Actions reusable workflow, pnpm link setup

## Sprint Approach

2-week sprints following `~/agentic-dev-team/SCRUM_PLAYBOOK.md`.

| Sprint | Scope |
|--------|-------|
| **0** | Scaffold — CLAUDE.md, settings.json, package.json, tsconfig, types, CLI skeleton |
| **1** | Node.js gates — lint, typecheck, tests, build, audit, ci-config + console reporter |
| **2** | Python + Docker gates — ruff, mypy, pytest, pip-audit, Docker health-check |
| **3** | E2E + security + performance — Playwright, Semgrep, bandit, Lighthouse, k6 |
| **4** | HTML reporter + CI — JSON/HTML output, GitHub Actions reusable workflow |

## Dogfooding Rule

After every sprint, run `ats run .` against this project before declaring the sprint complete. The suite must pass its own gates.

## Report Output

Reports are written to `./reports/` by default:
- `<project>-<timestamp>.json` — machine-readable full results
- `<project>-<timestamp>.html` — human-readable report

Console output is always printed regardless of format options.

## Architecture

```
src/
├── cli.ts          Commander.js entry point
├── runner.ts       Orchestrates gates sequentially
├── types.ts        GateResult, ProjectContext, RunConfig
├── detectors/      Project type detection
├── gates/          One file per gate
└── reporters/      console, json, html
```

See the approved plan at `~/.claude/plans/create-an-automated-testing-nifty-hickey.md` for full architecture detail.
