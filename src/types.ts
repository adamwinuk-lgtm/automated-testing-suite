export type GateStatus = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';

export type GateName =
  | 'lint'
  | 'typecheck'
  | 'tests'
  | 'build'
  | 'audit'
  | 'ci-config'
  | 'e2e'
  | 'security'
  | 'performance'
  | 'ui-behavior'
  | 'a11y';

export interface GateResult {
  gate: GateName;
  status: GateStatus;
  duration: number;
  output?: string;
  errors?: string[];
  fix?: string;
}

export type ProjectType = 'nodejs' | 'python' | 'react' | 'docker';

export interface ProjectContext {
  rootPath: string;
  types: ProjectType[];
  packageManager: 'npm' | 'pnpm' | 'yarn' | null;
  scripts: Record<string, string>;
}

export interface RunConfig {
  projectPath: string;
  skip: GateName[];
  only: GateName[] | null;
  failFast: boolean;
  reportDir: string;
  includePerf: boolean;
  parallel: boolean;
  testStore?: string;
}

export type Verdict = 'PASS' | 'CONDITIONAL_PASS' | 'FAIL';

export interface RunResult {
  config: RunConfig;
  context: ProjectContext;
  gates: GateResult[];
  verdict: Verdict;
  durationMs: number;
  timestamp: string;
}
