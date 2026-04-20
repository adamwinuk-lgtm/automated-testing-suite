import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { GateResult, RunConfig } from '../src/types.js';

vi.mock('../src/detectors/index.js', () => ({
  detectProject: vi.fn(() => ({ rootPath: '/tmp/fake', types: ['nodejs'], packageManager: 'npm' })),
}));

vi.mock('../src/reporters/console.js', () => ({ printConsoleReport: vi.fn() }));
vi.mock('../src/reporters/json.js', () => ({ writeJsonReport: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/reporters/html.js', () => ({ writeHtmlReport: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/store.js', () => ({ writeTestStore: vi.fn().mockResolvedValue('/tmp/fake/result.json') }));

const gateNames = ['lint', 'typecheck', 'tests', 'build', 'audit', 'ci-config', 'e2e', 'ui-behavior', 'a11y', 'security', 'performance'];

vi.mock('../src/gates/lint.js', () => ({ runLint: vi.fn() }));
vi.mock('../src/gates/typecheck.js', () => ({ runTypecheck: vi.fn() }));
vi.mock('../src/gates/tests.js', () => ({ runTests: vi.fn() }));
vi.mock('../src/gates/build.js', () => ({ runBuild: vi.fn() }));
vi.mock('../src/gates/audit.js', () => ({ runAudit: vi.fn() }));
vi.mock('../src/gates/ci-config.js', () => ({ runCiConfig: vi.fn() }));
vi.mock('../src/gates/e2e.js', () => ({ runE2e: vi.fn() }));
vi.mock('../src/gates/security.js', () => ({ runSecurity: vi.fn() }));
vi.mock('../src/gates/performance.js', () => ({ runPerformance: vi.fn() }));
vi.mock('../src/gates/ui-behavior.js', () => ({ runUiBehavior: vi.fn() }));
vi.mock('../src/gates/a11y.js', () => ({ runA11y: vi.fn() }));

const { runLint } = await import('../src/gates/lint.js');
const { runTypecheck } = await import('../src/gates/typecheck.js');
const { runTests } = await import('../src/gates/tests.js');
const { runBuild } = await import('../src/gates/build.js');
const { runAudit } = await import('../src/gates/audit.js');
const { runCiConfig } = await import('../src/gates/ci-config.js');
const { runE2e } = await import('../src/gates/e2e.js');
const { runSecurity } = await import('../src/gates/security.js');
const { runPerformance } = await import('../src/gates/performance.js');
const { runUiBehavior } = await import('../src/gates/ui-behavior.js');
const { runA11y } = await import('../src/gates/a11y.js');

const { writeTestStore } = await import('../src/store.js');
const { run } = await import('../src/runner.js');

const mockGates = {
  lint: vi.mocked(runLint),
  typecheck: vi.mocked(runTypecheck),
  tests: vi.mocked(runTests),
  build: vi.mocked(runBuild),
  audit: vi.mocked(runAudit),
  'ci-config': vi.mocked(runCiConfig),
  e2e: vi.mocked(runE2e),
  security: vi.mocked(runSecurity),
  performance: vi.mocked(runPerformance),
  'ui-behavior': vi.mocked(runUiBehavior),
  a11y: vi.mocked(runA11y),
};

function passResult(gate: string): GateResult {
  return { gate: gate as GateResult['gate'], status: 'PASS', duration: 10 };
}

function warnResult(gate: string): GateResult {
  return { gate: gate as GateResult['gate'], status: 'WARN', duration: 10 };
}

function failResult(gate: string): GateResult {
  return { gate: gate as GateResult['gate'], status: 'FAIL', duration: 10 };
}

function allPass() {
  for (const [name, mock] of Object.entries(mockGates)) {
    mock.mockResolvedValue(passResult(name));
  }
}

let reportDir: string;

beforeEach(() => {
  reportDir = join(tmpdir(), `ats-runner-${randomUUID()}`);
  mkdirSync(reportDir, { recursive: true });
  vi.clearAllMocks();
  allPass();
});

afterEach(() => {
  rmSync(reportDir, { recursive: true, force: true });
});

function baseConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    projectPath: '/tmp/fake',
    skip: [],
    only: null,
    failFast: true,
    reportDir,
    includePerf: false,
    parallel: false,
    ...overrides,
  };
}

