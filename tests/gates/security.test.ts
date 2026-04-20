import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ProjectContext } from '../../src/types.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

const { execa } = await import('execa');
const mockExeca = vi.mocked(execa);

const { runSecurity } = await import('../../src/gates/security.js');

let tempDir: string;

function makeTemp(): string {
  tempDir = join(tmpdir(), `ats-security-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function pyCtx(rootPath: string): ProjectContext {
  return { rootPath, types: ['python'], packageManager: null, scripts: {} };
}

function nodeCtx(rootPath: string): ProjectContext {
  return { rootPath, types: ['nodejs'], packageManager: 'npm', scripts: {} };
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('runSecurity — SKIP', () => {
  it('SKIPs docker-only project', async () => {
    const dir = makeTemp();
    const result = await runSecurity({ rootPath: dir, types: ['docker'], packageManager: null, scripts: {} });
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe('runSecurity (python/bandit) — PASS', () => {
  it('PASSes when bandit finds no HIGH or MEDIUM issues', async () => {
    const dir = makeTemp();
    const output = JSON.stringify({ results: [], metrics: {} });
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: output, stderr: '' } as never);

    const result = await runSecurity(pyCtx(dir));
    expect(result.status).toBe('PASS');
    expect(result.gate).toBe('security');
    expect(mockExeca).toHaveBeenCalledWith('bandit', ['-r', '.', '-f', 'json', '-q'], expect.any(Object));
  });
});

describe('runSecurity (python/bandit) — FAIL', () => {
  it('FAILs when bandit finds HIGH severity issues', async () => {
    const dir = makeTemp();
    const output = JSON.stringify({
      results: [
        { issue_severity: 'HIGH', issue_text: 'Use of exec detected', filename: 'src/app.py', line_number: 42 },
      ],
      metrics: {},
    });
    mockExeca.mockResolvedValue({ exitCode: 1, stdout: output, stderr: '' } as never);

    const result = await runSecurity(pyCtx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.errors![0]).toMatch(/HIGH/);
    expect(result.errors![0]).toMatch(/src\/app\.py:42/);
    expect(result.fix).toMatch(/bandit/);
  });
});

describe('runSecurity (python/bandit) — WARN', () => {
  it('WARNs when bandit finds only MEDIUM issues', async () => {
    const dir = makeTemp();
    const output = JSON.stringify({
      results: [
        { issue_severity: 'MEDIUM', issue_text: 'Possible SQL injection', filename: 'src/db.py', line_number: 10 },
      ],
      metrics: {},
    });
    mockExeca.mockResolvedValue({ exitCode: 1, stdout: output, stderr: '' } as never);

    const result = await runSecurity(pyCtx(dir));
    expect(result.status).toBe('WARN');
    expect(result.output).toMatch(/MEDIUM/);
  });

  it('WARNs when bandit is not installed (ENOENT)', async () => {
    const dir = makeTemp();
    mockExeca.mockRejectedValue(new Error('spawn bandit ENOENT'));

    const result = await runSecurity(pyCtx(dir));
    expect(result.status).toBe('WARN');
    expect(result.fix).toMatch(/pip install bandit/);
  });
});

describe('runSecurity (nodejs/semgrep) — PASS', () => {
  it('PASSes when semgrep returns no findings', async () => {
    const dir = makeTemp();
    const output = JSON.stringify({ results: [], errors: [] });
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: output, stderr: '' } as never);

    const result = await runSecurity(nodeCtx(dir));
    expect(result.status).toBe('PASS');
    expect(result.output).toMatch(/No semgrep findings/);
    expect(mockExeca).toHaveBeenCalledWith('semgrep', ['--config=auto', '--json', '.'], expect.any(Object));
  });
});

describe('runSecurity (nodejs/semgrep) — FAIL', () => {
  it('FAILs when semgrep returns ERROR severity findings', async () => {
    const dir = makeTemp();
    const output = JSON.stringify({
      results: [
        {
          check_id: 'javascript.lang.security.eval',
          path: 'src/index.js',
          extra: { message: 'Detected use of eval()', severity: 'ERROR' },
        },
      ],
      errors: [],
    });
    mockExeca.mockResolvedValue({ exitCode: 1, stdout: output, stderr: '' } as never);

    const result = await runSecurity(nodeCtx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.errors![0]).toMatch(/ERROR/);
    expect(result.errors![0]).toMatch(/src\/index\.js/);
  });
});
