import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRules, normalize } from '../src/rules/engine.js';
import { ctx } from './helpers.js';

const c = ctx(true);
const id = (t, cx = c) => matchRules(t, cx)?.ruleId ?? null;

test('normalize strips case, emoji, accents and trailing punctuation', () => {
  assert.equal(normalize('  HELLO!!! 👋 '), 'hello');
  assert.equal(normalize('Kumustá po?'), 'kumusta po');
});

test('greetings only match when the whole message is a greeting (CB-01)', () => {
  for (const t of ['hi', 'Hello!', 'good morning', 'Kumusta po', 'hey there']) assert.equal(id(t), 'greeting', t);
  assert.match(matchRules('hi', c).text, /virtual assistant/);
  assert.equal(id('hi, can I get 30% off?'), 'discount');
});

test('identity: never claims to be human (CB-01)', () => {
  for (const t of ['are you a bot?', 'Are you a real person?', 'tao ka ba?', 'who are you']) {
    const r = matchRules(t, c);
    assert.equal(r.ruleId, 'identity', t);
    assert.match(r.text, /not a human/);
  }
  assert.equal(id('Can I talk to a real person?'), 'human_handoff'); // asking FOR a human ≠ asking what the bot is
});

test('pricing gives starting rate + quotation note + consultation offer (CB-04, CB-07)', () => {
  const r = matchRules('How much is SEO?', c);
  assert.equal(r.ruleId, 'pricing');
  assert.match(r.text, /SEO starts at ₱12,000\/month/);
  assert.match(r.text, /written quotation/);
  assert.match(r.text, /free 30-minute online consultation/);
  assert.equal(r.offerLead, true);
  assert.equal(r.service, 'SEO');
  assert.doesNotMatch(r.text, /Website design/); // only the asked service
});

test('pricing without a named service lists all six; Taglish works', () => {
  const all = matchRules('price', c);
  assert.equal(all.ruleId, 'pricing');
  assert.equal((all.text.match(/starts at/g) || []).length, 6);
  const tl = matchRules('Magkano po yung website design niyo?', c);
  assert.match(tl.text, /Website design starts at ₱35,000 one-time/);
});

test('discounts are never promised and are escalated (CB-05)', () => {
  for (const t of ['Can I get 30% off?', 'any discount?', 'pwede tawad?', 'can we negotiate the price']) {
    const r = matchRules(t, c);
    assert.equal(r.ruleId, 'discount', t);
    assert.equal(r.action, 'handoff');
    assert.match(r.text, /can't offer or promise discounts/);
  }
});

test('results are never guaranteed (CB-06)', () => {
  const r = matchRules('Can you guarantee 10k followers?', c);
  assert.equal(r.ruleId, 'results_guarantee');
  assert.match(r.text, /doesn't guarantee/);
  assert.equal(id('will we get first page on google'), 'results_guarantee');
});

test('policies are answered with exact wording (CB-15)', () => {
  assert.equal(matchRules('Is the deposit refundable?', c).text, c.br.policies.payment);
  assert.equal(matchRules('How many revisions do I get?', c).text, c.br.policies.revision);
  assert.equal(matchRules('How do I cancel my retainer?', c).text, c.br.policies.cancellation);
  assert.equal(matchRules('who owns the final files?', c).text, c.br.policies.ownership);
});

test('refund dispute escalates; "refundable" does not (CB-16)', () => {
  assert.equal(id('I want a refund'), 'dispute');
  assert.equal(matchRules('I want a refund', c).action, 'handoff');
  assert.equal(id('Is the deposit refundable?'), 'policy_payment');
});

test('complaints escalate with the BR-22 reply (CB-16)', () => {
  const r = matchRules("Your team missed my deadline, I'm upset.", c);
  assert.equal(r.ruleId, 'complaint');
  assert.equal(r.action, 'handoff');
  assert.match(r.text, /account manager/);
});

test('custom quote escalates (CB-16)', () => {
  const r = matchRules('can you send me a quotation for a full rebrand', c);
  assert.equal(r.ruleId, 'custom_quote');
  assert.equal(r.action, 'handoff');
});

test('services: lists only BR-03 services; unlisted service says so and offers to check (CB-03)', () => {
  const r = matchRules('What services do you offer?', c);
  assert.equal(r.ruleId, 'services_list');
  for (const s of c.br.services) assert.ok(r.text.includes(s), s);
  const app = matchRules('Do you do mobile app development?', c);
  assert.equal(app.ruleId, 'service_not_offered');
  assert.match(app.text, /isn't one of our listed services/);
  assert.equal(app.offerLead, true);
  assert.equal(id('can you build a website for my shop'), null); // listed service → RAG
  assert.equal(id('kumusta po, ano po services niyo?'), 'services_list');
});

test('buying intent starts lead capture (CB-07, CB-08)', () => {
  const r = matchRules('How do I get started?', c);
  assert.equal(r.ruleId, 'buying_intent');
  assert.equal(r.startLead, true);
  const hire = matchRules('I want to hire you for social media.', c);
  assert.equal(hire.startLead, true);
  assert.equal(hire.service, 'Social media management');
});

test('hours come from BR (CB-10/11)', () => {
  assert.match(matchRules('what are your business hours', c).text, /Monday to Friday/);
});

test('contact without configured details offers to take details instead', () => {
  const r = matchRules('How can I contact you?', c);
  assert.equal(r.ruleId, 'contact');
  assert.equal(r.offerLead, true);
  const withEmail = matchRules('How can I contact you?', { ...c, business: { contactEmail: 'hi@kualta.test', contactPhone: '' } });
  assert.match(withEmail.text, /hi@kualta\.test/);
});

test('off-topic is declined politely without escalation (CB-12, CB-18)', () => {
  for (const t of ["What's the weather in Clark?", 'Write me a poem about the ocean', 'What is 245 * 18?', 'Who won the NBA finals this year?']) {
    const r = matchRules(t, c);
    assert.ok(r, t);
    assert.equal(r.intent, 'off_topic', t);
    assert.equal(r.action, 'reply');
    assert.ok(!r.text.includes('4410'));
  }
});

test('phone numbers and service questions are not mistaken for maths', () => {
  assert.equal(id('0917-123-4567'), null);
  assert.equal(id('is support 24/7'), null);
});

test('empty and symbol-only messages', () => {
  assert.equal(id('???'), 'empty_or_symbols');
  assert.equal(id('👍'), 'empty_or_symbols');
});

test('unset BR values hand off instead of answering', () => {
  const empty = { ...c, br: { ...c.br, priceList: [], discountReply: null, policies: { payment: null } } };
  assert.equal(matchRules('How much is SEO?', empty).action, 'handoff');
  assert.equal(matchRules('Is the deposit refundable?', empty).action, 'handoff');
});

test('real questions fall through to RAG', () => {
  for (const t of ['Tell me about Kualta Agency', 'wat servises do u ofer', 'What services do you offer and how do I contact you?', 'what does the SEO package include']) {
    assert.equal(id(t), null, t);
  }
});
