/**
 * Rules-first layer: fixed intents answered WITHOUT a vector search or LLM call.
 * Business values come from config/business-rules.json (ctx.br). The CB-xx / BR-xx ids
 * refer to "Kualta Agency - Business Rules".
 *
 * Rule shape:
 *   id        unique name (logged as rule_id, CB-20)
 *   intent    intent label (logged, CB-20)
 *   match     'whole' (message must be only this) | 'contains'
 *   patterns  RegExp[] tested on normalized text
 *   maxWords  optional: only fire for messages up to this many words, so multi-part
 *             questions go to RAG instead of getting half an answer
 *   respond   (ctx, text) => string | { text, action?, offerLead?, startLead?, service? } | null
 *             action: 'reply' (default) | 'handoff'
 *             offerLead: ask "Reply YES" and start lead capture if they agree (CB-07)
 *             startLead: begin lead capture now (consent first, CB-09)
 *             null: rule doesn't apply after all, keep looking
 *
 * Order matters: first match wins. Policy rules come before the refund-dispute rule so
 * "is the deposit refundable?" gets the policy, while "I want a refund" escalates.
 */

const handoffTail = (ctx) => {
  const parts = [];
  if (ctx.open === false && ctx.br.hours.afterHoursReply) parts.push(ctx.br.hours.afterHoursReply);
  else if (ctx.open === false) parts.push('A human will reply within 1 business day.');
  const contact = [ctx.business.contactEmail && `email ${ctx.business.contactEmail}`, ctx.business.contactPhone && `call/text ${ctx.business.contactPhone}`]
    .filter(Boolean)
    .join(' or ');
  if (contact) parts.push(`You can also ${contact}.`);
  return parts.length ? ' ' + parts.join(' ') : '';
};

const notConfigured = (ctx) => ({
  text: `Let me pass that to our team so you get the right answer.${handoffTail(ctx)}`,
  action: 'handoff',
});