describe('runner — gate ordering', () => {
  it('runs all default gates except performance', async () => {
    const result = await run(baseConfig());
    const ran = result.gates.map(g => g.gate);
    expect(ran).toEqual(['lint', 'typecheck', 'tests', 'build', 'audit', 'ci-config', 'e2e', 'ui-behavior', 'a11y', 'security']);
    expect(ran).not.toContain('performance');
  });

  it('includes performance when includePerf is true', async () => {
    const result = await run(baseConfig({ includePerf: true }));
    expect(result.gates.map(g => g.gate)).toContain('performance');
  });

  it('maintains fixed gate order', async () => {
    const result = await run(baseConfig());
    const ran = result.gates.map(g => g.gate);
    const expected = ['lint', 'typecheck', 'tests', 'build', 'audit', 'ci-config', 'e2e', 'ui-behavior', 'a11y', 'security'];
    expect(ran).toEqual(expected);
  });
});

describe('runner — --skip', () => {
  it('skips a single gate', async () => {
    const result = await run(baseConfig({ skip: ['lint'] }));
    expect(result.gates.map(g => g.gate)).not.toContain('lint');
  });

  it('skips multiple gates', async () => {
    const result = await run(baseConfig({ skip: ['lint', 'audit', 'e2e'] }));
    const ran = result.gates.map(g => g.gate);
    expect(ran).not.toContain('lint');
    expect(ran).not.toContain('audit');
    expect(ran).not.toContain('e2e');
  });

  it('skipping all gates returns empty results with PASS verdict', async () => {
    const allGates = gateNames.filter(g => g !== 'performance') as RunConfig['skip'];
    const result = await run(baseConfig({ skip: allGates }));
    expect(result.gates).toHaveLength(0);
    expect(result.verdict).toBe('PASS');
  });
});

describe('runner — --only', () => {
  it('runs only specified gates', async () => {
    const result = await run(baseConfig({ only: ['lint', 'typecheck'] }));
    expect(result.gates.map(g => g.gate)).toEqual(['lint', 'typecheck']);
  });

  it('only a single gate', async () => {
    const result = await run(baseConfig({ only: ['tests'] }));
    expect(result.gates).toHaveLength(1);
    expect(result.gates[0].gate).toBe('tests');
  });

  it('--only + --skip: skip takes precedence', async () => {
    const result = await run(baseConfig({ only: ['lint', 'typecheck', 'tests'], skip: ['typecheck'] }));
    const ran = result.gates.map(g => g.gate);
    expect(ran).toContain('lint');
    expect(ran).not.toContain('typecheck');
    expect(ran).toContain('tests');
  });

  it('--only with performance gate requires includePerf', async () => {
    const result = await run(baseConfig({ only: ['performance'], includePerf: false }));
    expect(result.gates).toHaveLength(0);
  });

  it('--only with performance gate and includePerf runs it', async () => {
    const result = await run(baseConfig({ only: ['performance'], includePerf: true }));
    expect(result.gates.map(g => g.gate)).toContain('performance');
  });
});

describe('runner — fail-fast', () => {
  it('stops after first FAIL when failFast is true', async () => {
    mockGates.lint.mockResolvedValue(failResult('lint'));

    const result = await run(baseConfig({ failFast: true }));
    expect(result.gates).toHaveLength(1);
    expect(result.gates[0].gate).toBe('lint');
    expect(mockGates.typecheck).not.toHaveBeenCalled();
  });

  it('continues after FAIL when failFast is false', async () => {
    mockGates.lint.mockResolvedValue(failResult('lint'));

    const result = await run(baseConfig({ failFast: false }));
    expect(result.gates.length).toBeGreaterThan(1);
    expect(result.gates[0].status).toBe('FAIL');
    expect(mockGates.typecheck).toHaveBeenCalled();
  });

  it('stops at the failing gate, not before', async () => {
    mockGates.tests.mockResolvedValue(failResult('tests'));

    const result = await run(baseConfig({ failFast: true }));
    const ran = result.gates.map(g => g.gate);
    expect(ran).toContain('lint');
    expect(ran).toContain('typecheck');
    expect(ran).toContain('tests');
    expect(ran).not.toContain('build');
  });

  it('WARN does not trigger fail-fast', async () => {
    mockGates.lint.mockResolvedValue(warnResult('lint'));

    const result = await run(baseConfig({ failFast: true }));
    expect(result.gates.length).toBeGreaterThan(1);
    expect(mockGates.typecheck).toHaveBeenCalled();
  });
});

