import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ProjectContext } from '../../src/types.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

const { execa } = await import('execa');
const mockExeca = vi.mocked(execa);

const { runAudit } = await import('../../src/gates/audit.js');

let tempDir: string;

function makeTemp(): string {
  tempDir = join(tmpdir(), `ats-py-audit-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function pyCtx(rootPath: string): ProjectContext {
  return { rootPath, types: ['python'], packageManager: null, scripts: {} };
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('runAudit (python) — SKIP', () => {
  it('SKIPs docker-only project', async () => {
    const dir = makeTemp();
    const result = await runAudit({ rootPath: dir, types: ['docker'], packageManager: null, scripts: {} });
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe('runAudit (python) — PASS', () => {
  it('PASSes when pip-audit returns empty array', async () => {
    const dir = makeTemp();
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '[]', stderr: '' } as never);

    const result = await runAudit(pyCtx(dir));
    expect(result.status).toBe('PASS');
    expect(result.gate).toBe('audit');
    expect(mockExeca).toHaveBeenCalledWith(
      'pip-audit',
      ['--format=json', '--progress-spinner=off'],
      expect.any(Object),
    );
  });
});

describe('runAudit (python) — FAIL', () => {
  it('FAILs when pip-audit returns packages with vulnerabilities', async () => {
    const dir = makeTemp();
    const auditOutput = JSON.stringify([
      { name: 'requests', version: '2.20.0', vulns: [{ id: 'PYSEC-2023-001', fix_versions: ['2.28.0'] }] },
      { name: 'flask', version: '1.0.0', vulns: [{ id: 'PYSEC-2021-042', fix_versions: ['2.0.0'] }] },
    ]);
    mockExeca.mockResolvedValue({ exitCode: 1, stdout: auditOutput, stderr: '' } as never);

    const result = await runAudit(pyCtx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.errors).toHaveLength(2);
    expect(result.errors![0]).toMatch(/requests/);
    expect(result.fix).toMatch(/pip-audit/);
  });
});

describe('runAudit (python) — WARN', () => {
  it('WARNs when pip-audit returns non-JSON output', async () => {
    const dir = makeTemp();
    mockExeca.mockResolvedValue({
      exitCode: 1,
      stdout: 'pip-audit: error: unable to determine installed packages',
      stderr: '',
    } as never);

    const result = await runAudit(pyCtx(dir));
    expect(result.status).toBe('WARN');
    expect(result.fix).toMatch(/pip-audit/);
  });
});
