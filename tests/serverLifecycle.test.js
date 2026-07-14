// Load a valid test env before importing the app (which loads config/env.js).
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createApp } from '../src/app.js';
import { gracefulClose } from '../src/shutdown.js';

/** Promisified server.listen(0) → resolves with the chosen port. */
function listenEphemeral(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('server lifecycle: starts, serves a request, and closes cleanly', async () => {
  const app = createApp();
  const server = http.createServer(app);

  const port = await listenEphemeral(server);
  assert.ok(port > 0);
  assert.equal(server.listening, true);

  // Make at least one real request (CSRF route does not touch the database).
  const csrf = await fetch(`http://127.0.0.1:${port}/api/csrf-token`);
  assert.equal(csrf.status, 200);
  const csrfBody = await csrf.json();
  assert.equal(csrfBody.success, true);

  // And one request that exercises the DB health path (pool gets created).
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.ok(health.status === 200 || health.status === 503);
  await health.json();

  // Graceful, awaited close — no process.exit, no forced termination.
  await gracefulClose({ server, app });

  // The server must no longer be listening.
  assert.equal(server.listening, false);
});

test('server lifecycle: closing twice is safe (idempotent)', async () => {
  const app = createApp();
  const server = http.createServer(app);
  await listenEphemeral(server);

  await gracefulClose({ server, app });
  // Second close must not throw (server already closed, pool already closed).
  await gracefulClose({ server, app });
  assert.equal(server.listening, false);
});

test('server lifecycle: leaves no open TCP server handle', async () => {
  const app = createApp();
  const server = http.createServer(app);
  await listenEphemeral(server);
  await fetch(`http://127.0.0.1:${server.address().port}/api/csrf-token`).then((r) => r.json());
  await gracefulClose({ server, app });

  // After a clean close there should be no lingering TCP *server* handle.
  const active = process.getActiveResourcesInfo();
  assert.ok(
    !active.includes('TCPSERVERWRAP'),
    `expected no TCPSERVERWRAP handle, got: ${active.join(', ')}`,
  );
});
