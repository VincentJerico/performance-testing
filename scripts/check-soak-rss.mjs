// OBS-002 memory gate: does the server's memory keep climbing during the soak?
// Reads reports/soak-rss.csv (scripts/sample-rss.sh) and fits a line to the second half of the
// samples taken after warm-up. A leak keeps that slope up; normal heap growth flattens out.
//
//   node scripts/check-soak-rss.mjs reports/soak-rss.csv
//
// Exit 0: within the limit. Exit 1: memory still climbing. Exit 2: too few samples to judge.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const WARMUP_S = 300;
// Highest second-half slope in 14 nightly 30-minute soaks (2026-10-24 to 11-05) was 0.287 MB/min.
export const MAX_SLOPE_MB_PER_MIN = 0.5;
// Judging a trend needs a real window: at least 10 minutes and 10 samples after warm-up.
export const MIN_WINDOW_S = 600;
export const MIN_SAMPLES = 10;

export function parseRssCsv(text) {
  return text
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.split(',').map(Number))
    .filter(([s, mb]) => Number.isFinite(s) && Number.isFinite(mb));
}

/** Least-squares slope of y over x. */
function slope(points) {
  const n = points.length;
  const mx = points.reduce((a, [x]) => a + x, 0) / n;
  const my = points.reduce((a, [, y]) => a + y, 0) / n;
  const num = points.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0);
  const den = points.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  return num / den;
}

export function checkSoakRss(samples) {
  const post = samples.filter(([s]) => s >= WARMUP_S);
  const windowS = post.length ? post.at(-1)[0] - post[0][0] : 0;
  if (post.length < MIN_SAMPLES || windowS < MIN_WINDOW_S) {
    return {
      status: 'error',
      message: `${post.length} samples over ${windowS}s after warm-up; need ${MIN_SAMPLES} over ${MIN_WINDOW_S}s`,
    };
  }
  const mid = (post[0][0] + post.at(-1)[0]) / 2;
  const secondHalf = post.filter(([s]) => s >= mid);
  const slopeMbPerMin = slope(secondHalf) * 60;
  return {
    status: slopeMbPerMin <= MAX_SLOPE_MB_PER_MIN ? 'pass' : 'fail',
    slopeMbPerMin,
    afterWarmupMb: post[0][1],
    endMb: post.at(-1)[1],
    windowS,
  };
}

function main(file) {
  const result = checkSoakRss(parseRssCsv(readFileSync(file, 'utf8')));
  if (result.status === 'error') {
    console.log(`**Soak memory gate: ERROR** ${result.message} in \`${file}\``);
    process.exit(2);
  }
  console.log(
    `**Soak memory gate: ${result.status.toUpperCase()}** RSS ${result.afterWarmupMb} MB after warm-up,` +
      ` ${result.endMb} MB at the end; second-half slope ${result.slopeMbPerMin.toFixed(3)} MB/min` +
      ` (limit ${MAX_SLOPE_MB_PER_MIN})`,
  );
  process.exit(result.status === 'pass' ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2] ?? 'reports/soak-rss.csv');
}
