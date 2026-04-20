import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { RunResult } from '../../src/types.js';

const { writeJsonReport } = await import('../../src/reporters/json.js');

let tempDir: string;

function makeTemp(): string {
  tempDir = join(tmpdir(), `ats-json-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    config: {
      projectPath: '/tmp/my-project',
      skip: [],
      only: null,
      failFast: false,
      reportDir: tempDir,
      includePerf: false,
    },
    context: { rootPath: '/tmp/my-project', types: ['nodejs'], packageManager: 'npm', scripts: {} },
    gates: [
      { gate: 'lint', status: 'PASS', duration: 123 },
      { gate: 'typecheck', status: 'FAIL', duration: 456, errors: ['src/index.ts:1 error TS2345'] },
    ],
    verdict: 'FAIL',
    durationMs: 600,
    timestamp: '2026-04-19T08:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('writeJsonReport', () => {
  it('writes a valid JSON file to the report directory', async () => {
    const dir = makeTemp();
    const result = makeResult();
    result.config.reportDir = dir;

    const outPath = await writeJsonReport(result);

    expect(outPath).toMatch(/\.json$/);
    const raw = readFileSync(outPath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('filename contains project name and timestamp', async () => {
    const dir = makeTemp();
    const result = makeResult();
    result.config.reportDir = dir;

    const outPath = await writeJsonReport(result);

    expect(outPath).toContain('my-project');
    expect(outPath).toContain('2026-04-19');
  });

  it('JSON output contains verdict, gates, and context', async () => {
    const dir = makeTemp();
    const result = makeResult();
    result.config.reportDir = dir;

    const outPath = await writeJsonReport(result);
    const parsed = JSON.parse(readFileSync(outPath, 'utf8')) as RunResult;

    expect(parsed.verdict).toBe('FAIL');
    expect(parsed.gates).toHaveLength(2);
    expect(parsed.gates[0].gate).toBe('lint');
    expect(parsed.gates[0].status).toBe('PASS');
    expect(parsed.context.types).toContain('nodejs');
  });

  it('returns the output file path', async () => {
    const dir = makeTemp();
    const result = makeResult();
    result.config.reportDir = dir;

    const outPath = await writeJsonReport(result);

    expect(outPath).toMatch(new RegExp(`^${dir}`));
  });
});
