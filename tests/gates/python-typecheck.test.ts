import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ProjectContext } from '../../src/types.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

const { execa } = await import('execa');
const mockExeca = vi.mocked(execa);

const { runTypecheck } = await import('../../src/gates/typecheck.js');

let tempDir: string;

function makeTemp(): string {
  tempDir = join(tmpdir(), `ats-py-tc-${randomUUID()}`);
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

describe('runTypecheck (python) — SKIP', () => {
  it('SKIPs python project with no mypy config', async () => {
    const dir = makeTemp();
    const result = await runTypecheck(pyCtx(dir));
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('SKIPs docker-only project', async () => {
    const dir = makeTemp();
    const result = await runTypecheck({ rootPath: dir, types: ['docker'], packageManager: null });
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe('runTypecheck (python) — PASS', () => {
  it('PASSes when mypy exits 0', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'mypy.ini'), '[mypy]');
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: 'Success: no issues found', stderr: '' } as never);

    const result = await runTypecheck(pyCtx(dir));
    expect(result.status).toBe('PASS');
    expect(result.gate).toBe('typecheck');
    expect(mockExeca).toHaveBeenCalledWith('mypy', ['.'], expect.any(Object));
  });
});

describe('runTypecheck (python) — FAIL', () => {
  it('FAILs and extracts lines containing ": error:" from mypy output', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'mypy.ini'), '[mypy]');
    const output = [
      'src/main.py:10: error: Incompatible return value type',
      'src/main.py:15: error: Argument 1 has incompatible type',
      'Found 2 errors in 1 file',
    ].join('\n');
    mockExeca.mockResolvedValue({ exitCode: 1, stdout: output, stderr: '' } as never);

    const result = await runTypecheck(pyCtx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.errors).toHaveLength(2);
    expect(result.errors![0]).toMatch(/: error:/);
    expect(result.fix).toMatch(/mypy/);
  });
});
