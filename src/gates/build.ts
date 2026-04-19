import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import type { GateResult, ProjectContext } from '../types.js';

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

function hasComposeFile(rootPath: string): boolean {
  return COMPOSE_FILES.some((f) => existsSync(join(rootPath, f)));
}

async function runDockerCompose(ctx: ProjectContext): Promise<GateResult> {
  if (!hasComposeFile(ctx.rootPath)) {
    return {
      gate: 'build',
      status: 'SKIP',
      duration: 0,
      fix: 'No docker-compose.yml found.',
    };
  }

  const start = Date.now();
  try {
    const result = await execa('docker', ['compose', 'config', '--quiet'], {
      cwd: ctx.rootPath,
      reject: false,
    });
    const duration = Date.now() - start;
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');

    if (result.exitCode === 0) return { gate: 'build', status: 'PASS', duration };

    return {
      gate: 'build',
      status: 'FAIL',
      duration,
      output: combined,
      errors: combined
        .split('\n')
        .filter((l) => /error/i.test(l))
        .slice(0, 10),
      fix: 'Fix docker-compose.yml errors shown above.',
    };
  } catch (err) {
    const msg = String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      return {
        gate: 'build',
        status: 'WARN',
        duration: Date.now() - start,
        fix: 'Docker is not installed or not in PATH.',
      };
    }
    return { gate: 'build', status: 'FAIL', duration: Date.now() - start, errors: [msg] };
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

function buildCmd(ctx: ProjectContext): [string, string[]] {
  if (ctx.packageManager === 'pnpm') return ['pnpm', ['build']];
  if (ctx.packageManager === 'yarn') return ['yarn', ['build']];
  return ['npm', ['run', 'build']];
}

export async function runBuild(ctx: ProjectContext): Promise<GateResult> {
  if (ctx.types.includes('docker')) return runDockerCompose(ctx);
  const isNode = ctx.types.includes('nodejs') || ctx.types.includes('react');
  if (!isNode) return { gate: 'build', status: 'SKIP', duration: 0 };

  const pkg = readPackageJson(ctx.rootPath);
  const scripts = pkg?.scripts as Record<string, string> | undefined;
  if (!scripts?.build) {
    return { gate: 'build', status: 'SKIP', duration: 0, fix: 'No "build" script in package.json.' };
  }

  const start = Date.now();
  const [cmd, args] = buildCmd(ctx);
  try {
    const result = await execa(cmd, args, { cwd: ctx.rootPath, reject: false });
    const duration = Date.now() - start;
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');

    if (result.exitCode === 0) {
      return { gate: 'build', status: 'PASS', duration };
    }

    return {
      gate: 'build',
      status: 'FAIL',
      duration,
      output: combined,
      errors: combined.split('\n').filter((l) => /error/i.test(l)).slice(0, 10),
      fix: `Run: ${cmd} ${args.join(' ')} to see full output.`,
    };
  } catch (err) {
    return {
      gate: 'build',
      status: 'FAIL',
      duration: Date.now() - start,
      errors: [String(err)],
    };
  }
}
