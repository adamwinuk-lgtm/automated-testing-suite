import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

vi.mock('../src/runner.js', () => ({ run: vi.fn().mockResolvedValue({ verdict: 'PASS' }) }));

// Chokidar mock — fresh emitter per test via factory
const makeEmitter = () => ({
  _handlers: {} as Record<string, ((...args: unknown[]) => void)[]>,
  on(event: string, handler: (...args: unknown[]) => void) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(handler);
    return this;
  },
  emit(event: string, ...args: unknown[]) {
    for (const h of this._handlers[event] ?? []) h(...args);
  },
  close: vi.fn().mockResolvedValue(undefined),
});

let currentEmitter = makeEmitter();

vi.mock('chokidar', () => ({
  default: { watch: vi.fn(() => currentEmitter) },
}));

const { run: mockRun } = await import('../src/runner.js');
import type { RunConfig } from '../src/types.js';

let tempDir: string;
let processOnSpy: ReturnType<typeof vi.spyOn>;

function baseConfig(): RunConfig {
  return {
    projectPath: tempDir,
    skip: [],
    only: null,
    failFast: true,
    reportDir: join(tempDir, 'reports'),
    includePerf: false,
  };
}

beforeEach(async () => {
  tempDir = join(tmpdir(), `ats-watch-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  currentEmitter = makeEmitter();
  vi.clearAllMocks();
  vi.mocked(mockRun).mockResolvedValue({ verdict: 'PASS' } as never);

  // Reset module so each test gets a fresh watcher with no carry-over state
  vi.resetModules();
  vi.mock('../src/runner.js', () => ({ run: vi.fn().mockResolvedValue({ verdict: 'PASS' }) }));
  vi.mock('chokidar', () => ({ default: { watch: vi.fn(() => currentEmitter) } }));

  processOnSpy = vi.spyOn(process, 'on');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  processOnSpy.mockRestore();
});

describe('watcher — initial run', () => {
  it('calls run immediately on start', async () => {
    const { run: freshRun } = await import('../src/runner.js');
    vi.mocked(freshRun).mockResolvedValue({ verdict: 'PASS' } as never);

    processOnSpy.mockImplementation((event, handler) => {
      if (event === 'SIGINT') setTimeout(() => (handler as () => void)(), 30);
      return process;
    });

    const { watch } = await import('../src/watcher.js');
    await watch(baseConfig(), 100);

    expect(vi.mocked(freshRun)).toHaveBeenCalledTimes(1);
  });

  it('passes the config to runner unchanged', async () => {
    const { run: freshRun } = await import('../src/runner.js');
    vi.mocked(freshRun).mockResolvedValue({ verdict: 'PASS' } as never);
    const config = baseConfig();

    processOnSpy.mockImplementation((event, handler) => {
      if (event === 'SIGINT') setTimeout(() => (handler as () => void)(), 30);
      return process;
    });

    const { watch } = await import('../src/watcher.js');
    await watch(config, 100);

    expect(vi.mocked(freshRun)).toHaveBeenCalledWith(config);
  });
});

describe('watcher — chokidar setup', () => {
  it('watches the project path with correct options', async () => {
    const chokidar = await import('chokidar');
    const { run: freshRun } = await import('../src/runner.js');
    vi.mocked(freshRun).mockResolvedValue({ verdict: 'PASS' } as never);

    processOnSpy.mockImplementation((event, handler) => {
      if (event === 'SIGINT') setTimeout(() => (handler as () => void)(), 30);
      return process;
    });

    const { watch } = await import('../src/watcher.js');
    await watch(baseConfig(), 100);

    expect(vi.mocked(chokidar.default.watch)).toHaveBeenCalledWith(
      tempDir,
      expect.objectContaining({ ignoreInitial: true, persistent: true }),
    );
  });

  it('ignores node_modules and dist', async () => {
    const chokidar = await import('chokidar');
    const { run: freshRun } = await import('../src/runner.js');
    vi.mocked(freshRun).mockResolvedValue({ verdict: 'PASS' } as never);

    processOnSpy.mockImplementation((event, handler) => {
      if (event === 'SIGINT') setTimeout(() => (handler as () => void)(), 30);
      return process;
    });

    const { watch } = await import('../src/watcher.js');
    await watch(baseConfig(), 100);

    const [, options] = vi.mocked(chokidar.default.watch).mock.calls[0];
    const ignored = options?.ignored as string[];
    expect(ignored).toContain('**/node_modules/**');
    expect(ignored).toContain('**/dist/**');
  });

  it('closes the watcher on SIGINT', async () => {
    const { run: freshRun } = await import('../src/runner.js');
    vi.mocked(freshRun).mockResolvedValue({ verdict: 'PASS' } as never);

    processOnSpy.mockImplementation((event, handler) => {
      if (event === 'SIGINT') setTimeout(() => (handler as () => void)(), 30);
      return process;
    });

    const { watch } = await import('../src/watcher.js');
    await watch(baseConfig(), 100);

    expect(currentEmitter.close).toHaveBeenCalled();
  });
});

describe('watcher — debounce', () => {
  it('re-runs pipeline after a file change', async () => {
    const { run: freshRun } = await import('../src/runner.js');
    vi.mocked(freshRun).mockResolvedValue({ verdict: 'PASS' } as never);

    processOnSpy.mockImplementation((event, handler) => {
      if (event === 'SIGINT') setTimeout(() => (handler as () => void)(), 300);
      return process;
    });

    const { watch } = await import('../src/watcher.js');
    const watchPromise = watch(baseConfig(), 50);

    // Wait for initial run, then fire a change
    await new Promise(r => setTimeout(r, 60));
    currentEmitter.emit('change', join(tempDir, 'src', 'index.ts'));
    await watchPromise;

    expect(vi.mocked(freshRun)).toHaveBeenCalledTimes(2);
  }, 10000);

  it('debounces multiple rapid changes into a single run', async () => {
    const { run: freshRun } = await import('../src/runner.js');
    vi.mocked(freshRun).mockResolvedValue({ verdict: 'PASS' } as never);

    processOnSpy.mockImplementation((event, handler) => {
      if (event === 'SIGINT') setTimeout(() => (handler as () => void)(), 400);
      return process;
    });

    const { watch } = await import('../src/watcher.js');
    const watchPromise = watch(baseConfig(), 100);

    await new Promise(r => setTimeout(r, 60));
    // Fire 3 rapid changes within the debounce window
    currentEmitter.emit('change', join(tempDir, 'a.ts'));
    currentEmitter.emit('change', join(tempDir, 'b.ts'));
    currentEmitter.emit('change', join(tempDir, 'c.ts'));
    await watchPromise;

    // Initial + 1 debounced (not 3)
    expect(vi.mocked(freshRun)).toHaveBeenCalledTimes(2);
  }, 10000);
});
