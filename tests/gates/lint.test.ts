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
  tempDir = join(tmpdir(), `ats-lint-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function ctx(
  rootPath: string,
  pm: ProjectContext['packageManager'] = 'npm',
  scripts: Record<string, string> = {},
): ProjectContext {
  return { rootPath, types: ['nodejs'], packageManager: pm, scripts };
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('runLint — SKIP', () => {
  it('SKIPs when no eslint config present', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), '{}');
    const result = await runLint(ctx(dir));
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('SKIPs for non-Node projects', async () => {
    const dir = makeTemp();
    const result = await runLint({ rootPath: dir, types: ['python'], packageManager: null, scripts: {} });
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe('runLint — PASS', () => {
  it('PASSes when eslint exits 0 with no warnings', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'eslint.config.js'), 'export default [];');
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' } as never);

    const result = await runLint(ctx(dir));
    expect(result.status).toBe('PASS');
    expect(result.gate).toBe('lint');
  });

  it('WARNs when eslint exits 0 but output contains warnings', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'eslint.config.js'), 'export default [];');
    mockExeca.mockResolvedValue({
      exitCode: 0,
      stdout: '  1:1  warning  Unexpected var  no-var\n✖ 1 problem (0 errors, 1 warning)',
      stderr: '',
    } as never);

    const result = await runLint(ctx(dir));
    expect(result.status).toBe('WARN');
    expect(result.fix).toMatch(/eslint.*--fix/);
  });
});

describe('runLint — FAIL', () => {
  it('FAILs when eslint exits 1', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'eslint.config.js'), 'export default [];');
    mockExeca.mockResolvedValue({
      exitCode: 1,
      stdout: "  1:1  error  'x' is defined but never used  no-unused-vars\n✖ 1 problem (1 error, 0 warnings)",
      stderr: '',
    } as never);

    const result = await runLint(ctx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.fix).toMatch(/eslint.*--fix/);
  });

  it('uses pnpm exec when packageManager is pnpm', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'eslint.config.js'), 'export default [];');
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' } as never);

    await runLint(ctx(dir, 'pnpm'));
    expect(mockExeca).toHaveBeenCalledWith('pnpm', expect.arrayContaining(['exec', 'eslint']), expect.any(Object));
  });
});

describe('runLint — script-first (monorepo)', () => {
  it('PASSes via npm run lint when scripts.lint present and exits 0', async () => {
    const dir = makeTemp();
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' } as never);

    const result = await runLint(ctx(dir, 'npm', { lint: 'eslint .' }));
    expect(result.status).toBe('PASS');
    expect(mockExeca).toHaveBeenCalledWith('npm', ['run', 'lint'], expect.any(Object));
  });

  it('FAILs via npm run lint when exits 1', async () => {
    const dir = makeTemp();
    mockExeca.mockResolvedValue({
      exitCode: 1,
      stdout: "1:1  error  'x' is defined but never used",
      stderr: '',
    } as never);

    const result = await runLint(ctx(dir, 'npm', { lint: 'eslint .' }));
    expect(result.status).toBe('FAIL');
  });

  it('WARNs via npm run lint when exits 0 with warnings', async () => {
    const dir = makeTemp();
    mockExeca.mockResolvedValue({
      exitCode: 0,
      stdout: '1 warning found',
      stderr: '',
    } as never);

    const result = await runLint(ctx(dir, 'npm', { lint: 'eslint .' }));
    expect(result.status).toBe('WARN');
  });

  it('uses pnpm run lint when packageManager is pnpm', async () => {
    const dir = makeTemp();
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' } as never);

    await runLint(ctx(dir, 'pnpm', { lint: 'eslint .' }));
    expect(mockExeca).toHaveBeenCalledWith('pnpm', ['run', 'lint'], expect.any(Object));
  });

  it('script takes precedence over missing eslint config', async () => {
    const dir = makeTemp();
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' } as never);

    const result = await runLint(ctx(dir, 'npm', { lint: 'eslint .' }));
    expect(result.status).toBe('PASS');
    expect(mockExeca).toHaveBeenCalled();
  });
});
