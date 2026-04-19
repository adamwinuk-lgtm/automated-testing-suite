import { execa } from 'execa';
import type { GateResult, ProjectContext } from '../types.js';

interface BanditFinding {
  issue_severity: string;
  issue_text: string;
  filename: string;
  line_number: number;
}

interface BanditOutput {
  results: BanditFinding[];
}

function parseBandit(stdout: string): BanditOutput | null {
  try {
    const data = JSON.parse(stdout);
    if (data && Array.isArray(data.results)) return data as BanditOutput;
  } catch {
    // not JSON
  }
  return null;
}

async function runBandit(ctx: ProjectContext): Promise<GateResult> {
  const start = Date.now();
  try {
    const result = await execa('bandit', ['-r', '.', '-f', 'json', '-q'], {
      cwd: ctx.rootPath,
      reject: false,
    });
    const duration = Date.now() - start;

    const parsed = parseBandit(result.stdout);
    if (!parsed) {
      return {
        gate: 'security',
        status: 'WARN',
        duration,
        output: result.stdout || result.stderr,
        fix: 'Run: bandit -r . for details.',
      };
    }

    const high = parsed.results.filter((r) => r.issue_severity === 'HIGH');
    const medium = parsed.results.filter((r) => r.issue_severity === 'MEDIUM');

    if (high.length > 0) {
      return {
        gate: 'security',
        status: 'FAIL',
        duration,
        errors: high
          .slice(0, 10)
          .map((r) => `${r.filename}:${r.line_number}: [HIGH] ${r.issue_text}`),
        fix: 'Fix HIGH severity issues found by bandit.',
      };
    }

    if (medium.length > 0) {
      return {
        gate: 'security',
        status: 'WARN',
        duration,
        output: `${medium.length} MEDIUM severity issue(s) found`,
        fix: 'Review MEDIUM severity issues: run bandit -r . for details.',
      };
    }

    return {
      gate: 'security',
      status: 'PASS',
      duration,
      output: `${parsed.results.length} issue(s) scanned, none HIGH/MEDIUM`,
    };
  } catch (err) {
    const msg = String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      return {
        gate: 'security',
        status: 'WARN',
        duration: Date.now() - start,
        fix: 'bandit is not installed. Run: pip install bandit',
      };
    }
    return { gate: 'security', status: 'FAIL', duration: Date.now() - start, errors: [msg] };
  }
}

interface SemgrepFinding {
  check_id: string;
  path: string;
  extra: { message: string; severity: string };
}

interface SemgrepOutput {
  results: SemgrepFinding[];
}

function parseSemgrep(stdout: string): SemgrepOutput | null {
  try {
    const data = JSON.parse(stdout);
    if (data && Array.isArray(data.results)) return data as SemgrepOutput;
  } catch {
    // not JSON
  }
  return null;
}

async function runSemgrep(ctx: ProjectContext): Promise<GateResult> {
  const start = Date.now();
  try {
    const result = await execa('semgrep', ['--config=auto', '--json', '.'], {
      cwd: ctx.rootPath,
      reject: false,
    });
    const duration = Date.now() - start;

    const parsed = parseSemgrep(result.stdout);
    if (!parsed) {
      return {
        gate: 'security',
        status: 'WARN',
        duration,
        output: result.stdout || result.stderr,
        fix: 'Run: semgrep --config=auto . for details.',
      };
    }

    if (parsed.results.length === 0) {
      return { gate: 'security', status: 'PASS', duration, output: 'No semgrep findings' };
    }

    const errorFindings = parsed.results.filter((r) => r.extra.severity === 'ERROR');
    const status = errorFindings.length > 0 ? 'FAIL' : 'WARN';

    return {
      gate: 'security',
      status,
      duration,
      errors: parsed.results
        .slice(0, 10)
        .map((r) => `${r.path}: [${r.extra.severity}] ${r.extra.message}`),
      fix: 'Review semgrep findings above.',
    };
  } catch (err) {
    const msg = String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      return {
        gate: 'security',
        status: 'WARN',
        duration: Date.now() - start,
        fix: 'semgrep is not installed. Run: pip install semgrep or brew install semgrep',
      };
    }
    return { gate: 'security', status: 'FAIL', duration: Date.now() - start, errors: [msg] };
  }
}

export async function runSecurity(ctx: ProjectContext): Promise<GateResult> {
  const isDockerOnly = ctx.types.length === 1 && ctx.types[0] === 'docker';
  if (isDockerOnly) return { gate: 'security', status: 'SKIP', duration: 0 };

  if (ctx.types.includes('python')) return runBandit(ctx);
  return runSemgrep(ctx);
}
