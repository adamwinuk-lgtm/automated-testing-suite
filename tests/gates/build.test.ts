import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ProjectContext } from '../../src/types.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

const { execa } = await import('execa');
const mockExeca = vi.mocked(execa);

const { runBuild } = await import('../../src/gates/build.js');

let tempDir: string;

function makeTemp(): string {
  tempDir = join(tmpdir(), `ats-build-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function ctx(rootPath: string, pm: ProjectContext['packageManager'] = 'npm'): ProjectContext {
  return { rootPath, types: ['nodejs'], packageManager: pm };
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('runBuild — SKIP', () => {
  it('SKIPs for non-Node projects', async () => {
    const dir = makeTemp();
    const result = await runBuild({ rootPath: dir, types: ['python'], packageManager: null });
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('SKIPs when package.json has no build script', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    const result = await runBuild(ctx(dir));
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe('runBuild — PASS', () => {
  it('PASSes when build exits 0', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'tsup' } }));
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: 'Build success', stderr: '' } as never);

    const result = await runBuild(ctx(dir));
    expect(result.status).toBe('PASS');
    expect(result.gate).toBe('build');
  });

  it('uses pnpm build when packageManager is pnpm', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'tsup' } }));
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' } as never);

    await runBuild(ctx(dir, 'pnpm'));
    expect(mockExeca).toHaveBeenCalledWith('pnpm', ['build'], expect.any(Object));
  });
});

describe('runBuild — FAIL', () => {
  it('FAILs when build exits non-zero', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'tsup' } }));
    mockExeca.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'error: Cannot find module ./missing',
    } as never);

    const result = await runBuild(ctx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.errors).toBeDefined();
  });
});
