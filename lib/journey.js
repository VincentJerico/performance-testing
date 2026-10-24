// The user journeys every scenario is built from, plus the shared setup().

import { sleep, fail } from 'k6';
import { RUN_ID, THINK_TIME } from './config.js';
import {
  health,
  register,
  login,
  listTasks,
  createTask,
  getTask,
  updateTask,
  deleteTask,
} from './taskflow.js';

/**
 * setup() runs once before the load starts. It creates a pool of signed-in users, so the
 * journey measures task traffic. Real users sign in once per session, not once per click;
 * login traffic gets its own scenario where it matters (see experiments/auth-contention.js).
 */
export function createUserPool(size) {
  const res = health();
  if (res.status !== 200) fail(`TaskFlow is not healthy at setup (status ${res.status})`);

  const usernames = [];
  const tokens = [];
  for (let i = 0; i < size; i++) {
    const username = `k6-${RUN_ID}-${i}`;
    register(username);
    const token = login(username);
    if (!token) fail(`setup: could not sign in ${username}`);
    usernames.push(username);
    tokens.push(token);
  }
  return { usernames, tokens };
}

/** Pick a token for this virtual user. VUs are 1-based; the pool is shared round-robin. */
export function tokenFor(data) {
  return data.tokens[(__VU - 1) % data.tokens.length];
}

/**
 * The core journey: a user opens their board, adds a task, opens it, finishes it, checks the
 * board again, and tidies up. Deleting at the end keeps every user's list the same size for
 * the whole run, so latency changes come from load, not from a growing list.
 */
export function taskJourney(data, think = THINK_TIME) {
  const token = tokenFor(data);
  const pause = () => think > 0 && sleep(think);

  listTasks(token);
  pause();

  const task = createTask(token, {
    title: `k6 task vu${__VU} it${__ITER}`,
    status: 'todo',
    due_date: '2026-12-31',
  });
  if (!task) return; // the failed check is already recorded; don't cascade 404s
  pause();

  getTask(token, task.id);
  updateTask(token, task.id, { title: task.title, status: 'done', due_date: task.due_date });
  pause();

  listTasks(token);
  deleteTask(token, task.id);
  pause();
}
