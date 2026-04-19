# ATS Onboarding Guide

How to set up a project so that `ats run <path>` produces a full PASS with no skips or warnings.

---

## Prerequisites (one-time, machine-level)

These must be installed globally on your Mac before `ats` can run all gates.

```bash
# ATS itself
pnpm link --global   # run from the automated-testing-suite directory

# Security gate
brew install semgrep

# Verify
ats --version
semgrep --version
```

---

## Gate-by-gate setup checklist

Work through each gate in order. After completing all steps, run `ats run <path>` to verify.

---

### 1. lint

**What it checks:** ESLint (Node/React) or Ruff (Python)

**Node / React — what's needed:**
- An ESLint config file in the project root
- ESLint installed as a dev dependency

```bash
cd <your-project>
npm install -D eslint @eslint/js
```

Create `eslint.config.js` in the project root:
```js
import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    rules: {
      // add your rules here
    },
  },
];
```

For a TypeScript project, also install the TypeScript parser:
```bash
npm install -D @typescript-eslint/eslint-plugin @typescript-eslint/parser
```

Then extend your `eslint.config.js`:
```js
import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parser: tsParser },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
    },
  },
];
```

**Monorepo note:** If your project has a root `package.json` that delegates to `client/` and `server/` sub-packages, add a `"lint"` script in the root that runs both:
```json
"scripts": {
  "lint": "npm run lint --prefix server && npm run lint --prefix client"
}
```
ATS runs `npx eslint .` from the root — it will pick up the root `eslint.config.js` and lint all files. Each sub-package can have its own config too.

**Verify:**
```bash
npx eslint .
```

---

### 2. typecheck

**What it checks:** `tsc --noEmit` (Node/TypeScript/React) or mypy (Python)

**Node / TypeScript — what's needed:**
- A `tsconfig.json` in the project root
- TypeScript installed as a dev dependency

```bash
npm install -D typescript
npx tsc --init
```

Edit `tsconfig.json` to match your project. A typical web project:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

**Monorepo note:** If the project has separate `client/` and `server/` TypeScript configs, add a root-level `typecheck` script that runs both:
```json
"scripts": {
  "typecheck": "npx tsc --noEmit --project server/tsconfig.json && npx tsc --noEmit --project client/tsconfig.json"
}
```
ATS detects `tsconfig.json` in the root and runs `npx tsc --noEmit` — it will use the root config. If there is no root config, it falls back to looking for `typecheck` in your scripts.

**Verify:**
```bash
npx tsc --noEmit
```

---

### 3. tests

**What it checks:** Runs `npm test` (or `pnpm test` / `yarn test`) and expects exit code 0

**What's needed:**
- A `"test"` script in `package.json`
- At least one test file that the runner can find

**Install a test runner (vitest recommended for modern projects):**
```bash
npm install -D vitest
```

Add to `package.json`:
```json
"scripts": {
  "test": "vitest run"
}
```

Create a test file, e.g. `src/utils.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('example', () => {
  it('passes', () => {
    expect(1 + 1).toBe(2);
  });
});
```

**Monorepo note:** Your root `"test"` script should run tests across all sub-packages:
```json
"scripts": {
  "test": "npm test --prefix server && npm test --prefix client"
}
```

**Verify:**
```bash
npm test
```

---

### 4. build

**What it checks:** Runs `npm run build` and expects exit code 0

**What's needed:**
- A `"build"` script in `package.json`

Most projects already have this. If not:
```json
"scripts": {
  "build": "tsc"
}
```

For a Vite/React project it will be `"build": "vite build"`. For an Express server, `"build": "tsc"` or `"build": "tsup"`.

**Verify:**
```bash
npm run build
```

---

### 5. audit

**What it checks:** `npm audit` — looks for known vulnerabilities in dependencies

**What's needed:** Nothing — runs automatically on any Node.js project.

ATS treats HIGH/CRITICAL vulnerabilities as FAIL, MODERATE as WARN. To clear warnings:
```bash
npm audit fix
```

For vulnerabilities that can't be auto-fixed, document them in `ISSUES.md` and use:
```bash
npm audit --audit-level=critical   # only fail on critical
```

