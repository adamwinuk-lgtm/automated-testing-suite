import chalk from 'chalk';
import type { RunResult } from '../types.js';

const STATUS_COLOURS = {
  PASS: chalk.green,
  FAIL: chalk.red,
  WARN: chalk.yellow,
  SKIP: chalk.grey,
} as const;

const VERDICT_COLOURS = {
  PASS: chalk.bgGreen.black,
  CONDITIONAL_PASS: chalk.bgYellow.black,
  FAIL: chalk.bgRed.white,
} as const;

export function printConsoleReport(result: RunResult): void {
  const projectName = result.config.projectPath.split('/').at(-1) ?? 'project';

  console.log('\n' + chalk.bold(`ATS — ${projectName}`));
  console.log(chalk.dim(`Detected: ${result.context.types.join(', ') || 'unknown'}`));
  console.log(chalk.dim('─'.repeat(52)));

  for (const gate of result.gates) {
    const colour = STATUS_COLOURS[gate.status];
    const badge = colour(`[${gate.status.padEnd(4)}]`);
    const name = gate.gate.padEnd(12);
    const ms = gate.duration > 0 ? chalk.dim(` ${gate.duration}ms`) : '';
    console.log(`  ${badge}  ${name}${ms}`);

    if (gate.status === 'FAIL' && gate.errors?.length) {
      for (const err of gate.errors.slice(0, 3)) {
        console.log(chalk.red(`           ${err}`));
      }
      if (gate.fix) {
        console.log(chalk.cyan(`           Fix: ${gate.fix}`));
      }
    }
  }

  console.log(chalk.dim('─'.repeat(52)));

  const verdictLabel = {
    PASS: '✅ PASS — ready for deploy',
    CONDITIONAL_PASS: '⚠️  CONDITIONAL PASS — review warnings',
    FAIL: '❌ FAIL — fix issues before proceeding',
  }[result.verdict];

  console.log('  ' + VERDICT_COLOURS[result.verdict](` ${verdictLabel} `));
  console.log(chalk.dim(`  Completed in ${result.durationMs}ms\n`));
}
