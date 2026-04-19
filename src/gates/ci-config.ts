import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GateResult, ProjectContext } from '../types.js';

const REQUIRED_STEPS = ['lint', 'typecheck', 'test', 'build', 'audit'] as const;
const STEP_ALIASES: Record<string, string[]> = {
  typecheck: ['typecheck', 'tsc --noEmit', 'tsc'],
  test: ['test', 'vitest', 'jest'],
  audit: ['audit', 'npm audit', 'pnpm audit'],
};

function normalize(step: string): string[] {
  return STEP_ALIASES[step] ?? [step];
}

function findWorkflowFiles(rootPath: string): string[] {
  const dir = join(rootPath, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

function findMissingSteps(content: string): string[] {
  return REQUIRED_STEPS.filter((step) => {
    const aliases = normalize(step);
    return !aliases.some((alias) => content.includes(alias));
  });
}

export async function runCiConfig(ctx: ProjectContext): Promise<GateResult> {
  const start = Date.now();
  const workflows = findWorkflowFiles(ctx.rootPath);

  if (workflows.length === 0) {
    return {
      gate: 'ci-config',
      status: 'WARN',
      duration: Date.now() - start,
      fix: 'No GitHub Actions workflow found. Add .github/workflows/ci.yml with lint, typecheck, test, build, and audit steps.',
    };
  }

  const allMissing: string[] = [];

  for (const wfPath of workflows) {
    try {
      const content = readFileSync(wfPath, 'utf8');
      // Reusable workflows (triggered by workflow_call) are not CI pipelines
      if (content.includes('workflow_call:')) continue;
      const missing = findMissingSteps(content);
      if (missing.length > 0) {
        allMissing.push(`${wfPath}: missing steps: ${missing.join(', ')}`);
      }
    } catch {
      allMissing.push(`${wfPath}: could not read file`);
    }
  }

  const duration = Date.now() - start;

  if (allMissing.length > 0) {
    return {
      gate: 'ci-config',
      status: 'FAIL',
      duration,
      errors: allMissing,
      fix: 'Add missing CI steps: lint, typecheck, test, build, audit.',
    };
  }

  return { gate: 'ci-config', status: 'PASS', duration, output: `${workflows.length} workflow(s) verified` };
}
