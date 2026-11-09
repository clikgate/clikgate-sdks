import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidRequestError, type Logger } from '../../src/index.js';
import { capture, client } from './helpers.js';

// "Allow unknown goal names" off: the API refuses a name that isn't set up (422 unknown_goal) and an archived goal
// (422 goal_archived). Final: never retried. With debug logging on, one line naming the goal only.

const LINE = "Goal `level_complete` isn't set up in Clikgate";
const ENVELOPE = { error: { type: 'invalid_request', code: 'unknown_goal', message: "This goal isn't set up in Clikgate.", param: 'goal' }, status: 'refused', reason: 'unknown_goal', counted: false, goal_kind: null };
const REFUSAL = { status: 'refused', reason: 'unknown_goal', counted: false, goal_kind: null };

function recording(withDebug = true) {
  const lines: string[] = [];
  const logger: Logger = { warn: (m) => lines.push(`warn ${m}`), error: (m) => lines.push(`error ${m}`) };
  if (withDebug) logger.debug = (m) => lines.push(`debug ${m}`);
  return { lines, logger };
}

const isRefusal = (code: string) => (e: unknown) => e instanceof InvalidRequestError && e.code === code && e.httpStatus === 422;

test('goals.send: 422 unknown_goal is final and logs the goal name at debug level only', async () => {
  const { lines, logger } = recording();
  const { calls, fetchLike } = capture([{ status: 422, json: ENVELOPE }]);
  const c = client(fetchLike, { logger, maxRetries: 3 });
  await assert.rejects(c.goals.send('level_complete', { reference: 'APP-77120', value: '2500', label: 'Ada' }), isRefusal('unknown_goal'));
  assert.equal(calls.length, 1);
  assert.deepEqual(lines, [`debug ${LINE}`]);
});

test('goals.send: the refusal body without an error envelope maps to its reason', async () => {
  const { lines, logger } = recording();
  const { calls, fetchLike } = capture([{ status: 422, json: REFUSAL }, { status: 422, json: { status: 'refused', reason: 'goal_archived' } }]);
  const c = client(fetchLike, { logger, maxRetries: 3 });
  await assert.rejects(c.goals.send('level_complete', { reference: 'APP-1' }), (e: unknown) => isRefusal('unknown_goal')(e) && (e as InvalidRequestError).raw !== null);
  await assert.rejects(c.goals.send('old_signup', { reference: 'APP-2' }), isRefusal('goal_archived'));
  assert.equal(calls.length, 2);
  assert.deepEqual(lines, [`debug ${LINE}`]);
});

test('no line without debug logging', async () => {
  const { lines, logger } = recording(false);
  const { fetchLike } = capture([{ status: 422, json: ENVELOPE }]);
  const c = client(fetchLike, { logger });
  await assert.rejects(c.goals.send('level_complete', { reference: 'APP-1' }), isRefusal('unknown_goal'));
  assert.deepEqual(lines, []);
});

test('the name is never checked or remembered: the next call is sent again', async () => {
  const { fetchLike, calls } = capture([{ status: 422, json: ENVELOPE }, { status: 201, json: { object: 'goal_event', status: 'counted' } }]);
  const c = client(fetchLike);
  await assert.rejects(c.goals.send('level_complete', { reference: 'APP-1' }), isRefusal('unknown_goal'));
  const r = await c.goals.send('level_complete', { reference: 'APP-2' });
  assert.equal(r.status, 'counted');
  assert.equal(calls.length, 2);
});

test('sendBatch and background goal(): unknown_goal items log the name only and are never re-sent', async () => {
  const item = { index: 1, ok: false, status: 422, goal_event: null, error: { type: 'invalid_request', code: 'unknown_goal', message: 'x', param: 'goal' } };
  const ok0 = { index: 0, ok: true, status: 201, goal_event: { object: 'goal_event', status: 'counted', reason: null }, error: null };
  const { lines, logger } = recording();
  const errors: Array<{ code: string; dropped: boolean }> = [];
  const { calls, fetchLike } = capture([{ status: 200, json: { object: 'list', data: [ok0, item] } }, { status: 200, json: { object: 'list', data: [ok0, item] } }]);
  const sync = client(fetchLike, { logger });
  const r = await sync.goals.sendBatch([{ goal: 'order_paid', reference: 'R-0' }, { goal: 'level_complete', reference: 'APP-77120', value: '2500' }]);
  assert.equal(r.data[1]?.ok, false);
  const bg = client(fetchLike, { logger, sendMode: 'background', onError: (e, ctx) => errors.push({ code: e.code, dropped: ctx.dropped }) });
  bg.goal('order_paid', { reference: 'R-0' });
  bg.goal('level_complete', { reference: 'APP-77120', value: '2500' });
  assert.equal(await bg.flush(1000), true);
  assert.equal(await bg.flush(1000), true);
  assert.equal(calls.length, 2);
  assert.deepEqual(errors, [{ code: 'unknown_goal', dropped: true }]);
  const debug = lines.filter((l) => l.startsWith('debug '));
  assert.deepEqual(debug, [`debug ${LINE}`, `debug ${LINE}`]);
  assert.ok(debug.every((l) => !l.includes('APP-77120') && !l.includes('2500')));
  await bg.close(100);
});
