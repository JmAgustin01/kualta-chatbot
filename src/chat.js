import { config } from './config.js';
import { matchRules, normalize } from './rules/engine.js';
import { answerWithRag } from './rag/pipeline.js';
import { loadBusinessRules } from './business/br.js';
import { isOpen } from './business/hours.js';
import { detectProhibited, redact } from './business/validators.js';
import { isOffensive, ABUSE_LIMIT, ABUSE_COOLDOWN_MS } from './business/abuse.js';
import { startLead, stepLead, YES } from './flows/leadFlow.js';
import { getStore } from './store/index.js';

const MAX_INPUT_CHARS = 1000;
const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;
const FAILS_BEFORE_ESCALATION = 2; // CB-16: two failed answers in a row
const NEGATIVE_FEEDBACK = /^(that'?s (wrong|not (it|what i asked|right))|not helpful|wrong( answer)?|hindi (yan|iyan|ganun)|mali( yan)?|you (didn'?t|did not) answer)/;
const TIMELINE = /\b(how long|turnaround|timeline|gaano katagal|kailan matatapos|how soon|when can you start)\b/;
const DELETE_DATA = /\b(delete|erase|remove|burahin|tanggalin) (all )?(my|ang|yung) (data|details|information|info|personal data)( ko)?\b/;

let cachedBR;
const defaultBR = () => (cachedBR ??= loadBusinessRules());

const freshSession = () => ({ flow: null, pendingOffer: null, pendingDelete: false, failCount: 0, abuseStrikes: 0, endedUntil: null, humanUntil: null, consent: null });

/**
 * One entry point for every channel. Processing order (Business Rules, "Processing order"):
 *   1. screen for prohibited content (CB-17) and abuse (CB-18)
 *   2. fixed intents / lead flow (CB-01..CB-11, CB-15, CB-16)
 *   3. RAG (CB-12..CB-14)
 *   4. escalate on low confidence / repeated failure (CB-16)
 * Every message is logged with intent, rule, sources and escalation (CB-20).
 *
 * @param {string} rawText
 * @param {object} opts { userKey, channel, channelPhone, now, store, br, business, ...rag deps }
 * @returns {Promise<{ text: string|null, route, ruleId, intent, handoff, sources, topSimilarity, ms }>}
 */
export async function handleMessage(rawText, opts = {}) {
  const started = Date.now();
  const text = String(rawText ?? '').slice(0, MAX_INPUT_CHARS);
  const norm = normalize(text);
  const store = opts.store ?? getStore();
  const userKey = opts.userKey ?? 'anon:local';
  const channel = opts.channel ?? 'test';
  const now = opts.now ?? new Date();
  const br = opts.br ?? defaultBR();
  const ctx = {
    business: opts.business ?? config.business,
    br,
    open: isOpen(br.hours, now),
    channelPhone: opts.channelPhone ?? null,
  };

  let session = (await safe(() => store.getSession(userKey))) ?? freshSession();
  if (session.updatedAt && now.getTime() - session.updatedAt > SESSION_IDLE_MS) {
    session = { ...freshSession(), endedUntil: session.endedUntil, humanUntil: session.humanUntil };
  }

  const out = await decide(text, norm, session, ctx, opts, store, userKey, channel, now);

  if (!out.skipLog) {
    await safe(() =>
      store.logMessage({
        userKey,
        channel,
        text: redact(text),
        intent: out.intent,
        ruleId: out.ruleId,
        route: out.route,
        sources: out.sources ?? [],
        escalated: out.handoff,
        topSimilarity: out.topSimilarity ?? null,
        flagged: out.flagged ?? null,
      }),
    );
  }
  if (!out.skipSave) await safe(() => store.saveSession(userKey, out.session));

  return {
    text: out.text,
    route: out.route,
    ruleId: out.ruleId ?? null,
    intent: out.intent ?? null,
    handoff: Boolean(out.handoff),
    sources: out.sources ?? [],
    topSimilarity: out.topSimilarity ?? null,
    ms: Date.now() - started,
  };
}

