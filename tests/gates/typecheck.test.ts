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
  tempDir = join(tmpdir(), `ats-tc-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function ctx(rootPath: string): ProjectContext {
  return { rootPath, types: ['nodejs'], packageManager: 'pnpm' };
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('runTypecheck — SKIP', () => {
  it('SKIPs for non-Node projects', async () => {
    const dir = makeTemp();
    const result = await runTypecheck({ rootPath: dir, types: ['python'], packageManager: null });
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('SKIPs when no tsconfig.json', async () => {
    const dir = makeTemp();
    const result = await runTypecheck(ctx(dir));
    expect(result.status).toBe('SKIP');
    expect(result.fix).toMatch(/tsconfig/);
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe('runTypecheck — PASS', () => {
  it('PASSes when tsc exits 0', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'tsconfig.json'), '{"compilerOptions":{}}');
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' } as never);

    const result = await runTypecheck(ctx(dir));
    expect(result.status).toBe('PASS');
    expect(result.gate).toBe('typecheck');
  });
});

describe('runTypecheck — FAIL', () => {
  it('FAILs and parses error TS lines when tsc exits 1', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'tsconfig.json'), '{"compilerOptions":{}}');
    mockExeca.mockResolvedValue({
      exitCode: 1,
      stdout: "src/foo.ts(1,5): error TS2304: Cannot find name 'x'.",
      stderr: '',
    } as never);

    const result = await runTypecheck(ctx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]).toContain('error TS2304');
  });

  it('FAILs with no error lines when output has no TS error markers', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'tsconfig.json'), '{"compilerOptions":{}}');
    mockExeca.mockResolvedValue({
      exitCode: 1,
      stdout: 'Something went wrong',
      stderr: '',
    } as never);

    const result = await runTypecheck(ctx(dir));
    expect(result.status).toBe('FAIL');
  });
});
