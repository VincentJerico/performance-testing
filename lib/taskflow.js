// A thin client for the TaskFlow API.
// Every request carries a `name` tag, so thresholds and reports can be read per endpoint
// (e.g. "GET /api/tasks") instead of per URL, which would split on every task id.

import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, JSON_HEADERS, PASSWORD } from './config.js';

function auth(token) {
  return { ...JSON_HEADERS, Authorization: `Bearer ${token}` };
}

export function health() {
  const res = http.get(`${BASE_URL}/health`, { tags: { name: 'GET /health' } });
  check(res, { 'health is 200': (r) => r.status === 200 });
  return res;
}

export function register(username, password = PASSWORD) {
  const res = http.post(`${BASE_URL}/api/auth/register`, JSON.stringify({ username, password }), {
    headers: JSON_HEADERS,
    tags: { name: 'POST /api/auth/register' },
  });
  check(res, { 'register is 201': (r) => r.status === 201 });
  return res;
}

export function login(username, password = PASSWORD) {
  const res = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({ username, password }), {
    headers: JSON_HEADERS,
    tags: { name: 'POST /api/auth/login' },
  });
  const ok = check(res, {
    'login is 200': (r) => r.status === 200,
    'login returns a token': (r) => typeof r.json('token') === 'string',
  });
  return ok ? res.json('token') : null;
}

export function listTasks(token, tags = {}) {
  const res = http.get(`${BASE_URL}/api/tasks`, {
    headers: auth(token),
    tags: { name: 'GET /api/tasks', ...tags },
  });
  check(res, {
    'list is 200': (r) => r.status === 200,
    'list is an array': (r) => Array.isArray(r.json()),
  });
  return res;
}

export function createTask(token, task) {
  const res = http.post(`${BASE_URL}/api/tasks`, JSON.stringify(task), {
    headers: auth(token),
    tags: { name: 'POST /api/tasks' },
  });
  const ok = check(res, {
    'create is 201': (r) => r.status === 201,
    'create echoes the title': (r) => r.json('title') === task.title,
  });
  return ok ? res.json() : null;
}

export function getTask(token, id) {
  const res = http.get(`${BASE_URL}/api/tasks/${id}`, {
    headers: auth(token),
    tags: { name: 'GET /api/tasks/:id' },
  });
  check(res, {
    'get is 200': (r) => r.status === 200,
    'get returns the same task': (r) => r.json('id') === id,
  });
  return res;
}

export function updateTask(token, id, task) {
  const res = http.put(`${BASE_URL}/api/tasks/${id}`, JSON.stringify(task), {
    headers: auth(token),
    tags: { name: 'PUT /api/tasks/:id' },
  });
  check(res, {
    'update is 200': (r) => r.status === 200,
    'update saved the status': (r) => r.json('status') === task.status,
  });
  return res;
}

export function deleteTask(token, id) {
  const res = http.del(`${BASE_URL}/api/tasks/${id}`, null, {
    headers: auth(token),
    tags: { name: 'DELETE /api/tasks/:id' },
  });
  check(res, { 'delete is 204': (r) => r.status === 204 });
  return res;
}
