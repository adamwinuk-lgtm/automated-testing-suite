import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import type { GateResult, ProjectContext } from '../types.js';

interface PipAuditPackage {
  name: string;
  version: string;
  vulns: { id: string; fix_versions: string[] }[];
}

function parsePipAudit(stdout: string): PipAuditPackage[] | null {
  try {
    const data = JSON.parse(stdout);
    if (Array.isArray(data)) return data as PipAuditPackage[];
  } catch {
    // not JSON
  }
  return null;
}

async function runPipAudit(ctx: ProjectContext): Promise<GateResult> {
  const start = Date.now();
  try {
    const result = await execa('pip-audit', ['--format=json', '--progress-spinner=off'], {
      cwd: ctx.rootPath,
      reject: false,
    });
    const duration = Date.now() - start;

    const packages = parsePipAudit(result.stdout);
    if (!packages) {
      return {
        gate: 'audit',
        status: 'WARN',
        duration,
        output: result.stdout || result.stderr,
        fix: 'Run: pip-audit for details.',
      };
    }

    const vulnCount = packages.reduce((sum, pkg) => sum + pkg.vulns.length, 0);
    if (vulnCount === 0) {
      return {
        gate: 'audit',
        status: 'PASS',
        duration,
        output: `${packages.length} packages audited, no vulnerabilities found`,
      };
    }

    const vulnSummary = packages
      .filter((pkg) => pkg.vulns.length > 0)
      .map((pkg) => `${pkg.name} ${pkg.version}: ${pkg.vulns.map((v) => v.id).join(', ')}`)
      .slice(0, 10);

    return {
      gate: 'audit',
      status: 'FAIL',
      duration,
      errors: vulnSummary,
      fix: 'Run: pip-audit --fix or upgrade vulnerable packages.',
    };
  } catch (err) {
    return {
      gate: 'audit',
      status: 'FAIL',
      duration: Date.now() - start,
      errors: [String(err)],
      fix: 'Check pip-audit is installed: pip install pip-audit',
    };
  }
}

interface AuditVulns {
  info: number;
  low: number;
  moderate: number;
  high: number;
  critical: number;
  total: number;
}

function parseVulns(stdout: string): AuditVulns | null {
  try {
    const json = JSON.parse(stdout);
    const v = json?.metadata?.vulnerabilities;
    if (v && typeof v.high === 'number') return v as AuditVulns;
  } catch {
    // not JSON
  }
  return null;
}

function auditCmd(ctx: ProjectContext): [string, string[]] {
  if (ctx.packageManager === 'pnpm') return ['pnpm', ['audit', '--json']];
  if (ctx.packageManager === 'yarn') return ['yarn', ['audit', '--json']];
  return ['npm', ['audit', '--json']];
}

export async function runAudit(ctx: ProjectContext): Promise<GateResult> {
  if (ctx.types.includes('python')) return runPipAudit(ctx);
  const isNode = ctx.types.includes('nodejs') || ctx.types.includes('react');
  if (!isNode) return { gate: 'audit', status: 'SKIP', duration: 0 };

  if (!existsSync(join(ctx.rootPath, 'package.json'))) {
    return { gate: 'audit', status: 'SKIP', duration: 0 };
  }

  const start = Date.now();
  const [cmd, args] = auditCmd(ctx);
  try {
    const result = await execa(cmd, args, { cwd: ctx.rootPath, reject: false });
    const duration = Date.now() - start;

    const vulns = parseVulns(result.stdout);

    if (!vulns) {
      // Command ran but output isn't parseable JSON — treat as WARN
      return {
        gate: 'audit',
        status: 'WARN',
        duration,
        output: result.stdout || result.stderr,
        fix: `Run: ${cmd} audit for details.`,
      };
    }

    if (vulns.critical > 0 || vulns.high > 0) {
      return {
        gate: 'audit',
        status: 'FAIL',
        duration,
        errors: [
          `${vulns.critical} critical, ${vulns.high} high, ${vulns.moderate} moderate vulnerabilities`,
        ],
        fix: `Run: ${cmd === 'npm' ? 'npm' : cmd} audit fix`,
      };
    }

    if (vulns.moderate > 0) {
      return {
        gate: 'audit',
        status: 'WARN',
        duration,
        output: `${vulns.moderate} moderate vulnerabilities found`,
        fix: `Run: ${cmd === 'npm' ? 'npm' : cmd} audit fix`,
      };
    }

    return { gate: 'audit', status: 'PASS', duration, output: `${vulns.total} vulnerabilities (none high/critical)` };
  } catch (err) {
    return {
      gate: 'audit',
      status: 'FAIL',
      duration: Date.now() - start,
      errors: [String(err)],
      fix: 'Check that your package manager is available.',
    };
  }
}
