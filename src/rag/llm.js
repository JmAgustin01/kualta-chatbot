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
  maxOutputTokens = config.gemini.maxOutputTokens,
  thinkingLevel = config.gemini.thinkingLevel,
  fetchFn = fetch,
} = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

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
    else throw new Error(`Gemini failed: 400 ${body.slice(0, 500)}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini failed: ${res.status} ${body.slice(0, 500)}`);
  }

  const json = await res.json();
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought) // never send thought summaries to the customer
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  return { text, usage: json.usageMetadata ?? null };
}
