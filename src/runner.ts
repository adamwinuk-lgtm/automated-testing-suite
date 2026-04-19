import type { GateName, GateResult, RunConfig, RunResult, Verdict } from './types.js';
import { detectProject } from './detectors/index.js';
import { runLint } from './gates/lint.js';
import { runTypecheck } from './gates/typecheck.js';
import { runTests } from './gates/tests.js';
import { runBuild } from './gates/build.js';
import { runAudit } from './gates/audit.js';
import { runCiConfig } from './gates/ci-config.js';
import { runE2e } from './gates/e2e.js';
import { runSecurity } from './gates/security.js';
import { runPerformance } from './gates/performance.js';
import { printConsoleReport } from './reporters/console.js';
import { writeJsonReport } from './reporters/json.js';
import { writeHtmlReport } from './reporters/html.js';
import { mkdir } from 'node:fs/promises';

type GateFn = (ctx: ReturnType<typeof detectProject>) => Promise<GateResult>;

const GATE_REGISTRY: Record<GateName, GateFn> = {
  lint: runLint,
  typecheck: runTypecheck,
  tests: runTests,
  build: runBuild,
  audit: runAudit,
  'ci-config': runCiConfig,
  e2e: runE2e,
  security: runSecurity,
  performance: runPerformance,
};

const DEFAULT_GATE_ORDER: GateName[] = [
  'lint', 'typecheck', 'tests', 'build', 'audit',
  'ci-config', 'e2e', 'security', 'performance',
];

function resolveVerdict(gates: GateResult[]): Verdict {
  if (gates.some(g => g.status === 'FAIL')) return 'FAIL';
  if (gates.some(g => g.status === 'WARN')) return 'CONDITIONAL_PASS';
  return 'PASS';
}

export async function run(config: RunConfig): Promise<RunResult> {
  const start = Date.now();
  const context = detectProject(config.projectPath);

  const activeGates = (config.only ?? DEFAULT_GATE_ORDER).filter(gate => {
    if (config.skip.includes(gate)) return false;
    if (gate === 'performance' && !config.includePerf) return false;
    return true;
  });

  const results: GateResult[] = [];

  for (const gateName of activeGates) {
    const gateFn = GATE_REGISTRY[gateName];
    const result = await gateFn(context);
    results.push(result);

    if (config.failFast && result.status === 'FAIL') break;
  }

  const verdict = resolveVerdict(results);
  const runResult: RunResult = {
    config,
    context,
    gates: results,
    verdict,
    durationMs: Date.now() - start,
    timestamp: new Date().toISOString(),
  };

  await mkdir(config.reportDir, { recursive: true });
  printConsoleReport(runResult);
  await writeJsonReport(runResult);
  await writeHtmlReport(runResult);

  return runResult;
}
