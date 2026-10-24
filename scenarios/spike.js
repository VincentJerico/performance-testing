// Spike test: a sudden burst (think: a link shared in a big group chat), then back to normal.
// Two questions: does it survive the burst, and does it recover afterwards?
//   k6 run scenarios/spike.js

import { createUserPool, taskJourney } from '../lib/journey.js';
import { thresholds } from '../lib/slo.js';

const BASELINE = 5;
const SPIKE = 200;

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: BASELINE,
      stages: [
        { duration: '20s', target: BASELINE }, // normal traffic
        { duration: '5s', target: SPIKE }, // the spike arrives
        { duration: '20s', target: SPIKE }, // and stays
        { duration: '5s', target: BASELINE }, // it passes
        { duration: '20s', target: BASELINE }, // recovery: back inside budget?
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: thresholds({ p95Scale: 3 }),
};

export function setup() {
  return createUserPool(SPIKE);
}

export default function (data) {
  taskJourney(data);
}
