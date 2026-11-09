import express from 'express';
import { userKeyFor } from '../store/index.js';

/**
 * Public web chat (no login, no Meta approval). Anyone with the link can talk to the bot,
 * so this endpoint is the one place strangers reach us directly. Guards:
 *  - per-visitor limit (default 15 messages / minute) and a daily cap for the whole site,
 *    so the Gemini free tier isn't drained by one person or a script
 *  - message length cap
 *  - the visitor id is a random UUID made by their browser; we store only its salted hash
 */
export function webChatRouter({
  handle,
  perMinute = Number(process.env.WEB_CHAT_PER_MINUTE || 15),
  perDay = Number(process.env.WEB_CHAT_PER_DAY || 2000),
  maxChars = 1000,
  facebookUrl = process.env.FACEBOOK_PAGE_URL || '',
  now = () => Date.now(),
} = {}) {
  const router = express.Router();
  const recent = new Map(); // ip -> timestamps in the last minute
  let day = '';
  let dayCount = 0;

  router.post('/', async (req, res) => {
    const t = now();
    const today = new Date(t).toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      dayCount = 0;
      recent.clear();
    }

    const ip = req.ip || 'unknown';
    const hits = (recent.get(ip) || []).filter((x) => t - x < 60_000);
    if (hits.length >= perMinute) {
      return res.status(429).json({ text: "You're sending messages quickly. Please wait a minute and try again." });
    }
    if (dayCount >= perDay) {
      return res.status(429).json({ text: 'Our chat assistant is busy right now. Please try again later.' });
    }

    const message = req.body?.message;
    const visitorId = req.body?.visitorId;
    if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'message is required' });
    if (typeof visitorId !== 'string' || !/^[0-9a-f-]{36}$/i.test(visitorId)) return res.status(400).json({ error: 'bad visitorId' });
    if (message.length > maxChars) {
      return res.status(400).json({ text: `Please keep messages under ${maxChars} characters.` });
    }

    hits.push(t);
    recent.set(ip, hits);
    dayCount += 1;

    const out = await handle(message, { userKey: userKeyFor('web', visitorId), channel: 'web' });
    let text = out.text;
    // The web page has no live inbox: point people who need a human to the Facebook Page,
    // where the team answers in the Business Suite inbox.
    if (text && out.handoff && facebookUrl) text += `\n\nYou can also message us on Facebook: ${facebookUrl}`;
    res.json({ text, handoff: !!out.handoff });
  });

  return router;
}
