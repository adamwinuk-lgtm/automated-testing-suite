import { Command } from 'commander';
import { resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { GateName, RunConfig } from './types.js';
import { run } from './runner.js';
import { watch } from './watcher.js';
import { initProject } from './init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8')) as { version: string };

const VALID_GATES: GateName[] = [
  'lint', 'typecheck', 'tests', 'build', 'audit',
  'ci-config', 'e2e', 'security', 'performance', 'ui-behavior', 'a11y',
];

function parseGateList(value: string): GateName[] {
  return value.split(',').map(g => g.trim() as GateName).filter(g => VALID_GATES.includes(g));
}

const program = new Command();

program
  .name('ats')
  .description('Automated Testing Suite — multi-language quality gate CLI')
  .version(pkg.version);

function buildConfig(projectPath: string, options: Record<string, unknown>, reportDir = './reports'): RunConfig {
  return {
    projectPath: resolve(projectPath),
    skip: (options.skip as GateName[]) ?? [],
    only: (options.only as GateName[] | undefined) ?? null,
    failFast: options.failFast !== false,
    reportDir: resolve(options.reportDir as string ?? reportDir),
    includePerf: (options.includePerf as boolean) ?? false,
  };
}

program
  .command('run <project-path>')
  .description('Run the quality gate pipeline against a project')
  .option('--skip <gates>', 'Comma-separated list of gates to skip', parseGateList, [])
  .option('--only <gates>', 'Run only these gates (comma-separated)', parseGateList)
  .option('--no-fail-fast', 'Continue running gates even after a failure')
  .option('--report-dir <dir>', 'Directory to write JSON/HTML reports', './reports')
  .option('--include-perf', 'Include performance gate (Lighthouse/k6)', false)
  .action(async (projectPath: string, options) => {
    const config = buildConfig(projectPath, options);
    const result = await run(config);
    process.exit(result.verdict === 'FAIL' ? 1 : 0);
  });

program
  .command('watch <project-path>')
  .description('Watch for file changes and re-run the gate pipeline')
  .option('--skip <gates>', 'Comma-separated list of gates to skip', parseGateList, [])
  .option('--only <gates>', 'Run only these gates (comma-separated)', parseGateList)
  .option('--no-fail-fast', 'Continue running gates even after a failure')
  .option('--report-dir <dir>', 'Directory to write JSON/HTML reports', './reports')
  .option('--include-perf', 'Include performance gate (Lighthouse/k6)', false)
  .option('--debounce <ms>', 'Debounce delay in milliseconds', '500')
  .action(async (projectPath: string, options) => {
    const config = buildConfig(projectPath, options);
    const debounceMs = parseInt(options.debounce as string, 10);
    await watch(config, debounceMs);
  });

program
  .command('init [project-path]')
  .description('Scaffold an .ats.yml config file in a project directory')
  .option('--force', 'Overwrite existing .ats.yml', false)
  .action((projectPath: string | undefined, options: { force: boolean }) => {
    const target = projectPath ?? '.';
    const result = initProject(target, options.force);
    if (result.skipped) {
      console.log(`ats: .ats.yml already exists at ${result.configPath} (use --force to overwrite)`);
    } else {
      console.log(`ats: created ${result.configPath}`);
      console.log(result.content);
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
