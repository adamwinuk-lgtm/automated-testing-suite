import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import type { GateResult, ProjectContext } from '../types.js';

const LHCI_CONFIGS = [
  '.lighthouserc.js',
  '.lighthouserc.cjs',
  '.lighthouserc.json',
  'lighthouserc.js',
  'lighthouserc.json',
];

const K6_DIRS = ['k6', 'tests/k6', 'perf'];

function hasLhciConfig(rootPath: string): boolean {
  return LHCI_CONFIGS.some((f) => existsSync(join(rootPath, f)));
}

function findK6Script(rootPath: string): string | null {
  for (const dir of K6_DIRS) {
    const fullDir = join(rootPath, dir);
    if (!existsSync(fullDir)) continue;
    try {
      const scripts = readdirSync(fullDir).filter((f) => f.endsWith('.js'));
      if (scripts.length > 0) return join(fullDir, scripts[0]);
    } catch {
      // ignore unreadable dirs
    }
  }
  return null;
}

async function runLhci(ctx: ProjectContext): Promise<GateResult> {
  const start = Date.now();
  try {
    const result = await execa('lhci', ['autorun'], { cwd: ctx.rootPath, reject: false });
    const duration = Date.now() - start;
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');

    if (result.exitCode === 0) return { gate: 'performance', status: 'PASS', duration };

    return {
      gate: 'performance',
      status: 'FAIL',
      duration,
      output: combined,
      errors: combined
        .split('\n')
        .filter((l) => /failed|error/i.test(l))
        .slice(0, 10),
      fix: 'Review Lighthouse CI results. Run: lhci autorun for full output.',
    };
  } catch (err) {
    const msg = String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      return {
        gate: 'performance',
        status: 'WARN',
        duration: Date.now() - start,
        fix: 'lhci is not installed. Run: npm install -g @lhci/cli',
      };
    }
    return { gate: 'performance', status: 'FAIL', duration: Date.now() - start, errors: [msg] };
  }
}

async function runK6(scriptPath: string, ctx: ProjectContext): Promise<GateResult> {
  const start = Date.now();
  try {
    const result = await execa('k6', ['run', scriptPath], {
      cwd: ctx.rootPath,
      reject: false,
    });
    const duration = Date.now() - start;
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');

    if (result.exitCode === 0) return { gate: 'performance', status: 'PASS', duration };

    return {
      gate: 'performance',
      status: 'FAIL',
      duration,
      output: combined,
      errors: combined
        .split('\n')
        .filter((l) => /FAIL|error/i.test(l))
        .slice(0, 10),
      fix: 'Review k6 thresholds and failures.',
    };
  } catch (err) {
    const msg = String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      return {
        gate: 'performance',
        status: 'WARN',
        duration: Date.now() - start,
        fix: 'k6 is not installed. See: https://grafana.com/docs/k6/latest/set-up/install-k6/',
      };
    }
    return { gate: 'performance', status: 'FAIL', duration: Date.now() - start, errors: [msg] };
  }
}

export async function runPerformance(ctx: ProjectContext): Promise<GateResult> {
  const isWeb = ctx.types.includes('nodejs') || ctx.types.includes('react');
  if (!isWeb) return { gate: 'performance', status: 'SKIP', duration: 0 };

  if (hasLhciConfig(ctx.rootPath)) return runLhci(ctx);

  const k6Script = findK6Script(ctx.rootPath);
  if (k6Script) return runK6(k6Script, ctx);

  return {
    gate: 'performance',
    status: 'SKIP',
    duration: 0,
    fix: 'No performance config found. Add .lighthouserc.json for Lighthouse CI or k6/ directory for k6.',
  };
}
