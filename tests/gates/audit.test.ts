import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ProjectContext } from '../../src/types.js';

// Helper to create a workspace package directory with a package.json
function makePackage(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }));
  return dir;
}

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

describe('runAudit — monorepo (pnpm-workspace.yaml)', () => {
  it('audits root + workspace packages and aggregates clean result', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), '{}');
    mkdirSync(join(dir, 'packages'), { recursive: true });
    makePackage(join(dir, 'packages'), 'pkg-a');
    makePackage(join(dir, 'packages'), 'pkg-b');
    writeFileSync(
      join(dir, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/*'\n",
    );
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: auditJson(0, 0, 0), stderr: '' } as never);

    const result = await runAudit(ctx(dir));
    expect(result.status).toBe('PASS');
    // 3 paths: root + pkg-a + pkg-b
    expect(mockExeca).toHaveBeenCalledTimes(3);
    expect(result.output).toMatch(/across 3 packages/);
  });

  it('FAILs and aggregates vulns across packages', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), '{}');
    mkdirSync(join(dir, 'packages'), { recursive: true });
    makePackage(join(dir, 'packages'), 'pkg-a');
    writeFileSync(
      join(dir, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/*'\n",
    );
    // root: clean, pkg-a: 1 high
    mockExeca
      .mockResolvedValueOnce({ exitCode: 0, stdout: auditJson(0, 0, 0), stderr: '' } as never)
      .mockResolvedValueOnce({ exitCode: 1, stdout: auditJson(1, 0, 0), stderr: '' } as never);

    const result = await runAudit(ctx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.errors![0]).toMatch(/1 high/);
    expect(result.errors![0]).toMatch(/across 2 packages/);
  });

  it('WARNs when moderate vulns found in a workspace package', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), '{}');
    mkdirSync(join(dir, 'packages'), { recursive: true });
    makePackage(join(dir, 'packages'), 'pkg-a');
    writeFileSync(
      join(dir, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/*'\n",
    );
    mockExeca
      .mockResolvedValueOnce({ exitCode: 0, stdout: auditJson(0, 0, 0), stderr: '' } as never)
      .mockResolvedValueOnce({ exitCode: 1, stdout: auditJson(0, 0, 2), stderr: '' } as never);

    const result = await runAudit(ctx(dir));
    expect(result.status).toBe('WARN');
    expect(result.output).toMatch(/2 moderate/);
    expect(result.output).toMatch(/across 2 packages/);
  });
});

describe('runAudit — monorepo (package.json workspaces)', () => {
  it('detects npm workspaces array and audits packages', async () => {
    const dir = makeTemp();
    mkdirSync(join(dir, 'apps'), { recursive: true });
    makePackage(join(dir, 'apps'), 'web');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ workspaces: ['apps/*'] }),
    );
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: auditJson(0, 0, 0), stderr: '' } as never);

    const result = await runAudit(ctx(dir));
    expect(result.status).toBe('PASS');
    expect(mockExeca).toHaveBeenCalledTimes(2); // root + apps/web
    expect(result.output).toMatch(/across 2 packages/);
  });

  it('detects yarn workspaces.packages object shape', async () => {
    const dir = makeTemp();
    mkdirSync(join(dir, 'libs'), { recursive: true });
    makePackage(join(dir, 'libs'), 'shared');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ workspaces: { packages: ['libs/*'] } }),
    );
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: auditJson(0, 0, 0), stderr: '' } as never);

    const result = await runAudit(ctx(dir));
    expect(result.status).toBe('PASS');
    expect(mockExeca).toHaveBeenCalledTimes(2); // root + libs/shared
  });

  it('does not double-count root when root is also listed in workspaces', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['.'] }));
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: auditJson(0, 0, 0), stderr: '' } as never);

    const result = await runAudit(ctx(dir));
    // root resolves to same path — deduped, only 1 audit call
    expect(result.status).toBe('PASS');
    expect(mockExeca).toHaveBeenCalledTimes(1);
  });
});

describe('runAudit — monorepo workspace directories without package.json are skipped', () => {
  it('ignores non-package directories matching glob', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), '{}');
    mkdirSync(join(dir, 'packages', 'not-a-package'), { recursive: true }); // no package.json
    writeFileSync(
      join(dir, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/*'\n",
    );
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: auditJson(0, 0, 0), stderr: '' } as never);

    const result = await runAudit(ctx(dir));
    expect(result.status).toBe('PASS');
    // Only root audited — packages/not-a-package has no package.json
    expect(mockExeca).toHaveBeenCalledTimes(1);
    expect(result.output).not.toMatch(/across/);
  });
});
