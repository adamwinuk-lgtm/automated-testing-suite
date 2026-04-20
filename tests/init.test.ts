import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

let tempDir: string;

function makeTemp(): string {
  tempDir = join(tmpdir(), `ats-init-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function makeNodeProject(dir: string) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test', scripts: {} }));
}

function makeReactProject(dir: string) {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'test', dependencies: { react: '18.0.0' }, scripts: {} }),
  );
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('initProject — creates .ats.yml', () => {
  it('creates .ats.yml in an empty directory', async () => {
    const { initProject } = await import('../src/init.js');
    const dir = makeTemp();

    const result = initProject(dir);
    expect(result.skipped).toBe(false);
    expect(existsSync(join(dir, '.ats.yml'))).toBe(true);
    expect(result.configPath).toContain('.ats.yml');
  });

  it('written file contains expected YAML sections', async () => {
    const { initProject } = await import('../src/init.js');
    const dir = makeTemp();
    makeNodeProject(dir);

    initProject(dir);
    const content = readFileSync(join(dir, '.ats.yml'), 'utf-8');
    expect(content).toMatch(/gates:/);
    expect(content).toMatch(/skip:/);
    expect(content).toMatch(/performance/);
    expect(content).toMatch(/report:/);
    expect(content).toMatch(/fail-fast:/);
  });

  it('detects nodejs project type in output', async () => {
    const { initProject } = await import('../src/init.js');
    const dir = makeTemp();
    makeNodeProject(dir);

    const result = initProject(dir);
    expect(result.content).toMatch(/nodejs/);
  });

  it('detects react project type in output', async () => {
    const { initProject } = await import('../src/init.js');
    const dir = makeTemp();
    makeReactProject(dir);

    const result = initProject(dir);
    expect(result.content).toMatch(/react/);
  });

  it('includes a11y hint for web projects', async () => {
    const { initProject } = await import('../src/init.js');
    const dir = makeTemp();
    makeReactProject(dir);

    const result = initProject(dir);
    expect(result.content).toMatch(/axe-core/);
  });
});

describe('initProject — skips if file exists', () => {
  it('returns skipped=true if .ats.yml already exists', async () => {
    const { initProject } = await import('../src/init.js');
    const dir = makeTemp();
    writeFileSync(join(dir, '.ats.yml'), '# existing config\n');

    const result = initProject(dir);
    expect(result.skipped).toBe(true);
  });

  it('does not overwrite existing file by default', async () => {
    const { initProject } = await import('../src/init.js');
    const dir = makeTemp();
    const original = '# do not overwrite me\n';
    writeFileSync(join(dir, '.ats.yml'), original);

    initProject(dir);
    const content = readFileSync(join(dir, '.ats.yml'), 'utf-8');
    expect(content).toBe(original);
  });

  it('overwrites if force=true', async () => {
    const { initProject } = await import('../src/init.js');
    const dir = makeTemp();
    writeFileSync(join(dir, '.ats.yml'), '# old config\n');
    makeNodeProject(dir);

    const result = initProject(dir, true);
    expect(result.skipped).toBe(false);
    const content = readFileSync(join(dir, '.ats.yml'), 'utf-8');
    expect(content).not.toBe('# old config\n');
    expect(content).toMatch(/gates:/);
  });
});

describe('initProject — non-web projects skip ui gates', () => {
  it('skips e2e, ui-behavior, a11y for python projects', async () => {
    const { initProject } = await import('../src/init.js');
    const dir = makeTemp();
    writeFileSync(join(dir, 'pyproject.toml'), '[tool.poetry]\nname = "test"\n');

    const result = initProject(dir);
    expect(result.content).toMatch(/e2e/);
    expect(result.content).toMatch(/ui-behavior/);
    expect(result.content).toMatch(/a11y/);
  });
});
