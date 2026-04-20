import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execa } from 'execa';

const CLI = resolve(import.meta.dirname, '../dist/cli.js');
const cliAvailable = existsSync(CLI);

function makeProject(files: Record<string, string> = {}): string {
  const dir = join(tmpdir(), `ats-cli-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test-project', version: '1.0.0' }));
  for (const [name, content] of Object.entries(files)) {
    const fullPath = join(dir, name);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return dir;
}

let tempDirs: string[] = [];

beforeEach(() => { tempDirs = []; });
afterEach(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

function tmpProject(files?: Record<string, string>): string {
  const dir = makeProject(files);
  tempDirs.push(dir);
  return dir;
}

async function runCli(args: string[], cwd?: string) {
  try {
    const result = await execa('node', [CLI, ...args], { cwd, reject: false });
    return { exitCode: result.exitCode ?? 0, stdout: result.stdout, stderr: result.stderr };
  } catch (err: unknown) {
    const e = err as { exitCode?: number; stdout?: string; stderr?: string };
    return { exitCode: e.exitCode ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe.skipIf(!cliAvailable)('cli — basic usage', () => {
  it('prints version with --version', async () => {
    const { exitCode, stdout } = await runCli(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it('prints help with --help', async () => {
    const { exitCode, stdout } = await runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/run/);
  });

  it('exits 0 on a clean project (all gates skip/pass)', async () => {
    const dir = tmpProject();
    const { exitCode } = await runCli(['run', dir, '--skip', 'lint,typecheck,tests,build,audit,ci-config,e2e,security'], dir);
    expect(exitCode).toBe(0);
  });
});

describe.skipIf(!cliAvailable)('cli — --skip flag', () => {
  it('accepts comma-separated gate names', async () => {
    const dir = tmpProject();
    const { exitCode, stdout } = await runCli(['run', dir, '--skip', 'lint,typecheck,tests,build,audit,ci-config,e2e,security']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/PASS|SKIP/);
  });

  it('silently ignores invalid gate names', async () => {
    const dir = tmpProject();
    const { exitCode } = await runCli([
      'run', dir,
      '--skip', 'lint,not-a-gate,typecheck,tests,build,audit,ci-config,e2e,security',
    ]);
    expect(exitCode).toBe(0);
  });
});

describe.skipIf(!cliAvailable)('cli — --only flag', () => {
  it('runs only the specified gate', async () => {
    const dir = tmpProject();
    const { stdout } = await runCli(['run', dir, '--only', 'ci-config']);
    expect(stdout).toMatch(/ci-config/i);
    expect(stdout).not.toMatch(/performance/i);
  }, 15000);

  it('silently ignores invalid gate names in --only', async () => {
    const dir = tmpProject();
    const { exitCode } = await runCli(['run', dir, '--only', 'not-a-gate']);
    expect(exitCode).toBe(0);
  });
});

describe.skipIf(!cliAvailable)('cli — --no-fail-fast flag', () => {
  it('is accepted without error', async () => {
    const dir = tmpProject();
    const { exitCode } = await runCli([
      'run', dir,
      '--no-fail-fast',
      '--skip', 'lint,typecheck,tests,build,audit,ci-config,e2e,security',
    ]);
    expect(exitCode).toBe(0);
  });
});

describe.skipIf(!cliAvailable)('cli — --report-dir flag', () => {
  it('writes reports to the specified directory', async () => {
    const dir = tmpProject();
    const reportDir = join(tmpdir(), `ats-reports-${randomUUID()}`);
    tempDirs.push(reportDir);

    await runCli([
      'run', dir,
      '--report-dir', reportDir,
      '--skip', 'lint,typecheck,tests,build,audit,ci-config,e2e,security',
    ]);

    const { readdirSync } = await import('node:fs');
    const files = readdirSync(reportDir);
    expect(files.some(f => f.endsWith('.json'))).toBe(true);
    expect(files.some(f => f.endsWith('.html'))).toBe(true);
  });
});

describe.skipIf(!cliAvailable)('cli — exit codes', () => {
  it('exits 0 for PASS', async () => {
    const dir = tmpProject();
    const { exitCode } = await runCli([
      'run', dir,
      '--skip', 'lint,typecheck,tests,build,audit,ci-config,e2e,security',
    ]);
    expect(exitCode).toBe(0);
  });

  it('exits 1 for unknown command', async () => {
    const { exitCode } = await runCli(['unknown-command']);
    expect(exitCode).toBe(1);
  });
});
