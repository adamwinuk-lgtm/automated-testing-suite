import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ProjectContext } from '../../src/types.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

const { execa } = await import('execa');
const mockExeca = vi.mocked(execa);

const { runE2e } = await import('../../src/gates/e2e.js');

let tempDir: string;

function makeTemp(): string {
  tempDir = join(tmpdir(), `ats-e2e-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function webCtx(rootPath: string): ProjectContext {
  return { rootPath, types: ['nodejs'], packageManager: 'npm', scripts: {} };
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('runE2e — SKIP', () => {
  it('SKIPs python project (not web)', async () => {
    const dir = makeTemp();
    const result = await runE2e({ rootPath: dir, types: ['python'], packageManager: null, scripts: {} });
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('SKIPs nodejs project with no playwright config', async () => {
    const dir = makeTemp();
    const result = await runE2e(webCtx(dir));
    expect(result.status).toBe('SKIP');
    expect(result.fix).toMatch(/playwright/i);
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe('runE2e — PASS', () => {
  it('PASSes when playwright exits 0', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'playwright.config.ts'), 'export default {};');
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '3 passed (3)', stderr: '' } as never);

    const result = await runE2e(webCtx(dir));
    expect(result.status).toBe('PASS');
    expect(result.gate).toBe('e2e');
    expect(mockExeca).toHaveBeenCalledWith('npx', ['playwright', 'test'], expect.any(Object));
  });
});

describe('runE2e — FAIL', () => {
  it('FAILs when playwright exits non-zero and extracts FAILED lines', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'playwright.config.ts'), 'export default {};');
    const output = '  1) example.spec.ts:10 › login test\n    FAILED: Expected element to be visible\n1 failed';
    mockExeca.mockResolvedValue({ exitCode: 1, stdout: output, stderr: '' } as never);

    const result = await runE2e(webCtx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => /FAILED/.test(e))).toBe(true);
    expect(result.fix).toMatch(/playwright/i);
  });
});

describe('runE2e — WARN', () => {
  it('WARNs when playwright is not installed (ENOENT)', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'playwright.config.ts'), 'export default {};');
    mockExeca.mockRejectedValue(new Error('spawn npx ENOENT'));

    const result = await runE2e(webCtx(dir));
    expect(result.status).toBe('WARN');
    expect(result.fix).toMatch(/@playwright\/test/);
  });
});
