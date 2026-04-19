import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ProjectContext } from '../../src/types.js';
import { runCiConfig } from '../../src/gates/ci-config.js';

let tempDir: string;

function makeTemp(): string {
  tempDir = join(tmpdir(), `ats-ci-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function ctx(rootPath: string): ProjectContext {
  return { rootPath, types: ['nodejs'], packageManager: 'pnpm' };
}

const FULL_WORKFLOW = `
name: CI
on: [push]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
      - run: pnpm audit --audit-level=high
`;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('runCiConfig — WARN', () => {
  it('WARNs when no .github/workflows directory exists', async () => {
    const dir = makeTemp();
    const result = await runCiConfig(ctx(dir));
    expect(result.status).toBe('WARN');
    expect(result.fix).toMatch(/\.github\/workflows/);
  });

  it('WARNs when workflows dir exists but is empty', async () => {
    const dir = makeTemp();
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    const result = await runCiConfig(ctx(dir));
    expect(result.status).toBe('WARN');
  });
});

describe('runCiConfig — PASS', () => {
  it('PASSes when workflow contains all required steps', async () => {
    const dir = makeTemp();
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), FULL_WORKFLOW);

    const result = await runCiConfig(ctx(dir));
    expect(result.status).toBe('PASS');
    expect(result.output).toMatch(/1 workflow/);
  });
});

describe('runCiConfig — FAIL', () => {
  it('FAILs when workflow is missing required steps', async () => {
    const dir = makeTemp();
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(
      join(dir, '.github', 'workflows', 'ci.yml'),
      'name: CI\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n',
    );

    const result = await runCiConfig(ctx(dir));
    expect(result.status).toBe('FAIL');
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toMatch(/missing steps/);
  });

  it('FAILs listing each missing step', async () => {
    const dir = makeTemp();
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    // Only has lint — missing typecheck, test, build, audit
    writeFileSync(
      join(dir, '.github', 'workflows', 'ci.yml'),
      'name: CI\non: [push]\njobs:\n  ci:\n    steps:\n      - run: pnpm lint\n',
    );

    const result = await runCiConfig(ctx(dir));
    expect(result.status).toBe('FAIL');
    const errorText = result.errors!.join(' ');
    expect(errorText).toMatch(/typecheck/);
    expect(errorText).toMatch(/test/);
    expect(errorText).toMatch(/build/);
    expect(errorText).toMatch(/audit/);
  });
});
