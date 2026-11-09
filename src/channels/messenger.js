import crypto from 'node:crypto';
import express from 'express';
import { config } from '../config.js';
import { handleMessage, pauseForHuman } from '../chat.js';
import { userKeyFor } from '../store/index.js';

/**
 * Facebook Messenger channel (Messenger Platform webhook on the Kualta demo Page).
 *   GET  /webhook/messenger  -> Meta's one-time verification handshake
 *   POST /webhook/messenger  -> incoming messages (signature-verified)
 *
 * Human takeover: when a team member replies from the Page inbox (Business Suite), Meta sends
 * an "echo" of that message without our app's id. The bot then stays quiet for that customer
 * for HUMAN_PAUSE_HOURS so it doesn't talk over the person.
 */
export function messengerRouter({
  handle = handleMessage,
  send = sendText,
  pause = pauseForHuman,
  fb = config.messenger,
  logger = console,
  keyFor = userKeyFor,
} = {}) {
  const router = express.Router();
  const seen = new RecentIds(10 * 60 * 1000); // Meta retries deliveries; don't answer twice

  router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token && token === fb.verifyToken) {
      return res.status(200).send(String(challenge)); // must be the raw string, not JSON
    }
    return res.sendStatus(403);
  });

  router.post('/', (req, res) => {
    if (!isValidSignature(req.rawBody, req.get('x-hub-signature-256'), fb.appSecret)) {
      logger.warn('[messenger] rejected: bad signature');
      return res.sendStatus(401);
    }
    res.sendStatus(200); // acknowledge fast; Meta retries slow webhooks

    for (const ev of extractEvents(req.body)) {
      if (ev.id && seen.has(ev.id)) continue;
      if (ev.id) seen.add(ev.id);
      processEvent(ev, { handle, send, pause, fb, logger, keyFor }).catch((err) =>
        logger.error('[messenger] processing failed:', err.message),
      );
    }
  });

  return router;
}

async function processEvent(ev, { handle, send, pause, fb, logger, keyFor }) {
  if (ev.kind === 'echo') {
    // Our own replies come back as echoes with our app id; anything else is a human in the inbox.
    if (fb.appId && String(ev.appId ?? '') !== String(fb.appId)) {
      await pause(keyFor('fb', ev.customerId));
      logger.info(`[messenger] human replied to ${mask(ev.customerId)}; bot paused for this customer`);
    }
    return;
  }

  if (ev.kind !== 'text') {
    await send(ev.customerId, 'Sorry, I can only read text messages for now. Please type your question.', { fb });
    return;
  }

  const result = await handle(ev.text, { userKey: keyFor('fb', ev.customerId), channel: 'messenger' });
  logger.info(
    JSON.stringify({ channel: 'messenger', id: ev.id, route: result.route, ruleId: result.ruleId, intent: result.intent, handoff: result.handoff, ms: result.ms }),
  );
  if (result.handoff) {
    logger.warn(`[handoff] customer ${mask(ev.customerId)} needs a human (intent: ${result.intent}). Reply from the Page inbox.`);
  }
  if (result.text) await send(ev.customerId, result.text, { fb }); // null = bot is quiet (abuse end or human active)
}

/**
 * Flatten Meta's webhook payload into simple events.
 * kinds: 'text' (customer typed), 'other' (attachment/sticker), 'echo' (a message the Page sent)
 */
export function extractEvents(body) {
  if (body?.object !== 'page') return [];
  const out = [];
  for (const entry of body.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      const msg = m.message;
      if (msg?.is_echo) {
        out.push({ kind: 'echo', id: msg.mid, customerId: m.recipient?.id, appId: msg.app_id ?? null });
      } else if (msg?.text) {
        out.push({ kind: 'text', id: msg.mid, customerId: m.sender?.id, text: msg.quick_reply?.payload ?? msg.text });
      } else if (msg) {
        out.push({ kind: 'other', id: msg.mid, customerId: m.sender?.id });
      } else if (m.postback) {
        // "Get Started" button or a persistent-menu tap: treat its payload/title as typed text
        out.push({ kind: 'text', id: m.postback.mid, customerId: m.sender?.id, text: m.postback.payload || m.postback.title || 'hi' });
      }
      // delivery / read receipts are ignored
    }
  }
  return out;
}

export function isValidSignature(rawBody, header, appSecret) {
  if (!appSecret || !header || !rawBody) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Messenger Send API. Splits replies over Messenger's 2,000-character limit. */
export async function sendText(psid, text, { fb = config.messenger, fetchFn = fetch } = {}) {
  const url = `https://graph.facebook.com/${fb.apiVersion}/me/messages`;
  for (const part of splitMessage(text, 2000)) {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fb.pageAccessToken}` },
      body: JSON.stringify({ recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text: part } }),
    });
    if (!res.ok) {
      throw new Error(`Messenger send failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
    }
  }
}

export function splitMessage(text, max) {
  const parts = [];
  let rest = String(text);
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

const mask = (id = '') => (id.length > 4 ? `***${id.slice(-4)}` : '***');

class RecentIds {
  constructor(ttlMs) {
    this.ttl = ttlMs;
    this.map = new Map();
  }
  has(id) {
    const t = this.map.get(id);
    if (t && Date.now() - t < this.ttl) return true;
    this.map.delete(id);
    return false;
  }
  add(id) {
    this.map.set(id, Date.now());
    if (this.map.size > 5000) {
      for (const [k, t] of this.map) if (Date.now() - t > this.ttl) this.map.delete(k);
    }
  }
}
