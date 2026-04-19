import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GateResult, RunResult } from '../types.js';

function reportFilename(result: RunResult, ext: string): string {
  const projectName = result.config.projectPath.split('/').at(-1) ?? 'project';
  const ts = result.timestamp.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `${projectName}_${ts}.${ext}`;
}

const STATUS_COLOURS: Record<string, string> = {
  PASS: '#22c55e',
  FAIL: '#ef4444',
  WARN: '#f59e0b',
  SKIP: '#6b7280',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function gateRow(g: GateResult): string {
  const colour = STATUS_COLOURS[g.status] ?? '#6b7280';
  const errors = g.errors?.map((e) => `<li>${esc(e)}</li>`).join('') ?? '';
  const fix = g.fix
    ? `<p style="color:#38bdf8;margin:4px 0 0;font-size:0.85em">Fix: ${esc(g.fix)}</p>`
    : '';
  return `
    <tr>
      <td>${g.gate}</td>
      <td><span style="color:${colour};font-weight:bold">${g.status}</span></td>
      <td>${g.duration > 0 ? `${g.duration}ms` : '—'}</td>
      <td>${errors ? `<ul style="margin:0;padding-left:16px">${errors}</ul>` : ''}${fix}</td>
    </tr>`;
}

export async function writeHtmlReport(result: RunResult): Promise<string> {
  const projectName = result.config.projectPath.split('/').at(-1) ?? 'project';
  const verdictColour = { PASS: '#22c55e', CONDITIONAL_PASS: '#f59e0b', FAIL: '#ef4444' }[result.verdict];

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ATS Report — ${projectName}</title>
  <style>
    body { font-family: system-ui, sans-serif; background:#0f172a; color:#e2e8f0; padding:2rem; }
    h1 { color:#38bdf8; } h2 { color:#94a3b8; font-size:0.9rem; font-weight:normal; }
    table { width:100%; border-collapse:collapse; margin-top:1.5rem; }
    th { text-align:left; padding:0.5rem 0.75rem; background:#1e293b; color:#94a3b8; font-size:0.8rem; text-transform:uppercase; }
    td { padding:0.5rem 0.75rem; border-bottom:1px solid #1e293b; font-size:0.9rem; }
    .verdict { display:inline-block; padding:0.4rem 1rem; border-radius:6px; color:#fff; font-weight:bold; background:${verdictColour}; margin-top:1.5rem; }
    .meta { color:#64748b; font-size:0.8rem; margin-top:0.5rem; }
  </style>
</head>
<body>
  <h1>ATS Report — ${projectName}</h1>
  <h2>Project types: ${result.context.types.join(', ') || 'unknown'}</h2>
  <table>
    <thead><tr><th>Gate</th><th>Status</th><th>Duration</th><th>Errors</th></tr></thead>
    <tbody>${result.gates.map(gateRow).join('')}</tbody>
  </table>
  <div class="verdict">${result.verdict.replace('_', ' ')}</div>
  <p class="meta">Run at ${result.timestamp} · ${result.durationMs}ms total</p>
</body>
</html>`;

  const filename = reportFilename(result, 'html');
  const outPath = join(result.config.reportDir, filename);
  await writeFile(outPath, html, 'utf8');
  return outPath;
}
