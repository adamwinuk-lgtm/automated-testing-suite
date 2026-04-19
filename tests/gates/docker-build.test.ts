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
  tempDir = join(tmpdir(), `ats-docker-build-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function dockerCtx(rootPath: string): ProjectContext {
  return { rootPath, types: ['docker'], packageManager: null };
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('runBuild (docker) — SKIP', () => {
  it('SKIPs nodejs project', async () => {
    const dir = makeTemp();
    const result = await runBuild({ rootPath: dir, types: ['nodejs'], packageManager: 'npm' });
    // nodejs project with no build script should SKIP
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('SKIPs docker project with no compose file', async () => {
    const dir = makeTemp();
    const result = await runBuild(dockerCtx(dir));
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe('runBuild (docker) — PASS', () => {
  it('PASSes when docker compose config exits 0', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'docker-compose.yml'), 'services:\n  app:\n    image: nginx');
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' } as never);

    const result = await runBuild(dockerCtx(dir));
    expect(result.status).toBe('PASS');
    expect(result.gate).toBe('build');
    expect(mockExeca).toHaveBeenCalledWith(
      'docker',
      ['compose', 'config', '--quiet'],
      expect.any(Object),
    );
  });
});

describe('runBuild (docker) — FAIL', () => {
  it('FAILs when docker compose config exits non-zero', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'docker-compose.yml'), 'invalid: yaml: [');
    mockExeca.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'Error: invalid compose file: yaml parse error',
    } as never);

    const result = await runBuild(dockerCtx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.fix).toMatch(/docker-compose\.yml/);
  });
});

describe('runBuild (docker) — WARN', () => {
  it('WARNs when docker is not installed (ENOENT)', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'docker-compose.yml'), 'services:\n  app:\n    image: nginx');
    mockExeca.mockRejectedValue(new Error('spawn docker ENOENT'));

    const result = await runBuild(dockerCtx(dir));
    expect(result.status).toBe('WARN');
    expect(result.fix).toMatch(/Docker/);
  });
});
