import { Command } from 'commander';
import { resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { GateName, RunConfig } from './types.js';
import { run } from './runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8')) as { version: string };

const VALID_GATES: GateName[] = [
  'lint', 'typecheck', 'tests', 'build', 'audit',
  'ci-config', 'e2e', 'security', 'performance',
];

function parseGateList(value: string): GateName[] {
  return value.split(',').map(g => g.trim() as GateName).filter(g => VALID_GATES.includes(g));
}

const program = new Command();

program
  .name('ats')
  .description('Automated Testing Suite — multi-language quality gate CLI')
  .version(pkg.version);

program
  .command('run <project-path>')
  .description('Run the quality gate pipeline against a project')
  .option('--skip <gates>', 'Comma-separated list of gates to skip', parseGateList, [])
  .option('--only <gates>', 'Run only these gates (comma-separated)', parseGateList)
  .option('--no-fail-fast', 'Continue running gates even after a failure')
  .option('--report-dir <dir>', 'Directory to write JSON/HTML reports', './reports')
  .option('--include-perf', 'Include performance gate (Lighthouse/k6)', false)
  .action(async (projectPath: string, options) => {
    const config: RunConfig = {
      projectPath: resolve(projectPath),
      skip: options.skip ?? [],
      only: options.only ?? null,
      failFast: options.failFast !== false,
      reportDir: resolve(options.reportDir),
      includePerf: options.includePef ?? false,
    };

    const result = await run(config);
    process.exit(result.verdict === 'FAIL' ? 1 : 0);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
