import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ProjectContext } from '../../src/types.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

const { execa } = await import('execa');
const mockExeca = vi.mocked(execa);

const { runUiBehavior } = await import('../../src/gates/ui-behavior.js');

let tempDir: string;

function makeTemp(): string {
  tempDir = join(tmpdir(), `ats-uibehavior-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function webCtx(rootPath: string, pm: 'npm' | 'pnpm' | 'yarn' = 'npm'): ProjectContext {
  return { rootPath, types: ['nodejs'], packageManager: pm, scripts: {} };
}

function reactCtx(rootPath: string): ProjectContext {
  return { rootPath, types: ['react'], packageManager: 'npm', scripts: {} };
}

const passingJson = JSON.stringify({
  stats: { expected: 5, unexpected: 0, skipped: 1, flaky: 0 },
  suites: [],
  errors: [],
});

const failingJson = JSON.stringify({
  stats: { expected: 3, unexpected: 2, skipped: 0, flaky: 0 },
  suites: [
    {
      title: 'homepage',
      suites: [],
      tests: [
        {
          title: 'should show nav',
          results: [{ status: 'failed', error: { message: 'Expected nav to be visible' } }],
        },
        {
          title: 'should load title',
          results: [{ status: 'failed', error: { message: 'Timeout waiting for element' } }],
        },
      ],
    },
  ],
  errors: [],
});

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('runUiBehavior — SKIP', () => {
  it('SKIPs python-only projects', async () => {
    const dir = makeTemp();
    const result = await runUiBehavior({ rootPath: dir, types: ['python'], packageManager: null, scripts: {} });
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('SKIPs docker-only projects', async () => {
    const dir = makeTemp();
    const result = await runUiBehavior({ rootPath: dir, types: ['docker'], packageManager: null, scripts: {} });
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('SKIPs nodejs project with no playwright config', async () => {
    const dir = makeTemp();
    const result = await runUiBehavior(webCtx(dir));
    expect(result.status).toBe('SKIP');
    expect(result.fix).toMatch(/playwright/i);
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('SKIPs react project with no playwright config', async () => {
    const dir = makeTemp();
    const result = await runUiBehavior(reactCtx(dir));
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe('runUiBehavior — PASS', () => {
  it('PASSes with stats when playwright JSON exits 0', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'playwright.config.ts'), 'export default {};');
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: passingJson, stderr: '' } as never);

    const result = await runUiBehavior(webCtx(dir));
    expect(result.status).toBe('PASS');
    expect(result.gate).toBe('ui-behavior');
    expect(result.output).toMatch(/5 test\(s\) passed/);
    expect(result.output).toMatch(/1 skipped/);
  });

  it('uses pnpm exec for pnpm projects', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'playwright.config.ts'), 'export default {};');
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: passingJson, stderr: '' } as never);

    await runUiBehavior(webCtx(dir, 'pnpm'));
    expect(mockExeca).toHaveBeenCalledWith(
      'pnpm', ['exec', 'playwright', 'test', '--reporter=json'], expect.any(Object),
    );
  });

  it('uses yarn for yarn projects', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'playwright.config.js'), 'module.exports = {};');
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: passingJson, stderr: '' } as never);

    await runUiBehavior(webCtx(dir, 'yarn'));
    expect(mockExeca).toHaveBeenCalledWith(
      'yarn', ['playwright', 'test', '--reporter=json'], expect.any(Object),
    );
  });

  it('handles non-JSON prefix before JSON blob gracefully', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'playwright.config.ts'), 'export default {};');
    const mixed = `Running playwright...\n${passingJson}`;
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: mixed, stderr: '' } as never);

    const result = await runUiBehavior(webCtx(dir));
    expect(result.status).toBe('PASS');
  });
});

describe('runUiBehavior — FAIL', () => {
  it('FAILs and extracts failing test titles from JSON report', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'playwright.config.ts'), 'export default {};');
    mockExeca.mockResolvedValue({ exitCode: 1, stdout: failingJson, stderr: '' } as never);

    const result = await runUiBehavior(webCtx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => /should show nav/.test(e))).toBe(true);
    expect(result.errors!.some((e) => /should load title/.test(e))).toBe(true);
    expect(result.fix).toMatch(/playwright/i);
  });

  it('FAILs with generic message when JSON cannot be parsed', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'playwright.config.ts'), 'export default {};');
    mockExeca.mockResolvedValue({ exitCode: 1, stdout: 'not json at all', stderr: '' } as never);

    const result = await runUiBehavior(webCtx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.errors).toBeDefined();
  });

  it('includes timedOut tests as failures', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'playwright.config.ts'), 'export default {};');
    const timedOutJson = JSON.stringify({
      stats: { expected: 0, unexpected: 1, skipped: 0, flaky: 0 },
      suites: [
        {
          title: 'slow suite',
          suites: [],
          tests: [
            { title: 'long test', results: [{ status: 'timedOut', error: { message: 'Timeout 30000ms exceeded' } }] },
          ],
        },
      ],
      errors: [],
    });
    mockExeca.mockResolvedValue({ exitCode: 1, stdout: timedOutJson, stderr: '' } as never);

    const result = await runUiBehavior(webCtx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.errors!.some((e) => /long test/.test(e))).toBe(true);
  });
});

describe('runUiBehavior — WARN', () => {
  it('WARNs when playwright binary is not installed', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'playwright.config.ts'), 'export default {};');
    mockExeca.mockRejectedValue(new Error('spawn npx ENOENT'));

    const result = await runUiBehavior(webCtx(dir));
    expect(result.status).toBe('WARN');
    expect(result.fix).toMatch(/@playwright\/test/);
  });
});
