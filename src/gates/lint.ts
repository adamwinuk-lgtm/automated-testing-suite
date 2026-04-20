import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import type { GateResult, ProjectContext } from '../types.js';

const ESLINT_CONFIG_FILES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  '.eslintrc',
];

function hasEslintConfig(rootPath: string): boolean {
  return ESLINT_CONFIG_FILES.some((f) => existsSync(join(rootPath, f)));
}

function eslintCmd(ctx: ProjectContext): [string, string[]] {
  if (ctx.packageManager === 'pnpm') return ['pnpm', ['exec', 'eslint', '.']];
  if (ctx.packageManager === 'yarn') return ['yarn', ['eslint', '.']];
  return ['npx', ['eslint', '.']];
}

function lintScriptCmd(ctx: ProjectContext): [string, string[]] {
  if (ctx.packageManager === 'pnpm') return ['pnpm', ['run', 'lint']];
  if (ctx.packageManager === 'yarn') return ['yarn', ['lint']];
  return ['npm', ['run', 'lint']];
}

function hasRuffConfig(rootPath: string): boolean {
  if (existsSync(join(rootPath, 'ruff.toml')) || existsSync(join(rootPath, '.ruff.toml'))) return true;
  const pyproject = join(rootPath, 'pyproject.toml');
  if (!existsSync(pyproject)) return false;
  try {
    return readFileSync(pyproject, 'utf8').includes('[tool.ruff]');
  } catch {
    return false;
  }
}

async function runEslint(ctx: ProjectContext): Promise<GateResult> {
  const hasScript = Boolean(ctx.scripts.lint);
  const hasConfig = hasEslintConfig(ctx.rootPath);

  if (!hasScript && !hasConfig) {
    return {
      gate: 'lint',
      status: 'SKIP',
      duration: 0,
      fix: 'No ESLint config found. Add eslint.config.js to enable linting.',
    };
  }

  const start = Date.now();
  const [cmd, args] = hasScript ? lintScriptCmd(ctx) : eslintCmd(ctx);
  try {
    const result = await execa(cmd, args, { cwd: ctx.rootPath, reject: false });
    const duration = Date.now() - start;
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');

    if (result.exitCode === 0) {
      const hasWarnings = /\d+ warning/.test(combined);
      return {
        gate: 'lint',
        status: hasWarnings ? 'WARN' : 'PASS',
        duration,
        output: combined || undefined,
        fix: hasWarnings ? 'Run: npx eslint . --fix' : undefined,
      };
    }

    const errorLines = combined
      .split('\n')
      .filter((l) => / error /.test(l))
      .slice(0, 10);

    return {
      gate: 'lint',
      status: 'FAIL',
      duration,
      output: combined,
      errors: errorLines.length ? errorLines : undefined,
      fix: 'Run: npx eslint . --fix',
    };
  } catch (err) {
    return {
      gate: 'lint',
      status: 'FAIL',
      duration: Date.now() - start,
      errors: [String(err)],
      fix: 'Check ESLint is installed: npm install -D eslint',
    };
  }
}

async function runRuff(ctx: ProjectContext): Promise<GateResult> {
  if (!hasRuffConfig(ctx.rootPath)) {
    return {
      gate: 'lint',
      status: 'SKIP',
      duration: 0,
      fix: 'No ruff config found. Add [tool.ruff] to pyproject.toml or create ruff.toml.',
    };
  }

  const start = Date.now();
  try {
    const result = await execa('ruff', ['check', '.'], { cwd: ctx.rootPath, reject: false });
    const duration = Date.now() - start;
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');

    if (result.exitCode === 0) {
      return { gate: 'lint', status: 'PASS', duration };
    }

    const errorLines = combined
      .split('\n')
      .filter((l) => /^[^:]+:\d+:\d+: [A-Z]\d+/.test(l))
      .slice(0, 10);

    return {
      gate: 'lint',
      status: 'FAIL',
      duration,
      output: combined,
      errors: errorLines.length ? errorLines : undefined,
      fix: 'Run: ruff check . --fix',
    };
  } catch (err) {
    return {
      gate: 'lint',
      status: 'FAIL',
      duration: Date.now() - start,
      errors: [String(err)],
      fix: 'Check ruff is installed: pip install ruff',
    };
  }
}

export async function runLint(ctx: ProjectContext): Promise<GateResult> {
  if (ctx.types.includes('nodejs') || ctx.types.includes('react')) return runEslint(ctx);
  if (ctx.types.includes('python')) return runRuff(ctx);
  return { gate: 'lint', status: 'SKIP', duration: 0 };
}
