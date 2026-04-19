import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ProjectContext } from '../../src/types.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

const { execa } = await import('execa');
const mockExeca = vi.mocked(execa);

const { runTests } = await import('../../src/gates/tests.js');

let tempDir: string;

function makeTemp(): string {
  tempDir = join(tmpdir(), `ats-py-tests-${randomUUID()}`);
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

describe('runTests (python) — SKIP', () => {
  it('SKIPs docker-only project', async () => {
    const dir = makeTemp();
    const result = await runTests({ rootPath: dir, types: ['docker'], packageManager: null });
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe('runTests (python) — WARN', () => {
  it('WARNs when python project has no pytest config', async () => {
    const dir = makeTemp();
    const result = await runTests(pyCtx(dir));
    expect(result.status).toBe('WARN');
    expect(result.fix).toMatch(/pytest/);
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('WARNs when pytest exits 5 (no tests collected)', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'conftest.py'), '');
    mockExeca.mockResolvedValue({ exitCode: 5, stdout: 'no tests ran', stderr: '' } as never);

    const result = await runTests(pyCtx(dir));
    expect(result.status).toBe('WARN');
    expect(result.fix).toMatch(/test_\*\.py/);
  });
});

describe('runTests (python) — PASS', () => {
  it('PASSes when pytest exits 0', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'conftest.py'), '');
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '2 passed in 0.12s', stderr: '' } as never);

    const result = await runTests(pyCtx(dir));
    expect(result.status).toBe('PASS');
    expect(result.gate).toBe('tests');
    expect(mockExeca).toHaveBeenCalledWith('pytest', [], expect.any(Object));
  });
});

describe('runTests (python) — FAIL', () => {
  it('FAILs when pytest exits 1', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'conftest.py'), '');
    const output = 'FAILED tests/test_main.py::test_add - AssertionError\n1 failed in 0.05s';
    mockExeca.mockResolvedValue({ exitCode: 1, stdout: output, stderr: '' } as never);

    const result = await runTests(pyCtx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toMatch(/FAILED/);
  });
});