---

### 6. ci-config

**What it checks:** That a `.github/workflows/*.yml` file exists and contains steps for: `lint`, `typecheck`, `test`, `build`, `audit`

**What's needed:** Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm install

      - name: lint
        run: npm run lint

      - name: typecheck
        run: npm run typecheck

      - name: test
        run: npm test

      - name: build
        run: npm run build

      - name: audit
        run: npm audit --audit-level=critical
```

**Note:** ATS scans the workflow file for the words `lint`, `typecheck`, `test`, `build`, and `audit`. As long as those words appear somewhere in the file (step names or run commands), the gate passes.

**Verify:**
```bash
cat .github/workflows/ci.yml   # confirm it exists and looks right
```

---

### 7. e2e (optional)

**What it checks:** Playwright tests, if a config file is present

**When to add:** Only if your project has a frontend with user journeys worth automating.

**Setup:**
```bash
npm install -D @playwright/test
npx playwright install
npx playwright init
```

This creates `playwright.config.ts`. ATS detects it automatically and runs `npx playwright test`.

If you don't add Playwright, this gate stays as SKIP — which does not affect your verdict.

---

### 8. security

**What it checks:** Semgrep (Node/React) or Bandit (Python) — static security analysis

**What's needed:** Semgrep installed on your Mac (one-time):
```bash
brew install semgrep
```

No project-level config is needed. ATS runs `semgrep --config=auto .` which downloads and applies community rules automatically.

**Note:** The first run downloads rule packs and may be slow. Subsequent runs use cache.

**Verify:**
```bash
semgrep --config=auto .
```

---

## Full verification

Once all gates are set up:

```bash
ats run <your-project-path>
```

Expected output:
```
ATS — your-project
Detected: nodejs
────────────────────────────────────────────────────
  [PASS]  lint
  [PASS]  typecheck
  [PASS]  tests
  [PASS]  build
  [PASS]  audit
  [PASS]  ci-config
  [SKIP]  e2e          ← only if no playwright.config.ts
  [PASS]  security
────────────────────────────────────────────────────
   ✅  PASS
```

---

## Monorepo projects (client + server)

Projects like `budget-manager` have a root `package.json` that delegates to sub-packages. ATS runs from the root, so your root scripts must cover everything:

```json
"scripts": {
  "lint":      "npm run lint --prefix server && npm run lint --prefix client",
  "typecheck": "npm run typecheck --prefix server && npm run typecheck --prefix client",
  "test":      "npm test --prefix server && npm test --prefix client",
  "build":     "npm run build --prefix server && npm run build --prefix client"
}
```

Sub-packages each need their own ESLint config and tsconfig — but tests can live wherever makes sense (typically in `server/` and `client/` separately).

---

## Quick reference — what triggers each gate

| Gate | Trigger | Skips when |
|------|---------|-----------|
| lint | `eslint.config.js` (or `.eslintrc.*`) in root | No config file found |
| typecheck | `tsconfig.json` in root | No tsconfig found |
| tests | `"test"` script in `package.json` | No test script |
| build | `"build"` script in `package.json` | No build script |
| audit | Always runs | Never skipped |
| ci-config | Always runs | Never skipped (warns if no workflow) |
| e2e | `playwright.config.ts` (or `.js`) in root | No playwright config |
| security | Always runs | Docker-only projects |

---

## Common issues

**lint SKIPs even though ESLint is installed**
→ The config file must be in the project root, not only in a sub-package.

**typecheck SKIPs even though TypeScript is installed**
→ `tsconfig.json` must be in the project root. If it's only in `client/` or `server/`, ATS won't find it.

**tests WARNs with "no test script"**
→ Check that `"test"` is in the `scripts` section of the root `package.json` (not just a sub-package).

**security WARNs with "semgrep not installed"**
→ Run `brew install semgrep`. It's a machine-level tool, not a project dependency.

**ci-config FAILs after adding the workflow**
→ Make sure the words `lint`, `typecheck`, `test`, `build`, and `audit` appear somewhere in the YAML (in step names or `run:` commands).
