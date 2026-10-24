// Smoke test: one user, a few journeys. Does the system work, and what's the baseline latency?
// Run before every heavier test; if smoke fails, a load result means nothing.
//   k6 run scenarios/smoke.js

import { createUserPool, taskJourney } from '../lib/journey.js';
import { thresholds } from '../lib/slo.js';

export const options = {
  scenarios: {
    smoke: { executor: 'per-vu-iterations', vus: 1, iterations: 5, maxDuration: '1m' },
  },
  thresholds: thresholds(),
};

export function setup() {
  return createUserPool(1);
}

export default function (data) {
  taskJourney(data);
}
