import crypto from 'node:crypto';
import express from 'express';
import { config, missingFor } from './config.js';
import { handleMessage } from './chat.js';
import { messengerRouter } from './channels/messenger.js';

export function createApp({ handle = handleMessage, chatApiKey = config.chatApiKey } = {}) {
  const app = express();

  // Keep the raw body: Meta webhook signature verification needs the exact bytes.
  app.use(
    express.json({
      limit: '200kb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  // Health check (Render uses this; also handy to wake a sleeping free instance)
  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/webhook/messenger', messengerRouter({ handle }));

  // Test endpoint for the eval script and QA. Disabled unless CHAT_API_KEY is set.
  app.post('/chat', async (req, res) => {
    if (!chatApiKey) return res.status(404).end();
    const key = req.get('x-api-key') || '';
    const ok = key.length === chatApiKey.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(chatApiKey));
    if (!ok) return res.status(401).json({ error: 'unauthorized' });

    const message = req.body?.message;
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'body must be { "message": "..." }' });
    }
    // Pass the returned userKey back on the next request to continue the same conversation.
    const raw = typeof req.body?.userKey === 'string' && req.body.userKey ? req.body.userKey.slice(0, 64) : crypto.randomUUID();
    res.json({ userKey: raw, ...(await handle(message, { userKey: `test:${raw}`, channel: 'test' })) });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const feature of ['rag', 'messenger']) {
    const missing = missingFor(feature);
    if (missing.length) console.warn(`[startup] ${feature} not fully configured, missing: ${missing.join(', ')}`);
  }
  createApp().listen(config.port, () => console.log(`Kualta chatbot listening on :${config.port}`));

  // Load /knowledge into Supabase if it changed since the last deploy (no cost when unchanged).
  if (!missingFor('ingest').length) {
    const [{ ensureKnowledge }, { getSupabase }, { embedBatched }] = await Promise.all([
      import('./rag/autoIngest.js'),
      import('./rag/vectorStore.js'),
      import('./rag/embeddings.js'),
    ]);
    ensureKnowledge({ supabase: getSupabase(), embedBatched }).catch((err) => console.error('[kb] auto-load failed:', err.message));
  }
}
