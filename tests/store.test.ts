import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { RunResult } from '../src/types.js';
import { writeTestStore } from '../src/store.js';

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    config: {
      projectPath: '/tmp/my-project',
      skip: [],
      only: null,
      failFast: true,
      reportDir: '/tmp/reports',
      includePerf: false,
      parallel: false,
    },
    context: { rootPath: '/tmp/my-project', types: ['nodejs'], packageManager: 'npm', scripts: {} },
    gates: [{ gate: 'lint', status: 'PASS', duration: 42 }],
    verdict: 'PASS',
    durationMs: 100,
    timestamp: '2026-04-19T12:00:00.000Z',
    ...overrides,
  };
}

let storeDir: string;

beforeEach(() => {
  storeDir = join(tmpdir(), `ats-store-${randomUUID()}`);
  mkdirSync(storeDir, { recursive: true });
});

afterEach(() => {
  rmSync(storeDir, { recursive: true, force: true });
});

describe('writeTestStore', () => {
  it('creates a JSON file in the store directory', async () => {
    await writeTestStore(makeResult(), storeDir);
    const files = readdirSync(storeDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.json$/);
  });

  it('file name contains the project slug', async () => {
    await writeTestStore(makeResult(), storeDir);
    const files = readdirSync(storeDir);
    expect(files[0]).toContain('my-project');
  });

  it('file name contains the timestamp', async () => {
    await writeTestStore(makeResult(), storeDir);
    const files = readdirSync(storeDir);
    // timestamp 2026-04-19T12:00:00.000Z → colons and dots replaced with dashes
    expect(files[0]).toContain('2026-04-19T12-00-00-000Z');
  });

  it('writes valid JSON that round-trips back to RunResult', async () => {
    const result = makeResult();
    const filePath = await writeTestStore(result, storeDir);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as RunResult;
    expect(parsed.verdict).toBe('PASS');
    expect(parsed.durationMs).toBe(100);
    expect(parsed.gates).toHaveLength(1);
    expect(parsed.gates[0].gate).toBe('lint');
  });

  it('creates storeDir if it does not exist', async () => {
    const newDir = join(storeDir, 'nested', 'deep');
    await writeTestStore(makeResult(), newDir);
    const files = readdirSync(newDir);
    expect(files).toHaveLength(1);
  });

  it('returns the path to the written file', async () => {
    const filePath = await writeTestStore(makeResult(), storeDir);
    expect(filePath).toMatch(/\.json$/);
    expect(filePath).toContain(storeDir);
  });

  it('each run creates a separate file (multiple calls accumulate)', async () => {
    const r1 = makeResult({ timestamp: '2026-04-19T12:00:00.000Z' });
    const r2 = makeResult({ timestamp: '2026-04-19T12:01:00.000Z' });
    await writeTestStore(r1, storeDir);
    await writeTestStore(r2, storeDir);
    const files = readdirSync(storeDir);
    expect(files).toHaveLength(2);
  });

  it('sanitises special characters in project path to a safe slug', async () => {
    const result = makeResult({ config: { ...makeResult().config, projectPath: '/tmp/my weird@project!' } });
    await writeTestStore(result, storeDir);
    const files = readdirSync(storeDir);
    expect(files[0]).not.toMatch(/[ @!]/);
  });
});
