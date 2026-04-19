import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import type { GateResult, ProjectContext } from '../types.js';

function hasPytestConfig(rootPath: string): boolean {
  if (existsSync(join(rootPath, 'pytest.ini')) || existsSync(join(rootPath, 'conftest.py'))) return true;
  const pyproject = join(rootPath, 'pyproject.toml');
  if (!existsSync(pyproject)) return false;
  try {
    return readFileSync(pyproject, 'utf8').includes('[tool.pytest');
  } catch {
    return false;
  }
}

async function runPytest(ctx: ProjectContext): Promise<GateResult> {
  if (!hasPytestConfig(ctx.rootPath)) {
    return {
      gate: 'tests',
      status: 'WARN',
      duration: 0,
      fix: 'No pytest config found. Add [tool.pytest.ini_options] to pyproject.toml or create conftest.py.',
    };
  }

  const start = Date.now();
  try {
    const result = await execa('pytest', [], { cwd: ctx.rootPath, reject: false });
    const duration = Date.now() - start;
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');

    if (result.exitCode === 0) return { gate: 'tests', status: 'PASS', duration };

    if (result.exitCode === 5) {
      return {
        gate: 'tests',
        status: 'WARN',
        duration,
        fix: 'No tests collected by pytest. Add test files matching test_*.py pattern.',
      };
    }

    const failLines = combined
      .split('\n')
      .filter((l) => /FAILED|ERROR/.test(l))
      .slice(0, 10);

    return {
      gate: 'tests',
      status: 'FAIL',
      duration,
      output: combined,
      errors: failLines.length ? failLines : undefined,
      fix: 'Fix failing tests shown above.',
    };
  } catch (err) {
    return {
      gate: 'tests',
      status: 'FAIL',
      duration: Date.now() - start,
      errors: [String(err)],
    };
  }
}

function readPackageJson(rootPath: string): Record<string, unknown> | null {
  const pkgPath = join(rootPath, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return null;
  }
}

function testCmd(ctx: ProjectContext): [string, string[]] {
  if (ctx.packageManager === 'pnpm') return ['pnpm', ['test']];
  if (ctx.packageManager === 'yarn') return ['yarn', ['test']];
  return ['npm', ['test']];
}

function parseTestSummary(output: string): { passed: number; failed: number } | null {
  // vitest: "Tests  3 passed (3)" or "Tests  1 failed | 2 passed (3)"
  const vitestMatch = output.match(/Tests\s+(\d+)\s+failed.*?(\d+)\s+passed|Tests\s+(\d+)\s+passed/);
  if (vitestMatch) {
    const failed = parseInt(vitestMatch[1] ?? '0');
    const passed = parseInt(vitestMatch[2] ?? vitestMatch[3] ?? '0');
    return { passed, failed };
  }
  // jest: "Tests: 1 failed, 2 passed, 3 total"
  const jestMatch = output.match(/Tests:\s+(?:(\d+)\s+failed,\s+)?(\d+)\s+passed/);
  if (jestMatch) {
    const failed = parseInt(jestMatch[1] ?? '0');
    const passed = parseInt(jestMatch[2] ?? '0');
    return { passed, failed };
  }
  return null;
}

export async function runTests(ctx: ProjectContext): Promise<GateResult> {
  if (ctx.types.includes('python')) return runPytest(ctx);
  const isNode = ctx.types.includes('nodejs') || ctx.types.includes('react');
  if (!isNode) return { gate: 'tests', status: 'SKIP', duration: 0 };

  const pkg = readPackageJson(ctx.rootPath);
  if (!pkg) return { gate: 'tests', status: 'SKIP', duration: 0 };

  const scripts = pkg.scripts as Record<string, string> | undefined;
  if (!scripts?.test) {
    return {
      gate: 'tests',
      status: 'WARN',
      duration: 0,
      fix: 'No "test" script found in package.json. Add one to enable test validation.',
    };
  }

  const start = Date.now();
  const [cmd, args] = testCmd(ctx);
  try {
    const result = await execa(cmd, args, { cwd: ctx.rootPath, reject: false });
    const duration = Date.now() - start;
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
    const summary = parseTestSummary(combined);

    if (result.exitCode === 0) {
      const passMsg = summary ? `${summary.passed} test(s) passed` : undefined;
      return { gate: 'tests', status: 'PASS', duration, output: passMsg };
    }

    const failLines = combined
      .split('\n')
      .filter((l) => /✗|×|FAIL|failed/.test(l))
      .slice(0, 10);

    return {
      gate: 'tests',
      status: 'FAIL',
      duration,
      output: combined,
      errors: failLines.length ? failLines : undefined,
      fix: 'Fix failing tests shown above.',
    };
  } catch (err) {
    return {
      gate: 'tests',
      status: 'FAIL',
      duration: Date.now() - start,
      errors: [String(err)],
    };
  }
}
