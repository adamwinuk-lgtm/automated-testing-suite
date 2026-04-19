import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { detectProject } from '../src/detectors/index.js';

let tempDir: string;

function makeTemp(): string {
  tempDir = join(tmpdir(), `ats-test-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('detectProject', () => {
  it('returns nodejs for a dir with package.json', () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    const ctx = detectProject(dir);
    expect(ctx.types).toContain('nodejs');
    expect(ctx.rootPath).toBe(dir);
  });

  it('returns react for a dir with react in dependencies', () => {
    const dir = makeTemp();
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'test', dependencies: { react: '^18.0.0' } }),
    );
    const ctx = detectProject(dir);
    expect(ctx.types).toContain('react');
    expect(ctx.types).toContain('nodejs');
  });

  it('returns python for a dir with pyproject.toml', () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'pyproject.toml'), '[tool.poetry]\nname = "test"');
    const ctx = detectProject(dir);
    expect(ctx.types).toContain('python');
  });

  it('returns docker for a dir with Dockerfile', () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'Dockerfile'), 'FROM node:20');
    const ctx = detectProject(dir);
    expect(ctx.types).toContain('docker');
  });

  it('detects pnpm via pnpm-lock.yaml', () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0');
    const ctx = detectProject(dir);
    expect(ctx.packageManager).toBe('pnpm');
  });

  it('detects yarn via yarn.lock', () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    writeFileSync(join(dir, 'yarn.lock'), '# yarn lockfile v1');
    const ctx = detectProject(dir);
    expect(ctx.packageManager).toBe('yarn');
  });

  it('returns empty types for an empty dir', () => {
    const dir = makeTemp();
    const ctx = detectProject(dir);
    expect(ctx.types).toHaveLength(0);
    expect(ctx.packageManager).toBeNull();
  });
});
