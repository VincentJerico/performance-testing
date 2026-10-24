// Stress test: climb well past normal load in steps, to see how and where the system degrades.
// The goal is to observe, so budgets are relaxed (3x); errors must still stay under 1%.
//   k6 run scenarios/stress.js

import { createUserPool, taskJourney } from '../lib/journey.js';
import { thresholds } from '../lib/slo.js';

const PEAK = 150;

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '30s', target: 100 },
        { duration: '30s', target: PEAK },
        { duration: '30s', target: PEAK }, // hold at the peak
        { duration: '15s', target: 0 }, // recovery
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: thresholds({ p95Scale: 3 }),
};

export function setup() {
  return createUserPool(PEAK);
}

export default function (data) {
  taskJourney(data);
}
