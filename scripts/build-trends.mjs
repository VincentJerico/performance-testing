// Build the trend page (one static HTML file, no external resources) from history.jsonl.
//
//   node scripts/build-trends.mjs history.jsonl site/
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { byDate, readHistory, SERIES, short, day } from './history.mjs';

const REPO = 'https://github.com/VincentJerico/performance-testing';
const W = 560;
const H = 200;
const PAD = { top: 16, right: 16, bottom: 28, left: 52 };

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const num = (v) => v.toLocaleString('en-US');

/** Round the axis top up to a readable number. */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

function chart(series, history) {
  const points = history
    .map((r) => ({ r, v: series.value(r) }))
    .filter((p) => p.v !== undefined)
    .map((p) => ({ ...p, gate: series.gate?.(p.r), note: series.note?.(p.r) }));
  if (!points.length) return '';

  const top = niceMax(Math.max(...points.map((p) => p.v), series.limit?.value ?? 0) * 1.1);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v) => PAD.top + plotH - (v / top) * plotH;

  const grid = [0, 0.5, 1]
    .map((f) => {
      const v = top * f;
      return `<line class="grid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis" x="${PAD.left - 8}" y="${y(v) + 4}" text-anchor="end">${num(Number(v.toPrecision(3)))}</text>`;
    })
    .join('');
  const limit = series.limit
    ? `<line class="limit" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(series.limit.value)}" y2="${y(series.limit.value)}"/>
      <text class="axis" x="${W - PAD.right}" y="${y(series.limit.value) - 6}" text-anchor="end">${esc(series.limit.label)}</text>`
    : '';
  const line = points
    .map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(' ');
  const marks = points
    .map((p, i) => {
      const tip = [
        `${day(p.r.date)} · TaskFlow ${short(p.r.taskflowRef)}`,
        `${num(p.v)} ${series.unit}${p.gate ? ` · gate ${p.gate.toUpperCase()}` : ''}`,
        p.note,
      ]
        .filter(Boolean)
        .join('\n');
      const cls = p.gate === 'fail' ? 'mark fail' : 'mark';
      return `<a href="${esc(p.r.runUrl)}" aria-label="${esc(tip.replace(/\n/g, '. '))}">
        <circle class="hit" cx="${x(i)}" cy="${y(p.v)}" r="12" data-tip="${esc(tip)}"/>
        <circle class="${cls}" cx="${x(i)}" cy="${y(p.v)}" r="4"/></a>`;
    })
    .join('');
  const xLabels = [0, points.length - 1]
    .filter((i, k, a) => a.indexOf(i) === k)
    .map(
      (i) =>
        `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="${points.length === 1 ? 'middle' : i ? 'end' : 'start'}">${day(points[i].r.date)}</text>`,
    )
    .join('');

  const latest = points.at(-1);
  const fails = points.filter((p) => p.gate === 'fail').length;
  const rows = points
    .slice()
    .reverse()
    .map(
      (p) =>
        `<tr><td><a href="${esc(p.r.runUrl)}">${day(p.r.date)}</a></td><td><code>${short(p.r.taskflowRef)}</code></td><td class="n">${num(p.v)}</td>${series.gate ? `<td>${p.gate ?? '-'}</td>` : ''}</tr>`,
    )
    .join('');

  return `<section class="card" id="${series.id}">
  <h2>${esc(series.title)}</h2>
  <p class="stat"><span class="value">${num(latest.v)}</span> <span class="unit">${esc(series.unit)}</span>
    <span class="meta">latest, ${day(latest.r.date)}${latest.gate ? ` · gate ${latest.gate === 'fail' ? '<strong class="bad">FAIL</strong>' : 'pass'}` : ''}</span></p>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.title)}: ${points.length} runs, latest ${num(latest.v)} ${esc(series.unit)}">
    ${grid}${limit}
    <path class="line" d="${line}"/>
    ${marks}${xLabels}
  </svg>
  ${series.gate ? `<p class="key"><svg width="14" height="14" aria-hidden="true"><circle class="mark" cx="7" cy="7" r="4"/></svg> gate passed <svg width="14" height="14" aria-hidden="true"><circle class="mark fail" cx="7" cy="7" r="4"/></svg> gate failed (${fails} of ${points.length} runs)</p>` : ''}
  <details><summary>Data table</summary>
    <table><thead><tr><th>Run</th><th>TaskFlow</th><th class="n">${esc(series.unit)}</th>${series.gate ? '<th>Gate</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>
  </details>
</section>`;
}

