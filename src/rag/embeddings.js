import { config } from '../config.js';

/**
 * Text embeddings, 1536 dimensions (matches vector(1536) in supabase/schema.sql).
 *
 * Provider is set by EMBEDDING_PROVIDER:
 *   gemini (default) -> gemini-embedding-001 with outputDimensionality 1536, free tier
 *   openai           -> text-embedding-3-small (needs OpenAI credit)
 *
 * taskType tells Gemini whether the text is a stored document or a user's question,
 * which improves matching. OpenAI ignores it.
 *
 * Switching provider or model makes old vectors incomparable; the startup auto-load
 * notices (the model is part of the knowledge fingerprint) and re-embeds everything.
 */
export const DIMENSIONS = 1536;

export function embeddingModelId(cfg = config.embeddings) {
  return `${cfg.provider}:${cfg.provider === 'openai' ? cfg.openaiModel : cfg.geminiModel}:${DIMENSIONS}`;
}

/**
 * @param {string|string[]} input
 * @param {{ taskType?: 'RETRIEVAL_QUERY'|'RETRIEVAL_DOCUMENT', cfg?: object, fetchFn?: Function }} opts
 * @returns {Promise<number[][]>}
 */
export async function embed(input, { taskType = 'RETRIEVAL_QUERY', cfg = config.embeddings, fetchFn = fetch } = {}) {
  const texts = Array.isArray(input) ? input : [input];
  return cfg.provider === 'openai' ? embedOpenAI(texts, cfg, fetchFn) : embedGemini(texts, taskType, cfg, fetchFn);
}

/** Embed many documents, a few requests at a time to stay inside free-tier rate limits. */
export async function embedBatched(texts, batchSize = 8, opts = {}) {
  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    out.push(...(await embed(texts.slice(i, i + batchSize), { taskType: 'RETRIEVAL_DOCUMENT', ...opts })));
  }
  return out;
}

async function embedGemini(texts, taskType, cfg, fetchFn) {
  if (!cfg.geminiApiKey) throw new Error('GEMINI_API_KEY is not set');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.geminiModel)}:embedContent`;
  // One request per text, sent in parallel within the batch (embedContent takes a single input).
  return Promise.all(
    texts.map(async (text) => {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiApiKey },
        body: JSON.stringify({ content: { parts: [{ text }] }, taskType, outputDimensionality: DIMENSIONS }),
      });
      if (!res.ok) throw new Error(`Gemini embeddings failed: ${res.status} ${await safeText(res)}`);
      const json = await res.json();
      const values = json.embedding?.values;
      if (!Array.isArray(values) || values.length !== DIMENSIONS) {
        throw new Error(`Gemini embeddings returned ${values?.length ?? 0} dimensions, expected ${DIMENSIONS}`);
      }
      return values;
    }),
  );
}

async function embedOpenAI(texts, cfg, fetchFn) {
  if (!cfg.openaiApiKey) throw new Error('OPENAI_API_KEY is not set');
  const res = await fetchFn('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.openaiApiKey}` },
    body: JSON.stringify({ model: cfg.openaiModel, input: texts }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings failed: ${res.status} ${await safeText(res)}`);
  const json = await res.json();
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}
