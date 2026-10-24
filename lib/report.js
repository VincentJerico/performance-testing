// Small helpers for experiments that print their own comparison table in handleSummary().

/** 1234567 -> "1,234,567" (k6's JS runtime has no locale support for toLocaleString). */
export function commas(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmt(v, unit) {
  if (v === undefined) return 'n/a';
  return unit === 'ms' ? `${v.toFixed(1)} ms` : `${commas(v)} ${unit}`;
}

/**
 * Build a Markdown table from k6 summary data.
 * rows: [{ label, metric }] where metric is a (sub)metric key, e.g. 'reader_latency{phase:baseline}'.
 */
export function table(data, rows, { unit = 'ms', stats = ['med', 'p(95)', 'max'] } = {}) {
  const head = `| | ${stats.join(' | ')} |\n|---|${stats.map(() => '---:').join('|')}|`;
  const body = rows.map(({ label, metric }) => {
    const values = data.metrics[metric]?.values ?? {};
    return `| ${label} | ${stats.map((s) => fmt(values[s], unit)).join(' | ')} |`;
  });
  return [head, ...body].join('\n');
}

/** Informational thresholds: always pass, but make k6 compute the tagged sub-metrics. */
export function expose(metric, tagSets) {
  const t = {};
  for (const tags of tagSets) t[`${metric}{${tags}}`] = ['max>=0'];
  return t;
}