/** Services mentioned in the text, by keyword or name, from the BR price list. */
export function servicesMentioned(ctx, text) {
  return ctx.br.priceList.filter(
    (p) => p.keywords.some((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) || text.includes(p.service.toLowerCase()),
  );
}

const servicesSentence = (ctx) => `Our services are: ${ctx.br.services.join(', ')}.`;

const consultationAsk = (ctx) =>
  ctx.br.consultationOffer ? ` ${ctx.br.consultationOffer} Would you like to book one? Reply YES.` : '';

export const rules = [
  // ---------- Small talk / identity (CB-01, CB-02) ----------
  {
    id: 'greeting',
    intent: 'greeting',
    match: 'whole',
    patterns: [
      /^(hi+|hello+|hey+|helo|hallo|yo|good (morning|afternoon|evening|day)|kumusta|kamusta|musta|magandang (umaga|hapon|gabi))( po| there| kualta)?$/,
    ],
    respond: () =>
      "Hi! I'm Kualta Agency's virtual assistant. Ask me about our services, rates, or booking a free consultation.",
  },
  {
    id: 'thanks',
    intent: 'thanks',
    match: 'whole',
    patterns: [/^(thanks?( you)?( so much| po)?|thank u|ty|tysm|salamat( po)?|maraming salamat( po)?)$/],
    respond: () => "You're welcome! Anything else I can help with?",
  },
  {
    id: 'goodbye',
    intent: 'goodbye',
    match: 'whole',
    patterns: [/^(bye+|goodbye|see you|see ya|paalam|ok(ay)? bye)$/],
    respond: () => 'Thanks for reaching out to Kualta Agency. Have a great day!',
  },
  {
    id: 'identity',
    intent: 'identity',
    match: 'contains',
    patterns: [
      /\bare you (a |an )?(bot|robot|human|real|person|ai|machine|chatbot)\b/,
      /\bis this (a |an )?(bot|robot|human|real person|ai)\b/,
      /\b(tao|bot|robot) ka( ba)?\b/,
      /\bwho (are|r) (you|u)\b/,
    ],
    maxWords: 10,
    respond: () =>
      "I'm Kualta Agency's virtual assistant, not a human. I can answer questions about our services, or connect you with our team.",
  },

  // ---------- Escalations (CB-16) ----------
  {
    id: 'human_handoff',
    intent: 'human_request',
    match: 'contains',
    patterns: [
      /\b(talk|speak|chat) (to|with) (a |an |the )?(human|person|agent|staff|someone|representative|rep|real person|account manager)\b/,
      /\b(real|live) (person|human|agent)\b/,
      /\b(customer service|operator)\b/,
      /\b(kausap|makausap) (ng |ang )?(tao|staff|agent)\b/,
      /^(human|agent|person|tao)$/,
    ],
    respond: (ctx) => ({ text: `Sure, I'll pass you to our team.${handoffTail(ctx)}`, action: 'handoff' }),
  },
  {
    id: 'complaint',
    intent: 'complaint',
    match: 'contains',
    patterns: [
      /\b(complain|complaint|reklamo|upset|disappointed|frustrated|angry|unacceptable|terrible|worst|not happy|di (ako )?masaya|nakakainis)\b/,
      /\bmissed (my |the |our )?(deadline|schedule|date)\b/,
      /\b(bad|poor) (service|work|quality)\b/,
    ],
    respond: (ctx) =>
      ctx.br.complaintReply ? { text: ctx.br.complaintReply, action: 'handoff' } : notConfigured(ctx), // reply already states the 1-business-day timing
  },

  // ---------- Prohibited data request (CB-17): user asks if they can send logins ----------
  {
    id: 'account_access_question',
    intent: 'account_access',
    match: 'contains',
    patterns: [/\b(send|give|share)\b.*\b(password|login|log-?in|credentials|access)\b/],
    respond: (ctx) => ctx.br.prohibitedReply ?? notConfigured(ctx),
  },

  // ---------- Policies, exact wording (CB-15, BR-09..BR-19) ----------
  {
    id: 'policy_payment',
    intent: 'policy_payment',
    match: 'contains',
    patterns: [
      /\b(deposit|downpayment|down payment|refundable|payment terms?|pay(ment)? schedule|how (do|can) i pay|billing|billed|due date|late payment|installments?|balance)\b/,
      /\bad spend\b/,
    ],
    respond: (ctx) => ctx.br.policies.payment ?? notConfigured(ctx),
  },
  {
    id: 'policy_revision',
    intent: 'policy_revision',
    match: 'contains',
    patterns: [/\b(revisions?|revise|rounds? of (changes|edits)|edit rounds?)\b/],
    respond: (ctx) => ctx.br.policies.revision ?? notConfigured(ctx),
  },
  {
    id: 'policy_cancellation',
    intent: 'policy_cancellation',
    match: 'contains',
    patterns: [/\b(cancel|cancell?ation|terminate|termination|stop (my |the )?(retainer|service|contract|subscription))\b/],
    respond: (ctx) => ctx.br.policies.cancellation ?? notConfigured(ctx),
  },
  {
    id: 'policy_ownership',
    intent: 'policy_ownership',
    match: 'contains',
    patterns: [/\b(ownership|who owns|intellectual property|ip rights|copyright|source files|final files|in your portfolio)\b/],
    respond: (ctx) => ctx.br.policies.ownership ?? notConfigured(ctx),
  },

  // ---------- Disputes & custom quotes (CB-16) ----------
  {
    id: 'dispute',
    intent: 'dispute',
    match: 'contains',
    patterns: [/\b(refund|chargeback|dispute|breach|ibalik (ang |yung )?(pera|bayad))\b/, /\bcontract (issue|problem|dispute)\b/],
    respond: (ctx) => ({ text: `I'll pass this to our team so they can review it with you.${handoffTail(ctx)}`, action: 'handoff' }),
  },
  {
    id: 'custom_quote',
    intent: 'custom_quote',
    match: 'contains',
    patterns: [/\bcustom (quote|quotation|package|plan|price)\b/, /\b(send|give) (me |us )?(a )?(quote|quotation)\b/, /\bquotation for\b/],
    respond: (ctx) => ({ text: `Custom quotes are prepared by our team after a free consultation. I'll pass this to them.${handoffTail(ctx)}`, action: 'handoff', offerLead: true }),
  },

  // ---------- Discounts (CB-05, BR-07) ----------
  {
    id: 'discount',
    intent: 'discount',
    match: 'contains',
    patterns: [/\b(discount|discounted|promo|promotion|voucher|coupon|tawad|negotiate|cheaper|lower (the )?price)\b/, /\d+\s?% off\b/],
    respond: (ctx) => (ctx.br.discountReply ? { text: ctx.br.discountReply, action: 'handoff' } : notConfigured(ctx)),
  },

  // ---------- Results (CB-06, BR-16) ----------
  {
    id: 'results_guarantee',
    intent: 'results',
    match: 'contains',
    patterns: [
      /\b(guarantee[ds]?|garantiya)\b.*\b(followers|likes|sales|ranking|rank|results?|first page|page 1|leads|views|traffic|roi|viral)\b/,
      /\b(promise|sure|sigurado)\b.*\b(followers|likes|sales|ranking|rank|first page|page 1|leads|views|viral)\b/,
      /\bwill (i|we) (get|reach|have)\b.*\b(followers|sales|ranking|first page|leads|views)\b/,
    ],
    respond: (ctx) => ctx.br.resultsReply ?? notConfigured(ctx),
  },

  // ---------- Pricing (CB-04 + CB-07 consultation offer) ----------
  {
    id: 'pricing',
    intent: 'pricing',
    match: 'contains',
    patterns: [/\b(price|prices|pricing|cost|costs|how much|magkano|presyo|rates?|fees?|budget|package price)\b/],
    respond: (ctx, text) => {
      if (!ctx.br.priceList.length || !ctx.br.quotationNote) return notConfigured(ctx);
      const hit = servicesMentioned(ctx, text);
      const list = hit.length ? hit : ctx.br.priceList;
      const lines = list.map((p) => `${p.service} starts at ${p.startingAt}.`).join(' ');
      return {
        text: `${hit.length ? '' : 'Here are our starting rates: '}${lines} ${ctx.br.quotationNote}${consultationAsk(ctx)}`.trim(),
        offerLead: Boolean(ctx.br.consultationOffer),
        service: hit.length === 1 ? hit[0].service : null,
      };
    },
  },

  // ---------- Services (CB-03, BR-03) ----------
  {
    id: 'services_list',
    intent: 'services',
    match: 'contains',
    maxWords: 9,
    patterns: [
      /\b(what|which|ano)\b.*\b(services?|do you (offer|do)|offer|ino-?offer)\b/,
      /^(your )?services$/,
      /\bano (po )?(ang )?(mga )?services\b/,
    ],
    respond: (ctx) => (ctx.br.services.length ? `${servicesSentence(ctx)}${consultationAsk(ctx)}` : null),
  },
  {
    id: 'service_not_offered',
    intent: 'service_inquiry',
    match: 'contains',
    patterns: [/\b(do|can|could) you (do|offer|make|build|create|provide|handle|develop)\b/, /\b(gumagawa|nagga?gawa) (ba )?kayo\b/, /\bdo you have (a )?.*service\b/],
    respond: (ctx, text) => {
      if (!ctx.br.services.length) return null;
      if (/\bservices?\b/.test(text)) return null; // asking about services in general, not a specific unlisted one
      if (servicesMentioned(ctx, text).length) return null; // a listed service: let RAG answer the detail
      return {
        text: `That isn't one of our listed services. ${servicesSentence(ctx)} I can check with our team about your request. Want me to take your details? Reply YES.`,
        offerLead: true,
      };
    },
  },

  // ---------- Buying intent → consultation + lead capture (CB-07, CB-08) ----------
  {
    id: 'buying_intent',
    intent: 'buying_intent',
    match: 'contains',
    patterns: [
      /\b(get(ting)? started|how (do|can) (i|we) (start|begin|avail)|sign up|hire (you|kualta|your team)|want to hire|avail (of )?(your|the)?|book (a |the )?(free )?(consultation|consult|call|meeting|appointment)|schedule (a )?(consultation|call|meeting)|i('m| am) interested|interested in|magpagawa|paano (mag-?)?(avail|simula|magsimula))\b/,
      /\b(free )?consultation\b/,
    ],
    respond: (ctx, text) => {
      const hit = servicesMentioned(ctx, text);
      return {
        text: ctx.br.consultationOffer ?? 'Our team can walk you through the next steps.',
        startLead: true,
        service: hit.length === 1 ? hit[0].service : null,
      };
    },
  },

  // ---------- Hours & contact (CB-10/11) ----------
  {
    id: 'hours',
    intent: 'hours',
    match: 'contains',
    maxWords: 10,
    patterns: [/\b(business|office|working|opening) hours\b/, /\bare you open\b/, /\banong oras\b/, /\bwhat time do you (open|close)\b/],
    respond: (ctx) =>
      ctx.br.hours.label ? `Our team is available ${ctx.br.hours.label}. A human replies within 1 business day.` : null,
  },
  {
    id: 'contact',
    intent: 'contact',
    match: 'contains',
    maxWords: 8,
    patterns: [
      /\bhow (can|do|could) i (contact|reach|email|call) (you|kualta|the team)\b/,
      /\b(contact|email|phone) (details|info|information|number|address)\b/,
      /\b(your|ur) (email|phone|number|contact)\b/,
      /\bpaano (kayo|ko kayo) (ma-?contact|makontak|matatawagan)\b/,
    ],
    respond: (ctx) => {
      const contact = [ctx.business.contactEmail && `email ${ctx.business.contactEmail}`, ctx.business.contactPhone && `call/text ${ctx.business.contactPhone}`]
        .filter(Boolean)
        .join(' or ');
      return contact
        ? `You can reach the Kualta team by ${contact}.`
        : { text: 'I can have our team contact you. Want me to take your details? Reply YES.', offerLead: true };
    },
  },

  // ---------- Off-topic (CB-12, CB-18): decline politely, no escalation ----------
  {
    id: 'out_of_scope_creative',
    intent: 'off_topic',
    match: 'contains',
    patterns: [
      /\b(write|compose|make|gawa|gumawa)( me| ako| ng)? (a |an )?(poem|tula|song|lyrics|haiku|joke|riddle|bedtime story|essay)\b/,
      /\btell me a (joke|story|riddle)\b/,
    ],
    respond: () => "I can only help with questions about Kualta Agency and its services. Is there something about our work I can help with?",
  },
  {
    id: 'out_of_scope_math',
    intent: 'off_topic',
    match: 'contains',
    // "what is 45 + 19", "ano ang 5+5", bare "12*7". A phone number like "0917-123-4567" must NOT match.
    patterns: [
      /^(what is|what's|solve|compute|calculate|ano ang) [\d\s.()+\-*/x^=]*\d\s*[+\-*/x^]\s*\d[\d\s.()+\-*/x^=]*$/,
      /^\d+(\.\d+)?\s*[+*/x^]\s*\d+(\.\d+)?(\s*[+\-*/x^]\s*\d+(\.\d+)?)*\s*=?$/,
      /\bsolve (for )?x\b/,
    ],
    respond: () => "I'm only set up to answer questions about Kualta Agency. What would you like to know about our services?",
  },
  {
    id: 'out_of_scope_general',
    intent: 'off_topic',
    match: 'contains',
    patterns: [
      /\b(weather|temperature|forecast|ulan|panahon)\b/,
      /\b(nba|pba|basketball|football|lotto|horoscope|recipe|movie|showtimes)\b/,
      /\bwho won\b/,
      /\b(news today|latest news|stock price|bitcoin price)\b/,
    ],
    respond: () => "I can only help with questions about Kualta Agency's services. Is there anything about our work I can help with?",
  },
];
