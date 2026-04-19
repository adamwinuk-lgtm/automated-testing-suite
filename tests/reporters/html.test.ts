import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { RunResult } from '../../src/types.js';

const { writeHtmlReport } = await import('../../src/reporters/html.js');

let tempDir: string;

function makeTemp(): string {
  tempDir = join(tmpdir(), `ats-html-${randomUUID()}`);
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
    context: { rootPath: '/tmp/my-project', types: ['nodejs'], packageManager: 'npm' },
    gates: [
      { gate: 'lint', status: 'PASS', duration: 100 },
      { gate: 'typecheck', status: 'FAIL', duration: 200, errors: ['src/x.ts:1 error TS2345'], fix: 'Run: npx tsc --noEmit' },
      { gate: 'tests', status: 'SKIP', duration: 0 },
    ],
    verdict: 'FAIL',
    durationMs: 400,
    timestamp: '2026-04-19T08:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('writeHtmlReport', () => {
  it('writes an HTML file to the report directory', async () => {
    const dir = makeTemp();
    const result = makeResult();
    result.config.reportDir = dir;

    const outPath = await writeHtmlReport(result);

    expect(outPath).toMatch(/\.html$/);
    const html = readFileSync(outPath, 'utf8');
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('filename contains project name and timestamp', async () => {
    const dir = makeTemp();
    const result = makeResult();
    result.config.reportDir = dir;

    const outPath = await writeHtmlReport(result);

    expect(outPath).toContain('my-project');
    expect(outPath).toContain('2026-04-19');
  });

  it('HTML contains gate names and statuses', async () => {
    const dir = makeTemp();
    const result = makeResult();
    result.config.reportDir = dir;

    const outPath = await writeHtmlReport(result);
    const html = readFileSync(outPath, 'utf8');

    expect(html).toContain('lint');
    expect(html).toContain('PASS');
    expect(html).toContain('typecheck');
    expect(html).toContain('FAIL');
    expect(html).toContain('SKIP');
  });

  it('HTML shows the verdict', async () => {
    const dir = makeTemp();
    const result = makeResult();
    result.config.reportDir = dir;

    const outPath = await writeHtmlReport(result);
    const html = readFileSync(outPath, 'utf8');

    expect(html).toContain('FAIL');
  });

  it('HTML includes fix hint for failing gates', async () => {
    const dir = makeTemp();
    const result = makeResult();
    result.config.reportDir = dir;

    const outPath = await writeHtmlReport(result);
    const html = readFileSync(outPath, 'utf8');

    expect(html).toContain('Fix:');
    expect(html).toContain('npx tsc --noEmit');
  });

  it('HTML escapes special characters in error messages', async () => {
    const dir = makeTemp();
    const result = makeResult({
      gates: [
        {
          gate: 'lint',
          status: 'FAIL',
          duration: 50,
          errors: ['src/x.ts: error <T> & "quoted"'],
        },
      ],
    });
    result.config.reportDir = dir;

    const outPath = await writeHtmlReport(result);
    const html = readFileSync(outPath, 'utf8');

    expect(html).not.toContain('<T>');
    expect(html).toContain('&lt;T&gt;');
    expect(html).toContain('&amp;');
  });
});
