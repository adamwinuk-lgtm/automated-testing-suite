import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

function expandGlobPattern(rootPath: string, pattern: string): string[] {
  // Handle simple single-level globs like "packages/*" or "apps/*"
  // Strip leading ./ if present
  const normalized = pattern.replace(/^\.\//, '');
  const starIdx = normalized.indexOf('*');
  if (starIdx === -1) {
    const full = join(rootPath, normalized);
    return existsSync(join(full, 'package.json')) ? [full] : [];
  }
  const base = normalized.slice(0, starIdx).replace(/\/$/, '');
  const baseDir = join(rootPath, base);
  if (!existsSync(baseDir)) return [];
  try {
    return readdirSync(baseDir)
      .map((entry) => join(baseDir, entry))
      .filter((p) => {
        try { return statSync(p).isDirectory() && existsSync(join(p, 'package.json')); }
        catch { return false; }
      });
  } catch {
    return [];
  }
}

function resolveWorkspacePackages(rootPath: string): string[] {
  const results: string[] = [];

  // pnpm-workspace.yaml
  const pnpmWs = join(rootPath, 'pnpm-workspace.yaml');
  if (existsSync(pnpmWs)) {
    try {
      const content = readFileSync(pnpmWs, 'utf8');
      // Extract quoted/unquoted list items under the "packages:" key
      const matches = content.match(/^\s+-\s+['"]?([^'"#\n]+?)['"]?\s*$/gm) ?? [];
      for (const line of matches) {
        const pattern = line.replace(/^\s+-\s+['"]?/, '').replace(/['"]?\s*$/, '').trim();
        if (pattern) results.push(...expandGlobPattern(rootPath, pattern));
      }
    } catch {
      // unreadable — skip
    }
  }

  // package.json workspaces field (npm/yarn style)
  const pkgJson = join(rootPath, 'package.json');
  if (existsSync(pkgJson)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJson, 'utf8')) as { workspaces?: string[] | { packages?: string[] } };
      const patterns = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : pkg.workspaces?.packages ?? [];
      for (const pattern of patterns) {
        results.push(...expandGlobPattern(rootPath, pattern));
      }
    } catch {
      // unparseable — skip
    }
  }

  // Deduplicate
  return [...new Set(results)];
}

async function auditOnePackage(
  cwd: string,
  cmd: string,
  args: string[],
): Promise<{ vulns: AuditVulns | null; raw: string }> {
  const result = await execa(cmd, args, { cwd, reject: false });
  return { vulns: parseVulns(result.stdout), raw: result.stdout || result.stderr };
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

  // Collect all paths to audit: root + any workspace packages
  const workspaces = resolveWorkspacePackages(ctx.rootPath);
  const paths = [ctx.rootPath, ...workspaces.filter((p) => p !== ctx.rootPath)];

  try {
    const results = await Promise.all(paths.map((p) => auditOnePackage(p, cmd, args)));
    const duration = Date.now() - start;

    const unparseable = results.filter((r) => r.vulns === null);
    if (unparseable.length === results.length) {
      return {
        gate: 'audit',
        status: 'WARN',
        duration,
        output: results[0].raw,
        fix: `Run: ${cmd} audit for details.`,
      };
    }

    const totals = results.reduce(
      (acc, r) => {
        if (!r.vulns) return acc;
        return {
          critical: acc.critical + r.vulns.critical,
          high: acc.high + r.vulns.high,
          moderate: acc.moderate + r.vulns.moderate,
          total: acc.total + r.vulns.total,
        };
      },
      { critical: 0, high: 0, moderate: 0, total: 0 },
    );

    const pkgLabel = paths.length > 1 ? ` across ${paths.length} packages` : '';

    if (totals.critical > 0 || totals.high > 0) {
      return {
        gate: 'audit',
        status: 'FAIL',
        duration,
        errors: [
          `${totals.critical} critical, ${totals.high} high, ${totals.moderate} moderate vulnerabilities${pkgLabel}`,
        ],
        fix: `Run: ${cmd} audit fix`,
      };
    }

    if (totals.moderate > 0) {
      return {
        gate: 'audit',
        status: 'WARN',
        duration,
        output: `${totals.moderate} moderate vulnerabilities found${pkgLabel}`,
        fix: `Run: ${cmd} audit fix`,
      };
    }

    return {
      gate: 'audit',
      status: 'PASS',
      duration,
      output: `${totals.total} vulnerabilities (none high/critical)${pkgLabel}`,
    };
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
