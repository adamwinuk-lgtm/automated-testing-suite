import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import type { GateResult, ProjectContext } from '../types.js';

const PLAYWRIGHT_CONFIGS = [
  'playwright.config.ts',
  'playwright.config.js',
  'playwright.config.mjs',
];

interface PlaywrightStats {
  expected?: number;
  unexpected?: number;
  skipped?: number;
  flaky?: number;
}

interface PlaywrightSuite {
  title?: string;
  suites?: PlaywrightSuite[];
  tests?: PlaywrightTest[];
}

interface PlaywrightTest {
  title?: string;
  status?: string;
  results?: Array<{ status: string; error?: { message?: string } }>;
}

interface PlaywrightJsonReport {
  stats?: PlaywrightStats;
  suites?: PlaywrightSuite[];
  errors?: Array<{ message?: string }>;
}

function hasPlaywrightConfig(rootPath: string): boolean {
  return PLAYWRIGHT_CONFIGS.some((f) => existsSync(join(rootPath, f)));
}

function playwrightCmd(ctx: ProjectContext): [string, string[]] {
  const baseArgs = ['playwright', 'test', '--reporter=json'];
  if (ctx.packageManager === 'pnpm') return ['pnpm', ['exec', ...baseArgs]];
  if (ctx.packageManager === 'yarn') return ['yarn', baseArgs];
  return ['npx', baseArgs];
}

function collectFailedTitles(suites: PlaywrightSuite[], prefix = ''): string[] {
  const titles: string[] = [];
  for (const suite of suites) {
    const suiteName = [prefix, suite.title].filter(Boolean).join(' › ');
    for (const test of suite.tests ?? []) {
      const lastResult = test.results?.at(-1);
      if (lastResult?.status === 'failed' || lastResult?.status === 'timedOut') {
        const msg = lastResult.error?.message?.split('\n')[0] ?? '';
        titles.push(`${suiteName} › ${test.title ?? ''}${msg ? `: ${msg}` : ''}`);
      }
    }
    titles.push(...collectFailedTitles(suite.suites ?? [], suiteName));
  }
  return titles;
}

function parseJsonReport(stdout: string): PlaywrightJsonReport | null {
  // Playwright JSON reporter sometimes emits non-JSON lines before the blob
  const jsonStart = stdout.indexOf('{');
  if (jsonStart === -1) return null;
  try {
    return JSON.parse(stdout.slice(jsonStart)) as PlaywrightJsonReport;
  } catch {
    return null;
  }
}

export async function runUiBehavior(ctx: ProjectContext): Promise<GateResult> {
  const isWeb = ctx.types.includes('nodejs') || ctx.types.includes('react');
  if (!isWeb) return { gate: 'ui-behavior', status: 'SKIP', duration: 0 };

  if (!hasPlaywrightConfig(ctx.rootPath)) {
    return {
      gate: 'ui-behavior',
      status: 'SKIP',
      duration: 0,
      fix: 'No Playwright config found. Run: npx playwright init to set up UI behavior tests.',
    };
  }

  const start = Date.now();
  const [cmd, args] = playwrightCmd(ctx);

  try {
    const result = await execa(cmd, args, { cwd: ctx.rootPath, reject: false });
    const duration = Date.now() - start;
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');

    const report = parseJsonReport(combined);

    if (result.exitCode === 0) {
      const passed = report?.stats?.expected ?? 0;
      const skipped = report?.stats?.skipped ?? 0;
      return {
        gate: 'ui-behavior',
        status: 'PASS',
        duration,
        output: `${passed} test(s) passed${skipped ? `, ${skipped} skipped` : ''}`,
      };
    }

    const failedTitles = report ? collectFailedTitles(report.suites ?? []) : [];
    const unexpected = report?.stats?.unexpected ?? failedTitles.length;

    return {
      gate: 'ui-behavior',
      status: 'FAIL',
      duration,
      output: combined,
      errors: failedTitles.length
        ? failedTitles.slice(0, 10)
        : [`${unexpected} test(s) failed`],
      fix: 'Fix failing UI behavior tests. Run: npx playwright test --reporter=json for full output.',
    };
  } catch (err) {
    const msg = String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      return {
        gate: 'ui-behavior',
        status: 'WARN',
        duration: Date.now() - start,
        fix: 'Playwright is not installed. Run: npm install -D @playwright/test',
      };
    }
    return { gate: 'ui-behavior', status: 'FAIL', duration: Date.now() - start, errors: [msg] };
  }
}
