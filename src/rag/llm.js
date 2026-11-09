import { config } from '../config.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Single-turn generation with Gemini Flash via REST (no SDK, fewer moving parts).
 *
 * Notes:
 * - temperature/top_p/top_k are deprecated on current Gemini models, so we don't send them.
 * - Gemini 3.x Flash "thinks" before answering, and thinking tokens count against
 *   maxOutputTokens. We ask for a low thinking level and leave headroom so the visible
 *   answer isn't cut to nothing. If the API rejects the thinking setting, we retry once without it.
 *
 * @returns {Promise<{ text: string, usage: object|null }>}
 */
export async function generate({ system, user }, {
  apiKey = config.gemini.apiKey,
  model = config.gemini.model,
  fallbackModels = config.gemini.fallbackModels,
  maxOutputTokens = config.gemini.maxOutputTokens,
  thinkingLevel = config.gemini.thinkingLevel,
  fetchFn = fetch,
  logger = console,
} = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  // Each Gemini model has its own free-tier quota. If one is rate-limited (429) or
  // overloaded (5xx), try the next instead of failing the customer's message.
  const models = [model, ...fallbackModels.filter((m) => m && m !== model)];
  let lastError;
  for (const m of models) {
    try {
      return await generateWith(m, { system, user, apiKey, maxOutputTokens, thinkingLevel, fetchFn });
    } catch (err) {
      lastError = err;
      if (!err.retryable) throw err;
      logger.warn?.(`[llm] ${m} unavailable (${err.status}); trying next model`);
    }
  }
  throw lastError;
}

async function generateWith(model, { system, user, apiKey, maxOutputTokens, thinkingLevel, fetchFn }) {
  const call = async (withThinking) => {
    const generationConfig = { maxOutputTokens };
    if (withThinking && thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel };
    return fetchFn(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig,
      }),
    });
  };

  let res = await call(true);
  if (res.status === 400 && thinkingLevel) {
    const body = await res.text().catch(() => '');
    if (/thinking/i.test(body)) res = await call(false);
    else throw httpError(model, 400, body);
  }
  if (!res.ok) throw httpError(model, res.status, await res.text().catch(() => ''));

  const json = await res.json();
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought) // never send thought summaries to the customer
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  return { text, usage: json.usageMetadata ?? null, model };
}

function httpError(model, status, body) {
  const err = new Error(`Gemini ${model} failed: ${status} ${String(body).slice(0, 300)}`);
  err.status = status;
  err.retryable = status === 429 || status >= 500;
  return err;
}
