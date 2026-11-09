import { isValidEmail, normalizePhone } from '../business/validators.js';
import { normalize } from '../rules/engine.js';

/**
 * Lead capture (CB-07..CB-11, BR-01, BR-20).
 * consent -> name -> email -> phone -> business -> service -> saved
 * Nothing is stored until every field is valid AND consent was given.
 * CANCEL at any step stops the flow; nothing is saved.
 */

export const YES = /^(yes|y|yep|yeah|oo|opo|oo po|sige|sige po|go|ok|okay|sure|i agree|agree|agreed|g|game)\b/;
export const NO = /^(no|n|nope|hindi|ayoko|ayaw|decline|i decline|dont|don't|do not|wag|huwag)\b/;
const CANCEL = /^(cancel|stop|exit|quit|never ?mind|wag na|huwag na|ayoko na)$/;
const MAX_INVALID = 3;

const PROMPTS = {
  name: "What's your name?",
  email: "What's your email address?",
  phone: "What's your contact number? (e.g. 0917 123 4567)",
  business: "What's your business name?",
};

function servicePrompt(br) {
  const list = br.services.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return `Which service are you interested in? Reply with a number or type it:\n${list}\n${br.services.length + 1}. Something else`;
}

/** Start the flow. Returns { text, flow } or { text, handoff:true } if consent can't be asked. */
export function startLead(ctx, { service = null, intro = '' } = {}) {
  if (!ctx.br.privacyNotice) {
    return { text: `${intro} Let me pass you to our team to set this up.`.trim(), handoff: true, flow: null };
  }
  const notice = ctx.br.privacyNoticeUrl ? `${ctx.br.privacyNotice} Full notice: ${ctx.br.privacyNoticeUrl}` : ctx.br.privacyNotice;
  return {
    text: `${intro ? intro + '\n\n' : ''}To book, I'll need a few details first.\n\n${notice}\n\nDo you agree? Reply YES to continue or NO to skip.`,
    flow: { name: 'lead', step: 'consent', data: { service }, invalid: 0 },
  };
}

/**
 * Advance the flow with the user's message.
 * @returns {{ text, flow|null, lead?:object, handoff?:boolean, consent?:'given'|'declined', intent }}
 */
export function stepLead(flow, rawText, ctx) {
  const text = String(rawText ?? '').trim();
  const norm = normalize(text);

  if (CANCEL.test(norm)) {
    return { text: "Okay, I've stopped. Nothing was saved. Anything else I can help with?", flow: null, intent: 'lead_cancelled' };
  }

  const next = (f, prompt) => ({ text: prompt, flow: { ...f, invalid: 0 }, intent: `lead_${f.step}` });
  const invalid = (msg) => {
    const n = flow.invalid + 1;
    if (n >= MAX_INVALID) {
      return {
        text: "I'm having trouble with that. Let me pass you to our team instead. Nothing was saved.",
        flow: null,
        handoff: true,
        intent: 'lead_failed',
      };
    }
    return { text: `${msg} Or type CANCEL to stop.`, flow: { ...flow, invalid: n }, intent: `lead_${flow.step}_invalid` };
  };

  switch (flow.step) {
    case 'consent':
      if (YES.test(norm)) {
        return { ...next({ ...flow, step: 'name', data: { ...flow.data, consentAt: new Date().toISOString() } }, `Thanks! ${PROMPTS.name}`), consent: 'given' };
      }
      if (NO.test(norm)) {
        const link = ctx.br.bookingUrl ? ` You can still book a free consultation here: ${ctx.br.bookingUrl}` : '';
        return {
          text: `No problem, I won't save any details.${link} You can keep asking me questions anytime.`,
          flow: null,
          consent: 'declined',
          intent: 'consent_declined',
        };
      }
      return invalid('Please reply YES to agree or NO to skip.');

    case 'name':
      if (text.length < 2 || text.length > 80 || !/\p{L}/u.test(text)) return invalid('Please type your name.');
      return next({ ...flow, step: 'email', data: { ...flow.data, name: text } }, `Nice to meet you, ${text.split(' ')[0]}! ${PROMPTS.email}`);

    case 'email':
      if (!isValidEmail(text)) return invalid("That email doesn't look right. Please check it (e.g. name@gmail.com).");
      return next({ ...flow, step: 'phone', data: { ...flow.data, email: text.toLowerCase() } }, PROMPTS.phone);

    case 'phone': {
      const sameAsChat = /^(same|this number|this one|ito|ito na lang|same number)$/.test(norm) && ctx.channelPhone;
      const phone = sameAsChat ? normalizePhone(ctx.channelPhone.startsWith('+') ? ctx.channelPhone : '+' + ctx.channelPhone) : normalizePhone(text);
      if (!phone) return invalid("That number doesn't look right. Please use a format like 0917 123 4567 or +63 917 123 4567.");
      return next({ ...flow, step: 'business', data: { ...flow.data, phone } }, PROMPTS.business);
    }

    case 'business':
      if (text.length < 1 || text.length > 100) return invalid('Please type your business name.');
      if (flow.data.service) return finish({ ...flow, data: { ...flow.data, businessName: text } }, ctx);
      return next({ ...flow, step: 'service', data: { ...flow.data, businessName: text } }, servicePrompt(ctx.br));

    case 'service': {
      const n = Number(norm);
      let service = null;
      if (Number.isInteger(n) && n >= 1 && n <= ctx.br.services.length) service = ctx.br.services[n - 1];
      else if (Number.isInteger(n) && n === ctx.br.services.length + 1) return next({ ...flow, step: 'service_other' }, 'Sure, what service do you need?');
      else service = ctx.br.services.find((s) => norm.includes(s.toLowerCase())) ?? (text.length >= 2 ? `Other: ${text}` : null);
      if (!service) return invalid('Please reply with a number from the list or type the service.');
      return finish({ ...flow, data: { ...flow.data, service } }, ctx);
    }

    case 'service_other':
      if (text.length < 2) return invalid('Please describe the service you need.');
      return finish({ ...flow, data: { ...flow.data, service: `Other: ${text.slice(0, 200)}` } }, ctx);

    default:
      return { text: 'Something went wrong. Let me pass you to our team.', flow: null, handoff: true, intent: 'lead_error' };
  }
}

function finish(flow, ctx) {
  const d = flow.data;
  const lead = {
    name: d.name,
    email: d.email,
    phone: d.phone,
    businessName: d.businessName,
    service: d.service,
    consentAt: d.consentAt,
    privacyNotice: ctx.br.privacyNotice,
    afterHours: ctx.open === false,
  };
  const parts = [`Thanks, ${d.name.split(' ')[0]}! I've passed your details to our team.`];
  if (d.service.startsWith('Other:')) parts.push("That isn't a listed service, so our team will check and get back to you.");
  if (ctx.open === false) parts.push(ctx.br.hours.afterHoursReply ?? 'A human will reply within 1 business day.');
  if (ctx.br.bookingUrl && !d.service.startsWith('Other:')) {
    parts.push(`Pick a consultation slot here: ${ctx.br.bookingUrl} (slots are within business hours). You'll get a confirmation by email.`);
  } else if (!d.service.startsWith('Other:')) {
    parts.push(`Our team will email ${d.email} to schedule your free consultation${ctx.open === false ? '' : ' within 1 business day'}.`);
  }
  return { text: parts.join(' '), flow: null, lead, intent: 'lead_captured' };
}
