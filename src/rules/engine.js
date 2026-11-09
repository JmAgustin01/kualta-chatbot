import { rules as defaultRules } from './rules.js';

/**
 * Normalize user text so rules are tolerant of case, accents, extra spaces,
 * trailing punctuation and emoji. "Hello!!! 👋" -> "hello"
 */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ') // emoji
    .replace(/[!?.,~]+$/g, '') // trailing punctuation
    .replace(/[!?.,~]+(\s)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Try every rule in order. Returns the first match or null.
 * @returns {{ ruleId, intent, action:'reply'|'handoff', text, offerLead, startLead, service } | null}
 */
export function matchRules(rawText, ctx, rules = defaultRules) {
  const text = normalize(rawText);

  if (!text || !/[a-z0-9]/.test(text)) {
    return result('empty_or_symbols', 'empty', 'Hi! What would you like to know about Kualta Agency?');
  }

  const wordCount = text.split(' ').length;

  for (const rule of rules) {
    if (rule.when && !rule.when(ctx)) continue;
    if (rule.maxWords && wordCount > rule.maxWords) continue;
    const hit = rule.patterns.some((re) => {
      if (rule.match === 'whole') {
        const anchored = new RegExp(`^(?:${stripAnchors(re.source)})$`, re.flags);
        return anchored.test(text);
      }
      return re.test(text);
    });
    if (!hit) continue;

    const out = rule.respond(ctx, text);
    if (out === null || out === undefined) continue; // rule declined after all
    const o = typeof out === 'string' ? { text: out } : out;
    return result(rule.id, rule.intent ?? rule.id, o.text, o);
  }
  return null;
}

function result(ruleId, intent, text, o = {}) {
  return {
    ruleId,
    intent,
    action: o.action ?? 'reply',
    text,
    offerLead: Boolean(o.offerLead),
    startLead: Boolean(o.startLead),
    service: o.service ?? null,
  };
}

function stripAnchors(src) {
  return src.replace(/^\^/, '').replace(/\$$/, '');
}
