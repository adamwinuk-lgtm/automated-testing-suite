import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ProjectContext } from '../../src/types.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

const { execa } = await import('execa');
const mockExeca = vi.mocked(execa);

const { runPerformance } = await import('../../src/gates/performance.js');

let tempDir: string;

function makeTemp(): string {
  tempDir = join(tmpdir(), `ats-perf-${randomUUID()}`);
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

describe('runPerformance — SKIP', () => {
  it('SKIPs python project (not web)', async () => {
    const dir = makeTemp();
    const result = await runPerformance({ rootPath: dir, types: ['python'], packageManager: null, scripts: {} });
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('SKIPs web project with no lhci or k6 config', async () => {
    const dir = makeTemp();
    const result = await runPerformance(webCtx(dir));
    expect(result.status).toBe('SKIP');
    expect(result.fix).toMatch(/lighthouserc/i);
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe('runPerformance (lhci) — PASS', () => {
  it('PASSes when lhci autorun exits 0', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, '.lighthouserc.json'), '{}');
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: 'Done!', stderr: '' } as never);

    const result = await runPerformance(webCtx(dir));
    expect(result.status).toBe('PASS');
    expect(result.gate).toBe('performance');
    expect(mockExeca).toHaveBeenCalledWith('lhci', ['autorun'], expect.any(Object));
  });
});

describe('runPerformance (lhci) — FAIL', () => {
  it('FAILs when lhci autorun exits non-zero', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, '.lighthouserc.json'), '{}');
    mockExeca.mockResolvedValue({
      exitCode: 1,
      stdout: 'Assertion failed: performance score is too low',
      stderr: '',
    } as never);

    const result = await runPerformance(webCtx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.fix).toMatch(/lhci/i);
  });
});

describe('runPerformance (lhci) — WARN', () => {
  it('WARNs when lhci is not installed (ENOENT)', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, '.lighthouserc.json'), '{}');
    mockExeca.mockRejectedValue(new Error('spawn lhci ENOENT'));

    const result = await runPerformance(webCtx(dir));
    expect(result.status).toBe('WARN');
    expect(result.fix).toMatch(/@lhci\/cli/);
  });
});

describe('runPerformance (k6) — PASS', () => {
  it('PASSes when k6 run exits 0 (k6/ dir with script)', async () => {
    const dir = makeTemp();
    const k6Dir = join(dir, 'k6');
    mkdirSync(k6Dir);
    writeFileSync(join(k6Dir, 'script.js'), 'export default function() {}');
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: 'default: 0 failed', stderr: '' } as never);

    const result = await runPerformance(webCtx(dir));
    expect(result.status).toBe('PASS');
    expect(mockExeca).toHaveBeenCalledWith('k6', ['run', expect.stringContaining('script.js')], expect.any(Object));
  });
});
