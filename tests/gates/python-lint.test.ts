import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ProjectContext } from '../../src/types.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

const { execa } = await import('execa');
const mockExeca = vi.mocked(execa);

const { runLint } = await import('../../src/gates/lint.js');

let tempDir: string;

function makeTemp(): string {
  tempDir = join(tmpdir(), `ats-py-lint-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function pyCtx(rootPath: string): ProjectContext {
  return { rootPath, types: ['python'], packageManager: null };
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('runLint (python) — SKIP', () => {
  it('SKIPs python project with no ruff config', async () => {
    const dir = makeTemp();
    const result = await runLint(pyCtx(dir));
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('SKIPs docker-only project', async () => {
    const dir = makeTemp();
    const result = await runLint({ rootPath: dir, types: ['docker'], packageManager: null });
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe('runLint (python) — PASS', () => {
  it('PASSes when ruff exits 0', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'ruff.toml'), '[lint]');
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' } as never);

    const result = await runLint(pyCtx(dir));
    expect(result.status).toBe('PASS');
    expect(result.gate).toBe('lint');
    expect(mockExeca).toHaveBeenCalledWith('ruff', ['check', '.'], expect.any(Object));
  });
});

describe('runLint (python) — FAIL', () => {
  it('FAILs and extracts ruff error lines from output', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'ruff.toml'), '[lint]');
    const output = 'src/main.py:10:5: E501 Line too long\nsrc/main.py:15:1: F401 Unused import';
    mockExeca.mockResolvedValue({ exitCode: 1, stdout: output, stderr: '' } as never);

    const result = await runLint(pyCtx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.errors).toHaveLength(2);
    expect(result.errors![0]).toMatch(/E501/);
  });

  it('FAIL fix message includes ruff check --fix', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'ruff.toml'), '[lint]');
    mockExeca.mockResolvedValue({ exitCode: 1, stdout: 'src/x.py:1:1: E501 Too long', stderr: '' } as never);

    const result = await runLint(pyCtx(dir));
    expect(result.fix).toMatch(/ruff check . --fix/);
  });
});