export function buildTrends(records) {
  const history = byDate(records);
  const latest = history.at(-1);
  const cards = SERIES.map((s) => chart(s, history))
    .filter(Boolean)
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TaskFlow performance trends</title>
<meta name="description" content="Nightly k6 results for TaskFlow over time, from VincentJerico/performance-testing.">
<style>
  :root {
    color-scheme: light dark;
    --bg: #fafaf7; --surface: #ffffff; --line: #e3e3de; --text: #111418; --muted: #555d66;
    --mark: #0b5fd8; --fail: #cf222e; --link: #0b5fd8;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0b0f14; --surface: #11161d; --line: #232b36; --text: #e6edf3; --muted: #9aa4af;
      --mark: #4493f8; --fail: #f85149; --link: #58a6ff; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 16px/1.5 -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; }
  main { max-width: 1240px; margin: 0 auto; padding: 40px 16px 64px; }
  a { color: var(--link); }
  header h1 { font-size: 1.75rem; margin: 0 0 4px; }
  header p { margin: 0; color: var(--muted); max-width: 72ch; }
  .grid-cards { display: grid; gap: 16px; margin-top: 28px;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 520px), 1fr)); }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 18px 18px 12px; }
  .card h2 { font-size: 0.95rem; font-weight: 600; margin: 0; }
  .stat { margin: 6px 0 8px; }
  .value { font-size: 1.75rem; font-weight: 600; font-variant-numeric: tabular-nums; }
  .unit, .meta, .key { color: var(--muted); font-size: 0.85rem; }
  .meta { margin-left: 8px; }
  .bad { color: var(--fail); }
  svg { display: block; width: 100%; height: auto; overflow: visible; }
  .grid { stroke: var(--line); stroke-width: 1; }
  .limit { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 4 4; }
  .axis { fill: var(--muted); font: 11px var(--mono); }
  .line { fill: none; stroke: var(--mark); stroke-width: 2; stroke-linejoin: round; }
  .mark { fill: var(--mark); stroke: var(--surface); stroke-width: 2; pointer-events: none; }
  .mark.fail { fill: var(--surface); stroke: var(--fail); stroke-width: 2.5; }
  .hit { fill: transparent; cursor: pointer; }
  a:focus-visible .mark { stroke: var(--text); stroke-width: 3; }
  .key svg { display: inline; vertical-align: -2px; width: 14px; }
  details { margin-top: 8px; font-size: 0.85rem; }
  summary { cursor: pointer; color: var(--muted); }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--line); }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  #tip { position: fixed; pointer-events: none; background: var(--text); color: var(--bg);
    font: 12px/1.4 var(--mono); padding: 6px 8px; border-radius: 4px; white-space: pre; display: none; z-index: 1; }
  footer { margin-top: 32px; color: var(--muted); font-size: 0.85rem; }
</style>
</head>
<body>
<main>
<header>
  <h1>TaskFlow performance trends</h1>
  <p>Nightly k6 runs against <a href="https://github.com/VincentJerico/taskflow-under-test">TaskFlow</a>,
  ${history.length} runs from ${day(history[0].date)} to ${day(latest.date)}. Latest:
  <a href="${esc(latest.runUrl)}">run ${esc(latest.runId)}</a>, TaskFlow <code>${short(latest.taskflowRef)}</code>.
  Every point is one CI run; select it to open the run. GitHub-hosted runners vary from night to
  night, so read single points with care and look at the line.</p>
</header>
<div class="grid-cards">
${cards}
</div>
<footer>
  Built by <code>scripts/build-trends.mjs</code> from the results history in
  <a href="${REPO}">VincentJerico/performance-testing</a>.
  Findings: <a href="${REPO}/blob/main/docs/FINDINGS.md">FINDINGS.md</a>.
  Latest run in full: <a href="${REPO}/blob/main/docs/results/LATEST.md">LATEST.md</a>.
</footer>
</main>
<div id="tip" role="presentation"></div>
<script>
  // Hover tooltip; the same text is each point's accessible name and in the data tables.
  const tip = document.getElementById('tip');
  for (const hit of document.querySelectorAll('.hit')) {
    hit.addEventListener('pointermove', (e) => {
      tip.textContent = hit.dataset.tip;
      tip.style.display = 'block';
      tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px';
      tip.style.top = e.clientY + 14 + 'px';
    });
    hit.addEventListener('pointerleave', () => (tip.style.display = 'none'));
  }
</script>
</body>
</html>
`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [historyFile = 'history.jsonl', outDir = 'site'] = process.argv.slice(2);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), buildTrends(readHistory(historyFile)));
  console.log(`wrote ${join(outDir, 'index.html')}`);
}