async function decide(text, norm, s, ctx, opts, store, userKey, channel, now) {
  const reply = (fields) => ({ route: 'rule', handoff: false, ...fields, session: fields.session ?? s });

  // --- A team member is handling this customer in the Page inbox: stay quiet, still log
  if (s.humanUntil && now.getTime() < s.humanUntil) {
    return reply({ text: null, ruleId: 'human_active', intent: 'human_active', flagged: 'human_active' });
  }

  // --- Chat ended for abuse (CB-18): stay silent until cooldown passes, still log it
  if (s.endedUntil && now.getTime() < s.endedUntil) {
    return reply({ text: null, ruleId: 'chat_ended', intent: 'abuse', flagged: 'chat_ended' });
  }

  // --- 1a. Prohibited data (CB-17): never store it, never continue a flow with it
  const prohibited = detectProhibited(text);
  if (prohibited.found) {
    return reply({
      text: ctx.br.prohibitedReply ?? "For your security, please don't send passwords, card numbers or bank details here. I haven't saved it.",
      ruleId: 'prohibited_data',
      intent: 'prohibited',
      flagged: 'prohibited',
    });
  }

  // --- 1b. Abuse (CB-18)
  if (isOffensive(norm)) {
    const strikes = (s.abuseStrikes ?? 0) + 1;
    if (strikes >= ABUSE_LIMIT) {
      return reply({
        text: "I'm ending this chat now. You're welcome to message us again later.",
        ruleId: 'abuse_end',
        intent: 'abuse',
        flagged: 'abuse',
        session: { ...s, flow: null, pendingOffer: null, abuseStrikes: strikes, endedUntil: now.getTime() + ABUSE_COOLDOWN_MS },
      });
    }
    return reply({
      text: "Let's keep this respectful. I'm here to help with Kualta Agency's services.",
      ruleId: 'abuse_warning',
      intent: 'abuse',
      flagged: 'abuse',
      session: { ...s, abuseStrikes: strikes },
    });
  }

  // --- Delete my data (CB-19): confirm, then delete everything for this user
  if (s.pendingDelete) {
    if (YES.test(norm)) {
      const counts = await safe(() => store.deleteUserData(userKey));
      return {
        ...reply({ text: counts ? 'Done. Your saved details and chat history with us have been deleted.' : "Sorry, I couldn't delete your data right now. I've flagged it for our team.", ruleId: 'delete_data_done', intent: 'delete_data', handoff: !counts }),
        session: freshSession(),
        skipLog: Boolean(counts), // don't re-create a log row right after deleting them
      };
    }
    s = { ...s, pendingDelete: false };
    if (!DELETE_DATA.test(norm)) return reply({ text: "Okay, I won't delete anything.", ruleId: 'delete_data_cancelled', intent: 'delete_data', session: s });
  }
  if (DELETE_DATA.test(norm)) {
    return reply({
      text: 'This will delete your saved details and chat history with Kualta Agency. Reply YES to confirm.',
      ruleId: 'delete_data_confirm',
      intent: 'delete_data',
      session: { ...s, flow: null, pendingOffer: null, pendingDelete: true },
    });
  }

  // --- 2a. Active lead flow (CB-08/09)
  if (s.flow?.name === 'lead') {
    const r = stepLead(s.flow, text, ctx);
    if (r.lead) {
      const saved = await safe(async () => (await store.saveLead({ ...r.lead, userKey, channel }), true));
      if (!saved) {
        return reply({
          text: "Sorry, I couldn't save your details just now. I've flagged this for our team so they can reach out.",
          ruleId: 'lead_flow',
          intent: 'lead_save_failed',
          handoff: true,
          session: { ...s, flow: null },
        });
      }
    }
    return reply({
      text: r.text,
      ruleId: 'lead_flow',
      intent: r.intent,
      handoff: Boolean(r.handoff) || Boolean(r.lead),
      session: { ...s, flow: r.flow, consent: r.consent ?? s.consent, failCount: 0 },
    });
  }

  // --- 2b. Pending "Reply YES" offer (consultation / take details)
  if (s.pendingOffer) {
    const offer = s.pendingOffer;
    s = { ...s, pendingOffer: null };
    if (YES.test(norm) && norm.split(' ').length <= 4) {
      const r = startLead(ctx, { service: offer.service });
      return reply({ text: r.text, ruleId: 'lead_start', intent: 'buying_intent', handoff: Boolean(r.handoff), session: { ...s, flow: r.flow } });
    }
  }

  // --- 2c. Fixed intents (CB-01..CB-11, CB-15, CB-16)
  const rule = matchRules(text, ctx, opts.rules);
  if (rule) {
    if (rule.startLead) {
      const r = startLead(ctx, { service: rule.service, intro: rule.text });
      return reply({ text: r.text, ruleId: rule.ruleId, intent: rule.intent, handoff: Boolean(r.handoff), session: { ...s, flow: r.flow, failCount: 0 } });
    }
    return reply({
      text: rule.text,
      ruleId: rule.ruleId,
      intent: rule.intent,
      handoff: rule.action === 'handoff',
      session: { ...s, pendingOffer: rule.offerLead ? { type: 'lead', service: rule.service } : null, failCount: 0 },
    });
  }

  // --- Negative feedback counts as a failed answer (CB-16)
  const negative = NEGATIVE_FEEDBACK.test(norm);

  // --- 3. RAG (CB-12..CB-14)
  const rag = negative ? null : await answerWithRag(text, { ...opts, business: ctx.business, br: ctx.br });
  const failed = negative || rag.route === 'fallback';
  const failCount = failed ? (s.failCount ?? 0) + 1 : 0;

  // --- 4. Escalate (CB-16)
  if (failed && (failCount >= FAILS_BEFORE_ESCALATION || rag?.reason === 'below_threshold' || rag?.reason === 'error')) {
    const after = ctx.open === false ? ` ${ctx.br.hours.afterHoursReply ?? 'A human will reply within 1 business day.'}` : '';
    const base =
      failCount >= FAILS_BEFORE_ESCALATION
        ? "Sorry I couldn't help with that. I've passed this conversation to our team."
        : "I don't have that information, so I've passed your question to our team.";
    return {
      route: rag ? rag.route : 'rule',
      ruleId: failCount >= FAILS_BEFORE_ESCALATION ? 'escalate_repeated_failure' : 'escalate_low_confidence',
      intent: 'escalation',
      text: `${base}${after} Want me to take your details so they can reach you? Reply YES.`,
      handoff: true,
      sources: rag?.sources ?? [],
      topSimilarity: rag?.topSimilarity ?? null,
      session: { ...s, failCount: failCount >= FAILS_BEFORE_ESCALATION ? 0 : failCount, pendingOffer: { type: 'lead' } },
    };
  }

  if (failed) {
    return {
      route: rag ? rag.route : 'rule',
      ruleId: negative ? 'negative_feedback' : null,
      intent: 'rag_no_answer',
      text: negative
        ? 'Sorry about that. Could you rephrase your question, or tell me which service it is about?'
        : "I couldn't find that in our information. Could you rephrase it, or ask about one of our services?",
      handoff: false,
      sources: rag?.sources ?? [],
      topSimilarity: rag?.topSimilarity ?? null,
      session: { ...s, failCount },
    };
  }

  // CB-07: timeline questions show buying intent → offer the consultation
  let answer = rag.text;
  let pendingOffer = null;
  if (TIMELINE.test(norm) && ctx.br.consultationOffer) {
    answer += ` ${ctx.br.consultationOffer} Would you like to book one? Reply YES.`;
    pendingOffer = { type: 'lead' };
  }
  return {
    route: 'rag',
    ruleId: null,
    intent: 'knowledge_question',
    text: answer,
    handoff: false,
    sources: rag.sources,
    topSimilarity: rag.topSimilarity,
    session: { ...s, failCount: 0, pendingOffer },
  };
}

/**
 * Called when a team member replies from the Page inbox: the bot stays quiet for this
 * customer for HUMAN_PAUSE_HOURS so it doesn't talk over the human (CB-16 handoff).
 */
export async function pauseForHuman(userKey, { store = getStore(), now = new Date(), hours = config.messenger.humanPauseHours } = {}) {
  const session = (await safe(() => store.getSession(userKey))) ?? freshSession();
  await safe(() =>
    store.saveSession(userKey, { ...session, flow: null, pendingOffer: null, humanUntil: now.getTime() + hours * 60 * 60 * 1000 }),
  );
}

async function safe(fn) {
  try {
    return await fn();
  } catch (err) {
    console.error('[store]', err.message);
    return null;
  }
}
