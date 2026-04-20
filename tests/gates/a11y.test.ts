import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ProjectContext } from '../../src/types.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

const { execa } = await import('execa');
const mockExeca = vi.mocked(execa);

const { runA11y } = await import('../../src/gates/a11y.js');

let tempDir: string;

function makeTemp(): string {
  tempDir = join(tmpdir(), `ats-a11y-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function webCtx(rootPath: string, pm: 'npm' | 'pnpm' | 'yarn' = 'npm'): ProjectContext {
  return { rootPath, types: ['react'], packageManager: pm, scripts: {} };
}

function writePackageJson(dir: string, deps: Record<string, string> = {}, devDeps: Record<string, string> = {}) {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'test', dependencies: deps, devDependencies: devDeps }),
  );
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('runA11y — SKIP', () => {
  it('SKIPs python-only projects', async () => {
    const dir = makeTemp();
    const result = await runA11y({ rootPath: dir, types: ['python'], packageManager: null, scripts: {} });
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('SKIPs docker-only projects', async () => {
    const dir = makeTemp();
    const result = await runA11y({ rootPath: dir, types: ['docker'], packageManager: null, scripts: {} });
    expect(result.status).toBe('SKIP');
  });

  it('SKIPs web project with no axe dependency', async () => {
    const dir = makeTemp();
    writePackageJson(dir, { react: '18.0.0' });
    const result = await runA11y(webCtx(dir));
    expect(result.status).toBe('SKIP');
    expect(result.fix).toMatch(/@axe-core\/playwright/);
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('SKIPs when package.json is missing entirely', async () => {
    const dir = makeTemp();
    const result = await runA11y(webCtx(dir));
    expect(result.status).toBe('SKIP');
  });
});

describe('runA11y — WARN (axe installed, no playwright config)', () => {
  it('WARNs when @axe-core/playwright is present but no playwright config', async () => {
    const dir = makeTemp();
    writePackageJson(dir, {}, { '@axe-core/playwright': '^4.0.0' });
    const result = await runA11y(webCtx(dir));
    expect(result.status).toBe('WARN');
    expect(result.output).toMatch(/@axe-core\/playwright/);
    expect(result.fix).toMatch(/playwright init/);
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('WARNs when axe-core is present but no playwright config', async () => {
    const dir = makeTemp();
    writePackageJson(dir, { 'axe-core': '^4.0.0' });
    const result = await runA11y(webCtx(dir));
    expect(result.status).toBe('WARN');
  });

  it('WARNs when playwright is not installed (ENOENT)', async () => {
    const dir = makeTemp();
    writePackageJson(dir, {}, { '@axe-core/playwright': '^4.0.0' });
    writeFileSync(join(dir, 'playwright.config.ts'), 'export default {};');
    mockExeca.mockRejectedValue(new Error('spawn npx ENOENT'));

    const result = await runA11y(webCtx(dir));
    expect(result.status).toBe('WARN');
    expect(result.fix).toMatch(/@playwright\/test/);
  });

  it('WARNs when no a11y tests match the grep pattern', async () => {
    const dir = makeTemp();
    writePackageJson(dir, {}, { '@axe-core/playwright': '^4.0.0' });
    writeFileSync(join(dir, 'playwright.config.ts'), 'export default {};');
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '0 passed', stderr: '' } as never);

    const result = await runA11y(webCtx(dir));
    expect(result.status).toBe('WARN');
    expect(result.output).toMatch(/no a11y tests found/i);
    expect(result.fix).toMatch(/a11y/i);
  });
});

describe('runA11y — PASS', () => {
  it('PASSes when a11y tests pass', async () => {
    const dir = makeTemp();
    writePackageJson(dir, {}, { '@axe-core/playwright': '^4.0.0' });
    writeFileSync(join(dir, 'playwright.config.ts'), 'export default {};');
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '3 passed (2s)', stderr: '' } as never);

    const result = await runA11y(webCtx(dir));
    expect(result.status).toBe('PASS');
    expect(result.gate).toBe('a11y');
  });

  it('detects jest-axe as axe dependency', async () => {
    const dir = makeTemp();
    writePackageJson(dir, {}, { 'jest-axe': '^7.0.0' });
    writeFileSync(join(dir, 'playwright.config.ts'), 'export default {};');
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '2 passed', stderr: '' } as never);

    const result = await runA11y(webCtx(dir));
    expect(result.status).toBe('PASS');
  });

  it('uses pnpm exec when package manager is pnpm', async () => {
    const dir = makeTemp();
    writePackageJson(dir, {}, { '@axe-core/playwright': '^4.0.0' });
    writeFileSync(join(dir, 'playwright.config.ts'), 'export default {};');
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '1 passed', stderr: '' } as never);

    await runA11y(webCtx(dir, 'pnpm'));
    expect(mockExeca).toHaveBeenCalledWith(
      'pnpm', ['exec', 'playwright', 'test', '--grep', 'a11y|axe|accessibility'], expect.any(Object),
    );
  });
});

describe('runA11y — FAIL', () => {
  it('FAILs when a11y tests fail and extracts error lines', async () => {
    const dir = makeTemp();
    writePackageJson(dir, {}, { '@axe-core/playwright': '^4.0.0' });
    writeFileSync(join(dir, 'playwright.config.ts'), 'export default {};');
    const output = [
      '1) a11y test › homepage accessibility',
      '   Error: 3 accessibility violations detected',
      '   violation: color-contrast - Elements must have sufficient color contrast',
      '   FAILED',
    ].join('\n');
    mockExeca.mockResolvedValue({ exitCode: 1, stdout: output, stderr: '' } as never);

    const result = await runA11y(webCtx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => /violation|FAILED|Error/.test(e))).toBe(true);
    expect(result.fix).toMatch(/a11y|axe|accessibility/i);
  });
});
