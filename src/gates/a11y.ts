import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import type { GateResult, ProjectContext } from '../types.js';

const AXE_DEPS = [
  '@axe-core/playwright',
  '@axe-core/react',
  'axe-core',
  'jest-axe',
  'vitest-axe',
];

const PLAYWRIGHT_CONFIGS = [
  'playwright.config.ts',
  'playwright.config.js',
  'playwright.config.mjs',
];

function hasPlaywrightConfig(rootPath: string): boolean {
  return PLAYWRIGHT_CONFIGS.some((f) => existsSync(join(rootPath, f)));
}

function detectAxeDep(rootPath: string): string | null {
  const pkgPath = join(rootPath, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    return AXE_DEPS.find((dep) => dep in allDeps) ?? null;
  } catch {
    return null;
  }
}

function playwrightGrepCmd(ctx: ProjectContext): [string, string[]] {
  const baseArgs = ['playwright', 'test', '--grep', 'a11y|axe|accessibility'];
  if (ctx.packageManager === 'pnpm') return ['pnpm', ['exec', ...baseArgs]];
  if (ctx.packageManager === 'yarn') return ['yarn', baseArgs];
  return ['npx', baseArgs];
}

export async function runA11y(ctx: ProjectContext): Promise<GateResult> {
  const isWeb = ctx.types.includes('react') || ctx.types.includes('nodejs');
  if (!isWeb) return { gate: 'a11y', status: 'SKIP', duration: 0 };

  const axeDep = detectAxeDep(ctx.rootPath);
  if (!axeDep) {
    return {
      gate: 'a11y',
      status: 'SKIP',
      duration: 0,
      fix: 'No axe-core dependency found. Run: npm install -D @axe-core/playwright to enable a11y checks.',
    };
  }

  if (!hasPlaywrightConfig(ctx.rootPath)) {
    return {
      gate: 'a11y',
      status: 'WARN',
      duration: 0,
      output: `${axeDep} is installed but no Playwright config found.`,
      fix: 'Run: npx playwright init to set up Playwright, then add a11y tests using @axe-core/playwright.',
    };
  }

  const start = Date.now();
  const [cmd, args] = playwrightGrepCmd(ctx);

  try {
    const result = await execa(cmd, args, { cwd: ctx.rootPath, reject: false });
    const duration = Date.now() - start;
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');

    if (result.exitCode === 0) {
      // No a11y test files matched the grep pattern
      if (/0 passed|No tests found/i.test(combined)) {
        return {
          gate: 'a11y',
          status: 'WARN',
          duration,
          output: `${axeDep} is installed but no a11y tests found matching /a11y|axe|accessibility/.`,
          fix: 'Add accessibility tests using @axe-core/playwright. Tag tests with "a11y" in their title.',
        };
      }
      return {
        gate: 'a11y',
        status: 'PASS',
        duration,
        output: 'All a11y tests passed',
      };
    }

    const failLines = combined
      .split('\n')
      .filter((l) => /FAILED|Error|violation|×/.test(l))
      .slice(0, 10);

    return {
      gate: 'a11y',
      status: 'FAIL',
      duration,
      output: combined,
      errors: failLines.length ? failLines : [`a11y tests failed (exit ${result.exitCode})`],
      fix: 'Fix accessibility violations. Run: npx playwright test --grep "a11y|axe|accessibility" for details.',
    };
  } catch (err) {
    const msg = String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      return {
        gate: 'a11y',
        status: 'WARN',
        duration: Date.now() - start,
        fix: 'Playwright is not installed. Run: npm install -D @playwright/test',
      };
    }
    return { gate: 'a11y', status: 'FAIL', duration: Date.now() - start, errors: [msg] };
  }
}
