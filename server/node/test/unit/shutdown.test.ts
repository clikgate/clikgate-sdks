import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Clikgate } from '../../src/index.js';

test('shutdown hooks: one listener set for many clients, removed on close', async () => {
  const before = process.listenerCount('SIGTERM');
  const opts = { apiKey: 'cg_test_x1', logger: { warn: () => undefined, error: () => undefined } };
  const a = new Clikgate(opts);
  const b = new Clikgate(opts);
  assert.equal(process.listenerCount('SIGTERM'), before + 1);
  assert.equal(process.listenerCount('beforeExit') >= 1, true);
  await a.close();
  assert.equal(process.listenerCount('SIGTERM'), before + 1);
  await b.close();
  assert.equal(process.listenerCount('SIGTERM'), before);
});
