import chokidar from 'chokidar';
import { relative } from 'node:path';
import type { RunConfig } from './types.js';
import { run } from './runner.js';

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/__pycache__/**',
  '**/*.pyc',
  '**/reports/**',
  '**/*.log',
];

function clearScreen() {
  process.stdout.write('\x1Bc');
}

export async function watch(config: RunConfig, debounceMs = 500): Promise<void> {
  console.log(`\n👁  Watching ${config.projectPath} (press Ctrl+C to stop)\n`);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  async function runOnce(changedFile?: string) {
    if (running) return;
    running = true;

    clearScreen();
    if (changedFile) {
      const rel = relative(config.projectPath, changedFile);
      console.log(`\n⟳  Change detected: ${rel}\n`);
    } else {
      console.log(`\n⟳  Running initial check...\n`);
    }

    try {
      await run(config);
    } catch (err) {
      console.error('Runner error:', err);
    } finally {
      running = false;
      console.log(`\n👁  Watching for changes...\n`);
    }
  }

  function schedule(changedFile?: string) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runOnce(changedFile), debounceMs);
  }

  const watcher = chokidar.watch(config.projectPath, {
    ignored: IGNORE_PATTERNS,
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });

  watcher.on('change', (path) => schedule(path));
  watcher.on('add', (path) => schedule(path));
  watcher.on('unlink', (path) => schedule(path));

  watcher.on('error', (err) => console.error('Watcher error:', err));

  // Run immediately on start
  await runOnce();

  // Keep process alive
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      console.log('\n\nStopping watcher...');
      void watcher.close().then(resolve);
    });
    process.on('SIGTERM', () => {
      void watcher.close().then(resolve);
    });
  });
}
