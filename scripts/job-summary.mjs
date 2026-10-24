// Turn k6 summary exports into a Markdown table for the GitHub Actions job summary.
//   node scripts/job-summary.mjs reports/load-summary.json >> "$GITHUB_STEP_SUMMARY"
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

for (const file of process.argv.slice(2)) {
  const { metrics } = JSON.parse(readFileSync(file, 'utf8'));
  const name = basename(file).replace(/-summary\.json$/, '');
  const rows = [];
  let allOk = true;

  for (const [key, m] of Object.entries(metrics)) {
    if (!m.thresholds) continue;
    for (const [expr, failed] of Object.entries(m.thresholds)) {
      const ok = failed === false || failed?.ok === true;
      allOk &&= ok;
      const p95 = m['p(95)'];
      const observed =
        p95 !== undefined
          ? `p95 ${p95.toFixed(1)} ms`
          : `${((m.value ?? m.rate) * 100).toFixed(2)}%`;
      rows.push(`| \`${key}\` | \`${expr}\` | ${observed} | ${ok ? 'pass' : '**FAIL**'} |`);
    }
  }

  console.log(`### ${name}: ${allOk ? 'all SLOs met' : 'SLO breached'}\n`);
  console.log('| Metric | Threshold | Observed | Result |\n|---|---|---|---|');
  console.log(rows.sort().join('\n'));
  console.log('');
}
