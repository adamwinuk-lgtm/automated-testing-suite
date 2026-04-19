import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunResult } from '../types.js';

function reportFilename(result: RunResult, ext: string): string {
  const projectName = result.config.projectPath.split('/').at(-1) ?? 'project';
  const ts = result.timestamp.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `${projectName}_${ts}.${ext}`;
}

export async function writeJsonReport(result: RunResult): Promise<string> {
  const filename = reportFilename(result, 'json');
  const outPath = join(result.config.reportDir, filename);
  await writeFile(outPath, JSON.stringify(result, null, 2), 'utf8');
  return outPath;
}
