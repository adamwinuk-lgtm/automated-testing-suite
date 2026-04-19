import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import type { GateResult, ProjectContext } from '../types.js';

const PLAYWRIGHT_CONFIGS = [
  'playwright.config.ts',
  'playwright.config.js',
  'playwright.config.mjs',
];

function hasPlaywrightConfig(rootPath: string): boolean {
  return PLAYWRIGHT_CONFIGS.some((f) => existsSync(join(rootPath, f)));
}

function playwrightCmd(ctx: ProjectContext): [string, string[]] {
  if (ctx.packageManager === 'pnpm') return ['pnpm', ['exec', 'playwright', 'test']];
  if (ctx.packageManager === 'yarn') return ['yarn', ['playwright', 'test']];
  return ['npx', ['playwright', 'test']];
}

export async function runE2e(ctx: ProjectContext): Promise<GateResult> {
  const isWeb = ctx.types.includes('nodejs') || ctx.types.includes('react');
  if (!isWeb) return { gate: 'e2e', status: 'SKIP', duration: 0 };

  if (!hasPlaywrightConfig(ctx.rootPath)) {
    return {
      gate: 'e2e',
      status: 'SKIP',
      duration: 0,
      fix: 'No Playwright config found. Run: npx playwright init to set up E2E tests.',
    };
  }

  const start = Date.now();
  const [cmd, args] = playwrightCmd(ctx);
  try {
    const result = await execa(cmd, args, { cwd: ctx.rootPath, reject: false });
    const duration = Date.now() - start;
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');

    if (result.exitCode === 0) return { gate: 'e2e', status: 'PASS', duration };

    const failLines = combined
      .split('\n')
      .filter((l) => /FAILED|Error|×/.test(l))
      .slice(0, 10);

    return {
      gate: 'e2e',
      status: 'FAIL',
      duration,
      output: combined,
      errors: failLines.length ? failLines : undefined,
      fix: 'Fix failing E2E tests. Run: npx playwright test for full output.',
    };
  } catch (err) {
    const msg = String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      return {
        gate: 'e2e',
        status: 'WARN',
        duration: Date.now() - start,
        fix: 'Playwright is not installed. Run: npm install -D @playwright/test',
      };
    }
    return { gate: 'e2e', status: 'FAIL', duration: Date.now() - start, errors: [msg] };
  }
}
