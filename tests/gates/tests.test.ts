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
  tempDir = join(tmpdir(), `ats-tests-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function ctx(rootPath: string): ProjectContext {
  return { rootPath, types: ['nodejs'], packageManager: 'pnpm', scripts: {} };
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('runTests — SKIP', () => {
  it('SKIPs for non-Node projects', async () => {
    const dir = makeTemp();
    const result = await runTests({ rootPath: dir, types: ['docker'], packageManager: null, scripts: {} });
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('SKIPs when no package.json', async () => {
    const dir = makeTemp();
    const result = await runTests(ctx(dir));
    expect(result.status).toBe('SKIP');
  });
});

describe('runTests — WARN', () => {
  it('WARNs when package.json has no test script', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test', scripts: {} }));
    const result = await runTests(ctx(dir));
    expect(result.status).toBe('WARN');
    expect(result.fix).toMatch(/test.*script/i);
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe('runTests — PASS', () => {
  it('PASSes when test command exits 0 (vitest output)', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    mockExeca.mockResolvedValue({
      exitCode: 0,
      stdout: 'Test Files  1 passed (1)\nTests  5 passed (5)',
      stderr: '',
    } as never);

    const result = await runTests(ctx(dir));
    expect(result.status).toBe('PASS');
    expect(result.output).toMatch(/5.*passed/);
  });

  it('PASSes when test command exits 0 (jest output)', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    mockExeca.mockResolvedValue({
      exitCode: 0,
      stdout: 'Tests: 3 passed, 3 total',
      stderr: '',
    } as never);

    const result = await runTests(ctx(dir));
    expect(result.status).toBe('PASS');
  });
});

describe('runTests — FAIL', () => {
  it('FAILs when test command exits 1', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    mockExeca.mockResolvedValue({
      exitCode: 1,
      stdout: '✗ tests/foo.test.ts\n  × should work\nTest Files  1 failed (1)\nTests  1 failed (1)',
      stderr: '',
    } as never);

    const result = await runTests(ctx(dir));
    expect(result.status).toBe('FAIL');
  });
});
