import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import type { RunResult } from './types.js';

export async function writeTestStore(result: RunResult, storeDir: string): Promise<string> {
  await mkdir(storeDir, { recursive: true });

  const projectSlug = basename(result.config.projectPath).replace(/[^a-z0-9-]/gi, '-');
  const ts = result.timestamp.replace(/[:.]/g, '-');
  const fileName = `${projectSlug}-${ts}.json`;
  const filePath = resolve(storeDir, fileName);

  await writeFile(filePath, JSON.stringify(result, null, 2), 'utf-8');
  return filePath;
}
