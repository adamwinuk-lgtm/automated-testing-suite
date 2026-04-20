import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import type { GateResult, ProjectContext } from '../types.js';

function tscCmd(ctx: ProjectContext): [string, string[]] {
  if (ctx.packageManager === 'pnpm') return ['pnpm', ['exec', 'tsc', '--noEmit']];
  if (ctx.packageManager === 'yarn') return ['yarn', ['tsc', '--noEmit']];
  return ['npx', ['tsc', '--noEmit']];
}

function typecheckScriptCmd(ctx: ProjectContext): [string, string[]] {
  if (ctx.packageManager === 'pnpm') return ['pnpm', ['run', 'typecheck']];
  if (ctx.packageManager === 'yarn') return ['yarn', ['typecheck']];
  return ['npm', ['run', 'typecheck']];
}

function hasMypyConfig(rootPath: string): boolean {
  if (existsSync(join(rootPath, 'mypy.ini')) || existsSync(join(rootPath, '.mypy.ini'))) return true;
  const pyproject = join(rootPath, 'pyproject.toml');
  if (!existsSync(pyproject)) return false;
  try {
    return readFileSync(pyproject, 'utf8').includes('[tool.mypy]');
  } catch {
    return false;
  }
}

async function runMypy(ctx: ProjectContext): Promise<GateResult> {
  if (!hasMypyConfig(ctx.rootPath)) {
    return {
      gate: 'typecheck',
      status: 'SKIP',
      duration: 0,
      fix: 'No mypy config found. Add [tool.mypy] to pyproject.toml or create mypy.ini.',
    };
  }

  const start = Date.now();
  try {
    const result = await execa('mypy', ['.'], { cwd: ctx.rootPath, reject: false });
    const duration = Date.now() - start;
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');

    if (result.exitCode === 0) {
      return { gate: 'typecheck', status: 'PASS', duration };
    }

    const errorLines = combined
      .split('\n')
      .filter((l) => /: error:/.test(l))
      .slice(0, 10);

    return {
      gate: 'typecheck',
      status: 'FAIL',
      duration,
      output: combined,
      errors: errorLines.length ? errorLines : undefined,
      fix: 'Fix type errors shown above. Run: mypy . for full output.',
    };
  } catch (err) {
    return {
      gate: 'typecheck',
      status: 'FAIL',
      duration: Date.now() - start,
      errors: [String(err)],
      fix: 'Check mypy is installed: pip install mypy',
    };
  }
}

export async function runTypecheck(ctx: ProjectContext): Promise<GateResult> {
  const isNode = ctx.types.includes('nodejs') || ctx.types.includes('react');
  if (ctx.types.includes('python')) return runMypy(ctx);
  if (!isNode) return { gate: 'typecheck', status: 'SKIP', duration: 0 };

  const hasScript = Boolean(ctx.scripts.typecheck);
  const hasTsconfig = existsSync(join(ctx.rootPath, 'tsconfig.json'));

  if (!hasScript && !hasTsconfig) {
    return {
      gate: 'typecheck',
      status: 'SKIP',
      duration: 0,
      fix: 'No tsconfig.json found. Run: npx tsc --init',
    };
  }

  const start = Date.now();
  const [cmd, args] = hasScript ? typecheckScriptCmd(ctx) : tscCmd(ctx);
  try {
    const result = await execa(cmd, args, { cwd: ctx.rootPath, reject: false });
    const duration = Date.now() - start;
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');

    if (result.exitCode === 0) {
      return { gate: 'typecheck', status: 'PASS', duration };
    }

    const errorLines = combined
      .split('\n')
      .filter((l) => l.includes('error TS'))
      .slice(0, 10);

    return {
      gate: 'typecheck',
      status: 'FAIL',
      duration,
      output: combined,
      errors: errorLines.length ? errorLines : undefined,
      fix: 'Fix type errors shown above. Run: npx tsc --noEmit for full output.',
    };
  } catch (err) {
    return {
      gate: 'typecheck',
      status: 'FAIL',
      duration: Date.now() - start,
      errors: [String(err)],
      fix: 'Check TypeScript is installed: npm install -D typescript',
    };
  }
}
