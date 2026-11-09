import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchQuery } from '../src/rag/pipeline.js';
import { matchRules } from '../src/rules/engine.js';
import { ctx } from './helpers.js';

const c = ctx(true);
const id = (t) => matchRules(t, c)?.ruleId ?? null;

test('general-knowledge questions get the off-topic redirect, not a handoff (Messenger test 2026-11-09)', () => {
  for (const t of ['What is the president of the Philippines', 'who is the prime minister of Japan', 'capital of France?']) {
    assert.equal(id(t), 'out_of_scope_general', t);
  }
  // About the agency itself: not off-topic.
  assert.equal(id('who is the president of Kualta?'), null);
});

test('"your company" in a question searches for Kualta Agency, typos included', () => {
  assert.equal(searchQuery('what is you comapany about?'), 'what is Kualta Agency about?');
  assert.equal(searchQuery('Tell me about your company'), 'Tell me about Kualta Agency');
  assert.equal(searchQuery('what do you guys do'), 'what do Kualta Agency do');
  assert.equal(searchQuery('Tell me about the agency'), 'Tell me about Kualta Agency');
  assert.equal(searchQuery('how much is SEO?'), 'how much is SEO?');
});
