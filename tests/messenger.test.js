import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { messengerRouter, extractEvents, isValidSignature, splitMessage } from '../src/channels/messenger.js';

const fb = { verifyToken: 'verify-me', appSecret: 'shh', apiVersion: 'v24.0', pageAccessToken: 't', appId: '111' };
const quiet = { info() {}, warn() {}, error() {} };
const keyFor = (ch, id) => `${ch}:${id}`;

const textEvent = (mid = 'm.1', text = 'hi', psid = '9001') => ({
  object: 'page',
  entry: [{ messaging: [{ sender: { id: psid }, recipient: { id: 'PAGE' }, message: { mid, text } }] }],
});
const echoEvent = (mid, appId, psid = '9001') => ({
  object: 'page',
  entry: [{ messaging: [{ sender: { id: 'PAGE' }, recipient: { id: psid }, message: { mid, is_echo: true, app_id: appId, text: 'hello from the team' } }] }],
});
const sign = (raw) => 'sha256=' + crypto.createHmac('sha256', fb.appSecret).update(raw).digest('hex');

async function withServer(opts, fn) {
  const app = express();
  app.use(express.json({ verify: (req, _r, buf) => { req.rawBody = buf; } }));
  app.use('/webhook/messenger', messengerRouter({ fb, logger: quiet, keyFor, ...opts }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/webhook/messenger`;
  try { await fn(base); } finally { server.close(); }
}
const post = (base, payload) => {
  const body = JSON.stringify(payload);
  return fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sign(body) }, body });
};
const tick = () => new Promise((r) => setTimeout(r, 30));

test('GET verification returns the raw challenge only with the right token', async () => {
  await withServer({}, async (base) => {
    const ok = await fetch(`${base}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '12345');
    assert.equal((await fetch(`${base}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`)).status, 403);
  });
});

test('POST rejects wrongly signed requests', async () => {
  await withServer({ handle: async () => ({}), send: async () => {} }, async (base) => {
    const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=bad' }, body: JSON.stringify(textEvent()) });
    assert.equal(r.status, 401);
  });
});

test('text message is answered once even if Meta retries, keyed by hashed PSID', async () => {
  const sent = [];
  const calls = [];
  const handle = async (text, o) => { calls.push(o); return { text: `echo:${text}`, route: 'rule', handoff: false }; };
  await withServer({ handle, send: async (to, body) => sent.push({ to, body }) }, async (base) => {
    assert.equal((await post(base, textEvent('m.X', 'hello'))).status, 200);
    assert.equal((await post(base, textEvent('m.X', 'hello'))).status, 200); // retry
    await tick();
  });
  assert.deepEqual(sent, [{ to: '9001', body: 'echo:hello' }]);
  assert.equal(calls[0].userKey, 'fb:9001');
  assert.equal(calls[0].channel, 'messenger');
});

test('a human reply from the Page inbox pauses the bot for that customer', async () => {
  const paused = [];
  await withServer({ handle: async () => ({}), send: async () => {}, pause: async (k) => paused.push(k) }, async (base) => {
    await post(base, echoEvent('m.human', '263902037430900')); // inbox app, not ours
    await post(base, echoEvent('m.bot', '111')); // our own reply echoed back
    await tick();
  });
  assert.deepEqual(paused, ['fb:9001']);
});

test('attachments get a text-only reply without calling the bot', async () => {
  const sent = [];
  let handled = false;
  const payload = { object: 'page', entry: [{ messaging: [{ sender: { id: '9001' }, message: { mid: 'm.img', attachments: [{ type: 'image' }] } }] }] };
  await withServer({ handle: async () => { handled = true; }, send: async (t, b) => sent.push(b) }, async (base) => {
    await post(base, payload);
    await tick();
  });
  assert.equal(handled, false);
  assert.match(sent[0], /only read text/);
});

test('a null reply (bot quiet) sends nothing', async () => {
  const sent = [];
  await withServer({ handle: async () => ({ text: null, route: 'rule', handoff: false }), send: async (t, b) => sent.push(b) }, async (base) => {
    await post(base, textEvent('m.quiet'));
    await tick();
  });
  assert.equal(sent.length, 0);
});

test('extractEvents: postbacks become text; receipts and other objects ignored', () => {
  assert.deepEqual(extractEvents({ object: 'instagram', entry: [] }), []);
  const pb = extractEvents({ object: 'page', entry: [{ messaging: [{ sender: { id: '1' }, postback: { mid: 'p1', payload: 'GET_STARTED', title: 'Get Started' } }] }] });
  assert.deepEqual(pb, [{ kind: 'text', id: 'p1', customerId: '1', text: 'GET_STARTED' }]);
  assert.deepEqual(extractEvents({ object: 'page', entry: [{ messaging: [{ sender: { id: '1' }, delivery: {} }] }] }), []);
});

test('long replies are split under the 2,000-character limit', () => {
  const parts = splitMessage('word '.repeat(900), 2000);
  assert.ok(parts.length >= 2);
  for (const p of parts) assert.ok(p.length <= 2000);
});

test('isValidSignature handles missing pieces safely', () => {
  assert.equal(isValidSignature(null, 'x', 's'), false);
  assert.equal(isValidSignature(Buffer.from('a'), undefined, 's'), false);
  assert.equal(isValidSignature(Buffer.from('a'), 'sha256=00', ''), false);
});
