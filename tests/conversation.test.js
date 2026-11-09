/**
 * End-to-end conversation tests: one per row of the Business Rules "Traceability and
 * test cases" table, plus the CB rules that need more than one message.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversation, OPEN, CLOSED } from './helpers.js';

async function completeLead(say, { service = true } = {}) {
  let r = await say('yes');
  assert.match(r.text, /name/i);
  r = await say('Juan Dela Cruz');
  assert.match(r.text, /email/i);
  r = await say('not-an-email');
  assert.match(r.text, /doesn't look right/);
  r = await say('juan@example.com');
  assert.match(r.text, /contact number/i);
  r = await say('12345');
  assert.match(r.text, /doesn't look right/);
  r = await say('0917 123 4567');
  assert.match(r.text, /business name/i);
  r = await say('Juan Bakery');
  if (service) {
    assert.match(r.text, /Which service/);
    r = await say('4');
  }
  return r;
}

test('BR-01/02, CB-08/11: hire at 10 PM → lead captured, human replies within 1 business day', async () => {
  const { say, store } = conversation({ now: CLOSED });
  let r = await say('I want to hire you for social media.');
  assert.match(r.text, /Kualta Agency collects your name/); // privacy notice before data (CB-09)
  r = await completeLead(say, { service: false }); // service already known from the first message
  assert.match(r.text, /within 1 business day/);
  assert.equal(store.leads.length, 1);
  const lead = store.leads[0];
  assert.equal(lead.service, 'Social media management');
  assert.equal(lead.phone, '+639171234567');
  assert.equal(lead.email, 'juan@example.com');
  assert.equal(lead.afterHours, true);
  assert.ok(lead.consentAt);
});

test('BR-03, CB-03: unlisted service → says so, offers to check, captures lead with "Other"', async () => {
  const { say, store } = conversation();
  let r = await say('Do you do mobile app development?');
  assert.match(r.text, /isn't one of our listed services/);
  r = await say('yes'); // accept offer → consent prompt
  assert.match(r.text, /Do you agree/);
  r = await completeLead(say, { service: false });
  assert.match(r.text, /Which service/);
  r = await say('7'); // "Something else"
  r = await say('mobile app development');
  assert.match(r.text, /team will check/);
  assert.equal(store.leads[0].service, 'Other: mobile app development');
});

test('BR-04, CB-07/10: "How do I get started?" offers free 30-min consultation', async () => {
  const { say } = conversation();
  const r = await say('How do I get started?');
  assert.match(r.text, /free 30-minute online consultation/);
  assert.match(r.text, /Do you agree/);
});

test('BR-05, CB-04: "How much is SEO?" → starting rate + written quotation', async () => {
  const { say } = conversation();
  const r = await say('How much is SEO?');
  assert.match(r.text, /SEO starts at ₱12,000\/month/);
  assert.match(r.text, /written quotation/);
  const yes = await say('yes'); // CB-07 consultation offer accepted → lead flow
  assert.match(yes.text, /Do you agree/);
});

test('BR-07, CB-05: "Can I get 30% off?" → no promise, escalated', async () => {
  const { say, store } = conversation();
  const r = await say('Can I get 30% off?');
  assert.match(r.text, /can't offer or promise discounts/);
  assert.equal(r.handoff, true);
  assert.equal(store.logs.at(-1).escalated, true);
});

test('BR-09/14/18, CB-15: policy answers are exact wording', async () => {
  const { say } = conversation();
  assert.match((await say('Is the deposit refundable?')).text, /50% non-refundable deposit/);
  assert.match((await say('How many revisions do I get?')).text, /2 revision rounds.*₱1,500/);
  assert.match((await say('How do I cancel my retainer?')).text, /30 days' written notice/);
});

test('BR-16, CB-06: "Can you guarantee 10k followers?" → declines, explains deliverables', async () => {
  const { say } = conversation();
  const r = await say('Can you guarantee 10k followers?');
  assert.match(r.text, /doesn't guarantee/);
  assert.match(r.text, /deliverables/);
});

test('BR-20, CB-09: user refuses consent → nothing stored, chat continues', async () => {
  const { say, store } = conversation();
  await say('How do I get started?');
  const r = await say('no');
  assert.match(r.text, /won't save any details/);
  assert.equal(store.leads.length, 0);
  const next = await say('How much is SEO?'); // chat continues normally
  assert.match(next.text, /SEO starts at/);
});

test('BR-21, CB-17: password is refused, not stored, flow not advanced', async () => {
  const { say, store } = conversation();
  const r = await say("Here's my Facebook password: hunter2");
  assert.match(r.text, /don't send passwords/);
  assert.equal(store.logs.at(-1).flagged, 'prohibited');
  assert.ok(!JSON.stringify(store.logs).includes('hunter2'));
  const card = await say('my card is 4111 1111 1111 1111');
  assert.match(card.text, /card numbers/);
  assert.ok(!JSON.stringify(store.logs).includes('4111 1111 1111 1111'));
});

test('CB-17: card number typed mid lead-flow is refused and the flow waits', async () => {
  const { say, store } = conversation();
  await say('How do I get started?');
  await say('yes');
  await say('Juan');
  const r = await say('4111111111111111');
  assert.equal(r.ruleId, 'prohibited_data');
  const ok = await say('juan@example.com'); // still on the email step
  assert.match(ok.text, /contact number/);
  assert.equal(store.leads.length, 0);
});

test('BR-22, CB-16: complaint → apology + escalation to account manager', async () => {
  const { say } = conversation();
  const r = await say("Your team missed my deadline, I'm upset.");
  assert.match(r.text, /sorry/i);
  assert.match(r.text, /account manager/);
  assert.equal(r.handoff, true);
});

test('CB-12/14: "What\'s the weather in Clark?" → only helps with Kualta services', async () => {
  const { say } = conversation();
  const r = await say("What's the weather in Clark?");
  assert.match(r.text, /only help with questions about Kualta/);
  assert.equal(r.handoff, false);
});

test('CB-16: low retrieval confidence escalates; two failed answers in a row escalate', async () => {
  const low = conversation({ rag: { search: async () => [{ source: 'x', content: 'x', similarity: 0.1 }] } });
  const r1 = await low.say('Tell me about your office dog');
  assert.equal(r1.handoff, true);
  assert.equal(r1.ruleId, 'escalate_low_confidence');

  const weak = conversation({ rag: { search: async () => [{ source: 'faq.md', content: 'x', similarity: 0.6 }], generate: async () => ({ text: 'NO_ANSWER' }) } });
  const a = await weak.say('Tell me about Kualta Agency');
  assert.equal(a.handoff, false);
  assert.match(a.text, /rephrase/);
  const b = await weak.say('Tell me about the agency then');
  assert.equal(b.handoff, true);
  assert.equal(b.ruleId, 'escalate_repeated_failure');
});

test('CB-16: negative feedback counts as a failed answer', async () => {
  const good = conversation({ rag: { search: async () => [{ source: 'faq.md', content: 'x', similarity: 0.6 }], generate: async () => ({ text: 'We are an agency.' }) } });
  await good.say('Tell me about Kualta Agency');
  const n1 = await good.say("that's not what i asked");
  assert.equal(n1.handoff, false);
  const n2 = await good.say('not helpful');
  assert.equal(n2.handoff, true);
});

test('CB-07: timeline question → RAG answer + consultation offer', async () => {
  const { say } = conversation({ rag: { search: async () => [{ source: 'services.md', content: 'SEO first report after 30 days', similarity: 0.7 }], generate: async () => ({ text: 'The first SEO report comes after 30 days.' }) } });
  const r = await say('how long does SEO take?');
  assert.match(r.text, /30 days/);
  assert.match(r.text, /free 30-minute/);
});

test('CB-18: repeated abuse ends the chat and logs it; silence afterwards', async () => {
  const { say, store } = conversation();
  assert.match((await say('gago')).text, /respectful/);
  assert.match((await say('stupid bot')).text, /respectful/);
  assert.match((await say('putangina')).text, /ending this chat/);
  const after = await say('hello?');
  assert.equal(after.text, null);
  assert.ok(store.logs.some((l) => l.flagged === 'chat_ended'));
});

test('CB-19: "DELETE MY DATA" asks to confirm, then deletes leads + logs', async () => {
  const { say, store } = conversation();
  await say('How do I get started?');
  await completeLead(say);
  assert.equal(store.leads.length, 1);
  const c = await say('DELETE MY DATA');
  assert.match(c.text, /Reply YES to confirm/);
  const d = await say('yes');
  assert.match(d.text, /deleted/);
  assert.equal(store.leads.length, 0);
  assert.equal(store.logs.length, 0);
});

test('CB-20: every message is logged with intent, rule, sources, escalation', async () => {
  const { say, store } = conversation();
  await say('hi');
  await say('Can I get 30% off?');
  assert.equal(store.logs.length, 2);
  assert.deepEqual(
    store.logs.map((l) => [l.intent, l.ruleId, l.escalated]),
    [['greeting', 'greeting', false], ['discount', 'discount', true]],
  );
  for (const l of store.logs) assert.ok(Array.isArray(l.sources));
});

test('lead flow: CANCEL stops and saves nothing; 3 invalid answers hand off', async () => {
  const a = conversation();
  await a.say('How do I get started?');
  await a.say('yes');
  const c = await a.say('cancel');
  assert.match(c.text, /Nothing was saved/);
  assert.equal(a.store.leads.length, 0);

  const b = conversation();
  await b.say('How do I get started?');
  await b.say('yes');
  await b.say('Juan');
  await b.say('x');
  await b.say('y');
  const r = await b.say('z');
  assert.equal(r.handoff, true);
  assert.match(r.text, /Nothing was saved/);
});

test('human takeover: after a team member replies in the inbox, the bot stays quiet (CB-16)', async () => {
  const { say, store } = conversation();
  const { pauseForHuman } = await import('../src/chat.js');
  await say('Can I talk to a real person?');
  await pauseForHuman('fb:test-user', { store, now: OPEN, hours: 12 });
  const r = await say('hello? are you there');
  assert.equal(r.text, null);
  assert.equal(store.logs.at(-1).flagged, 'human_active');
});

test('during business hours, booking without a booking URL promises an email', async () => {
  const { say } = conversation({ now: OPEN });
  await say('How do I get started?');
  const r = await completeLead(say);
  assert.match(r.text, /will email juan@example\.com/);
  assert.doesNotMatch(r.text, /offline/);
});

test('AI outage: honest "try again" first, escalation on the second failure', async () => {
  const { say } = conversation({ rag: { embed: async () => { throw new Error('Gemini 429'); } } });
  const a = await say('Tell me about Kualta Agency');
  assert.equal(a.ruleId, 'ai_unavailable');
  assert.equal(a.handoff, false);
  assert.match(a.text, /try again in a minute/);
  const b = await say('Tell me about the agency');
  assert.equal(b.handoff, true);
});

test('typing just HUMAN reaches the team', async () => {
  const { say } = conversation();
  const r = await say('HUMAN');
  assert.equal(r.ruleId, 'human_handoff');
});
