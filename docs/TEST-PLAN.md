# Performance test plan

## Scope

The TaskFlow REST API ([taskflow-under-test](https://github.com/VincentJerico/taskflow-under-test)):
auth (`/api/auth/*`) and task CRUD (`/api/tasks`). The static UI page is out of scope.

## Objectives

1. Gate every change: the expected busy-hour load must stay inside the SLOs, or CI fails.
2. Find where and how the API degrades past that (stress, spike, breakpoint).
3. Find what only shows up over time (soak).
4. When something degrades, find out why and prove it with a targeted experiment.

## Service-level objectives

Defined once in [lib/slo.js](../lib/slo.js) and enforced as k6 thresholds.

| Measure                          | Objective |
| -------------------------------- | --------- |
| `GET /api/tasks` p95             | < 200 ms  |
| `GET /api/tasks/:id` p95         | < 150 ms  |
| `POST`, `PUT`, `DELETE` p95      | < 250 ms  |
| Failed requests                  | < 1%      |
| Checks (status and body correct) | > 99%     |

## Workload model

One **journey** is what a user does with a task: open the board, add a task, open it, mark it
done, check the board again, delete it. That's 6 requests with 1 second of think time between
steps. Users sign in once, during `setup()`, the way real users keep a session; login load is
tested on its own in `experiments/auth-contention.js`. Each journey deletes its own task, so
list sizes stay constant and a latency change comes from load, not data growth. List growth is
tested on its own in `experiments/list-growth.js`.

## Test types

| Test       | Question it answers                          | Shape                                   | Runs       |
| ---------- | -------------------------------------------- | --------------------------------------- | ---------- |
| Smoke      | Does it work, and what's the baseline?       | 1 user, 5 journeys                      | every push |
| Load       | Does the expected load meet the SLOs?        | 20 users for 60 s (plus ramps)          | every push |
| Stress     | How does it degrade past normal load?        | 50, 100, 150 users in steps             | nightly    |
| Spike      | Does it survive a sudden burst, and recover? | 5 to 200 users in 5 s, then back        | nightly    |
| Soak       | Does anything get worse over time?           | 15 users for 30 min, memory sampled     | nightly    |
| Breakpoint | What's the maximum throughput?               | arrival rate ramps until the SLO breaks | nightly    |

## Environment

TaskFlow runs from a pinned commit on a fresh SQLite database for every run. In CI, k6 and
TaskFlow share one GitHub-hosted runner. That's fine for relative comparisons and SLO gating,
but absolute capacity numbers from a shared machine are a lower bound for the server and an
upper bound for the generator.

## Entry and exit criteria

- **Entry:** smoke passes. A load result means nothing if the smoke test fails.
- **Exit (gate):** smoke and load meet every SLO, and the gate self-test proves the gate can fail.

## Reporting

- Each run exports k6's HTML dashboard and a JSON summary to `reports/` (uploaded as CI artifacts).
- CI writes a per-threshold pass/fail table to the job summary.
- Findings go in [FINDINGS.md](FINDINGS.md) with severity, evidence, root cause and a
  reproduction command. Raw numbers go in [results/](results/).
