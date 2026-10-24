// Load test: the expected busy-hour traffic, held long enough to settle.
// Passes only if every endpoint stays inside its p95 budget (lib/slo.js).
//   k6 run scenarios/load.js

import { createUserPool, taskJourney } from '../lib/journey.js';
import { thresholds } from '../lib/slo.js';

const USERS = 20;

export const options = {
  scenarios: {
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: USERS }, // ramp up
        { duration: '60s', target: USERS }, // steady state
        { duration: '10s', target: 0 }, // ramp down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: thresholds(),
};

export function setup() {
  return createUserPool(USERS);
}

export default function (data) {
  taskJourney(data);
}
