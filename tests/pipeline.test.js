import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerWithRag, buildContext, buildSystemPrompt, NO_ANSWER } from '../src/rag/pipeline.js';
import { conversation, br } from './helpers.js';

const business = { contactEmail: 'hello@example.com', contactPhone: '', hours: '' };
const quiet = { error() {} };
const embed = async () => [[0.1, 0.2]];
const chunk = (similarity, content = 'We build WordPress sites.') => ({ id: '1', source: 'services.md', title: 'Services', content, similarity });

test('below threshold: no LLM call, fallback + handoff', async () => {
  let called = false;
  const r = await answerWithRag('who won the nba', {
    embed, search: async () => [chunk(0.12)], generate: async () => { called = true; },
    threshold: 0.35, business, logger: quiet,
  });
  assert.equal(called, false);
  assert.equal(r.route, 'fallback');
  assert.equal(r.reason, 'below_threshold');
  assert.equal(r.handoff, true);
  assert.match(r.text, /hello@example\.com/);
});

test('above threshold: only relevant chunks go to the model, answer returned', async () => {
  let prompt;
  const r = await answerWithRag('what do you do', {
    embed,
    search: async () => [chunk(0.8, 'GOOD CHUNK'), chunk(0.1, 'BAD CHUNK')],
    generate: async (p) => { prompt = p; return { text: 'We build WordPress sites.', usage: {} }; },
    threshold: 0.35, business, logger: quiet,
  });
  assert.equal(r.route, 'rag');
  assert.deepEqual(r.sources, ['services.md']);
  assert.match(prompt.user, /GOOD CHUNK/);
  assert.doesNotMatch(prompt.user, /BAD CHUNK/);
  assert.match(prompt.system, /ONLY using the CONTEXT/);
});

test('model says NO_ANSWER: fallback + handoff', async () => {
  const r = await answerWithRag('pricing?', {
    embed, search: async () => [chunk(0.6)], generate: async () => ({ text: NO_ANSWER }), threshold: 0.35, business, logger: quiet,
  });
  assert.equal(r.route, 'fallback');
  assert.equal(r.reason, 'model_no_answer');
});

test('API errors never reach the customer', async () => {
  const r = await answerWithRag('hello?', {
    embed: async () => { throw new Error('boom'); }, threshold: 0.35, business, logger: quiet,
  });
  assert.equal(r.route, 'fallback');
  assert.equal(r.reason, 'error');
  assert.doesNotMatch(r.text, /boom/);
});

test('buildContext respects the character budget', () => {
  const big = Array.from({ length: 10 }, (_, i) => chunk(0.9, `chunk ${i} `.repeat(100)));
  const ctx = buildContext(big, 3500);
  assert.ok(ctx.length <= 3500);
  assert.match(ctx, /^\[1\]/);
});

test('handleMessage: rules short-circuit before any RAG cost', async () => {
  let ragCalled = false;
  const { say } = conversation({ rag: { embed: async () => { ragCalled = true; return [[0]]; } } });
  const r = await say('hi');
  assert.equal(r.route, 'rule');
  assert.equal(r.ruleId, 'greeting');
  assert.equal(ragCalled, false);
});

test('handleMessage: non-rule question goes to RAG', async () => {
  const { say } = conversation({ rag: { search: async () => [chunk(0.7)], generate: async () => ({ text: 'Web design.' }) } });
  const r = await say('Tell me about Kualta Agency');
  assert.equal(r.route, 'rag');
  assert.equal(r.text, 'Web design.');
});

test('system prompt carries the BR overrides (CB-13)', () => {
  const p = buildSystemPrompt(br);
  assert.match(p, /BUSINESS RULES OVERRIDE THE CONTEXT/);
  assert.match(p, /Social media management/);
  assert.match(p, /not a human/);
});

import { generate } from '../src/rag/llm.js';

const jsonRes = (status, body) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body) });

test('llm: drops thought parts and sends thinkingConfig', async () => {
  let sent;
  const fetchFn = async (_u, opts) => { sent = JSON.parse(opts.body); return jsonRes(200, { candidates: [{ content: { parts: [{ text: 'secret reasoning', thought: true }, { text: 'We build sites.' }] } }] }); };
  const r = await generate({ system: 's', user: 'u' }, { apiKey: 'k', model: 'm', maxOutputTokens: 1024, thinkingLevel: 'low', fetchFn });
  assert.equal(r.text, 'We build sites.');
  assert.deepEqual(sent.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
  assert.equal(sent.generationConfig.temperature, undefined);
});

test('llm: retries without thinkingConfig if the API rejects it', async () => {
  const bodies = [];
  const fetchFn = async (_u, opts) => {
    bodies.push(JSON.parse(opts.body));
    return bodies.length === 1 ? jsonRes(400, { error: { message: 'Unknown field thinkingConfig' } }) : jsonRes(200, { candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
  };
  const r = await generate({ system: 's', user: 'u' }, { apiKey: 'k', model: 'm', maxOutputTokens: 1024, thinkingLevel: 'low', fetchFn });
  assert.equal(r.text, 'ok');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].generationConfig.thinkingConfig, undefined);
});

import { embed as geminiEmbed, embedBatched, embeddingModelId } from '../src/rag/embeddings.js';

test('gemini embeddings: query vs document task types, 1536 dims, one call per text', async () => {
  const bodies = [];
  const fetchFn = async (url, opts) => {
    bodies.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ embedding: { values: new Array(1536).fill(0.01) } }) };
  };
  const cfg = { provider: 'gemini', geminiModel: 'gemini-embedding-001', geminiApiKey: 'k' };
  const [q] = await geminiEmbed('how much is seo', { cfg, fetchFn });
  assert.equal(q.length, 1536);
  assert.equal(bodies[0].body.taskType, 'RETRIEVAL_QUERY');
  assert.equal(bodies[0].body.outputDimensionality, 1536);
  assert.match(bodies[0].url, /gemini-embedding-001:embedContent$/);

  const docs = await embedBatched(['a', 'b', 'c'], 2, { cfg, fetchFn });
  assert.equal(docs.length, 3);
  assert.ok(bodies.slice(1).every((b) => b.body.taskType === 'RETRIEVAL_DOCUMENT'));
});

test('gemini embeddings reject a wrong vector size instead of storing it', async () => {
  const fetchFn = async () => ({ ok: true, json: async () => ({ embedding: { values: [1, 2, 3] } }) });
  await assert.rejects(geminiEmbed('x', { cfg: { provider: 'gemini', geminiModel: 'm', geminiApiKey: 'k' }, fetchFn }), /expected 1536/);
});

test('changing the embedding model changes the knowledge fingerprint', () => {
  assert.notEqual(
    embeddingModelId({ provider: 'gemini', geminiModel: 'gemini-embedding-001' }),
    embeddingModelId({ provider: 'openai', openaiModel: 'text-embedding-3-small' }),
  );
});
