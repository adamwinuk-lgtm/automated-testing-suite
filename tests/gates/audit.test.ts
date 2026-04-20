import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  tempDir = join(tmpdir(), `ats-audit-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function ctx(rootPath: string): ProjectContext {
  return { rootPath, types: ['nodejs'], packageManager: 'npm', scripts: {} };
}

function auditJson(high = 0, critical = 0, moderate = 0): string {
  return JSON.stringify({
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate, high, critical, total: high + critical + moderate },
    },
  });
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('runAudit — SKIP', () => {
  it('SKIPs for non-Node projects', async () => {
    const dir = makeTemp();
    const result = await runAudit({ rootPath: dir, types: ['docker'], packageManager: null, scripts: {} });
    expect(result.status).toBe('SKIP');
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe('runAudit — PASS', () => {
  it('PASSes when no vulnerabilities found', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), '{}');
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: auditJson(0, 0, 0), stderr: '' } as never);

    const result = await runAudit(ctx(dir));
    expect(result.status).toBe('PASS');
    expect(result.output).toMatch(/0 vulnerabilities/);
  });
});

describe('runAudit — WARN', () => {
  it('WARNs when only moderate vulnerabilities found', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), '{}');
    mockExeca.mockResolvedValue({ exitCode: 1, stdout: auditJson(0, 0, 3), stderr: '' } as never);

    const result = await runAudit(ctx(dir));
    expect(result.status).toBe('WARN');
    expect(result.fix).toMatch(/audit fix/);
  });

  it('WARNs when audit output is not valid JSON', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), '{}');
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: 'some non-json output', stderr: '' } as never);

    const result = await runAudit(ctx(dir));
    expect(result.status).toBe('WARN');
  });
});

describe('runAudit — FAIL', () => {
  it('FAILs when high vulnerabilities found', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), '{}');
    mockExeca.mockResolvedValue({ exitCode: 1, stdout: auditJson(2, 0, 0), stderr: '' } as never);

    const result = await runAudit(ctx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.errors![0]).toMatch(/2 high/);
  });

  it('FAILs when critical vulnerabilities found', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), '{}');
    mockExeca.mockResolvedValue({ exitCode: 1, stdout: auditJson(0, 1, 0), stderr: '' } as never);

    const result = await runAudit(ctx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.errors![0]).toMatch(/1 critical/);
  });
});
