import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

async function withServer(handle, fn) {
  const server = createApp({ handle }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}
const vid = '123e4567-e89b-42d3-a456-426614174000';
const post = (base, body) => fetch(`${base}/api/web-chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('web chat page is served at /', async () => {
  await withServer(async () => ({}), async (base) => {
    const res = await fetch(base + '/');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Kualta Agency/);
  });
});

test('web chat answers with a hashed web user key, no API key needed', async () => {
  let seen;
  await withServer(async (msg, opts) => { seen = opts; return { text: 'hello back', handoff: false }; }, async (base) => {
    const res = await post(base, { message: 'hi', visitorId: vid });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).text, 'hello back');
  });
  assert.equal(seen.channel, 'web');
  assert.match(seen.userKey, /^web:[0-9a-f]{32}$/);
  assert.ok(!seen.userKey.includes(vid));
});

test('web chat rejects bad input', async () => {
  await withServer(async () => ({ text: 'x' }), async (base) => {
    assert.equal((await post(base, { message: '', visitorId: vid })).status, 400);
    assert.equal((await post(base, { message: 'hi', visitorId: 'nope' })).status, 400);
    assert.equal((await post(base, { message: 'a'.repeat(1001), visitorId: vid })).status, 400);
  });
});

test('web chat rate-limits one visitor (15 per minute)', async () => {
  await withServer(async () => ({ text: 'ok' }), async (base) => {
    let last;
    for (let i = 0; i < 16; i++) last = await post(base, { message: 'hi', visitorId: vid });
    assert.equal(last.status, 429);
  });
});