describe('runner — verdict logic', () => {
  it('returns PASS when all gates pass', async () => {
    const result = await run(baseConfig());
    expect(result.verdict).toBe('PASS');
  });

  it('returns CONDITIONAL_PASS when any gate warns', async () => {
    mockGates.audit.mockResolvedValue(warnResult('audit'));
    const result = await run(baseConfig({ failFast: false }));
    expect(result.verdict).toBe('CONDITIONAL_PASS');
  });

  it('returns FAIL when any gate fails', async () => {
    mockGates.typecheck.mockResolvedValue(failResult('typecheck'));
    const result = await run(baseConfig({ failFast: false }));
    expect(result.verdict).toBe('FAIL');
  });

  it('FAIL takes precedence over WARN', async () => {
    mockGates.lint.mockResolvedValue(warnResult('lint'));
    mockGates.tests.mockResolvedValue(failResult('tests'));
    const result = await run(baseConfig({ failFast: false }));
    expect(result.verdict).toBe('FAIL');
  });

  it('multiple WARNs still yield CONDITIONAL_PASS', async () => {
    mockGates.lint.mockResolvedValue(warnResult('lint'));
    mockGates.audit.mockResolvedValue(warnResult('audit'));
    const result = await run(baseConfig({ failFast: false }));
    expect(result.verdict).toBe('CONDITIONAL_PASS');
  });
});

describe('runner — run result shape', () => {
  it('returns durationMs as a non-negative number', async () => {
    const result = await run(baseConfig());
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns a valid ISO timestamp', async () => {
    const result = await run(baseConfig());
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  it('includes config and context in result', async () => {
    const config = baseConfig();
    const result = await run(config);
    expect(result.config).toBe(config);
    expect(result.context).toBeDefined();
  });
});

describe('runner — --parallel', () => {
  it('runs all active gates and returns results', async () => {
    const result = await run(baseConfig({ parallel: true }));
    const ran = result.gates.map(g => g.gate);
    expect(ran).toContain('lint');
    expect(ran).toContain('typecheck');
    expect(ran).toContain('tests');
  });

  it('returns all gates in DEFAULT_GATE_ORDER (not task-completion order)', async () => {
    const result = await run(baseConfig({ parallel: true }));
    const ran = result.gates.map(g => g.gate);
    const expected = ['lint', 'typecheck', 'tests', 'build', 'audit', 'ci-config', 'e2e', 'ui-behavior', 'a11y', 'security'];
    expect(ran).toEqual(expected);
  });

  it('returns PASS verdict when all gates pass', async () => {
    const result = await run(baseConfig({ parallel: true }));
    expect(result.verdict).toBe('PASS');
  });

  it('returns FAIL verdict when any gate fails', async () => {
    mockGates.tests.mockResolvedValue(failResult('tests'));
    const result = await run(baseConfig({ parallel: true }));
    expect(result.verdict).toBe('FAIL');
  });

  it('runs every active gate even when one fails (no fail-fast in parallel mode)', async () => {
    mockGates.lint.mockResolvedValue(failResult('lint'));
    const result = await run(baseConfig({ parallel: true }));
    // All gates ran — not just lint
    expect(result.gates.length).toBeGreaterThan(1);
    expect(mockGates.typecheck).toHaveBeenCalled();
  });

  it('excludes performance gate unless includePerf is set', async () => {
    const result = await run(baseConfig({ parallel: true, includePerf: false }));
    expect(result.gates.map(g => g.gate)).not.toContain('performance');
  });
});

describe('runner — --test-store', () => {
  it('does not call writeTestStore when testStore is not set', async () => {
    await run(baseConfig());
    expect(vi.mocked(writeTestStore)).not.toHaveBeenCalled();
  });

  it('calls writeTestStore with result and store path when testStore is set', async () => {
    const storeDir = join(tmpdir(), `ats-store-${randomUUID()}`);
    const result = await run(baseConfig({ testStore: storeDir }));
    expect(vi.mocked(writeTestStore)).toHaveBeenCalledWith(result, storeDir);
  });

  it('passes the full RunResult to writeTestStore', async () => {
    const storeDir = join(tmpdir(), `ats-store-${randomUUID()}`);
    await run(baseConfig({ testStore: storeDir }));
    const [calledResult] = vi.mocked(writeTestStore).mock.calls[0];
    expect(calledResult.verdict).toBe('PASS');
    expect(calledResult.gates.length).toBeGreaterThan(0);
    expect(calledResult.timestamp).toBeDefined();
  });
});
