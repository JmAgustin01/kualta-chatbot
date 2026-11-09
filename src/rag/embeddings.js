import { config } from '../config.js';

const OPENAI_URL = 'https://api.openai.com/v1/embeddings';

/**
 * Embed one or many strings with OpenAI text-embedding-3-small (1536 dims).
 * @param {string|string[]} input
 * @returns {Promise<number[][]>}
 */
export async function embed(input, { apiKey = config.openai.apiKey, model = config.openai.embeddingModel, fetchFn = fetch } = {}) {
  const texts = Array.isArray(input) ? input : [input];
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const res = await fetchFn(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI embeddings failed: ${res.status} ${await safeText(res)}`);
  }
  const json = await res.json();
  // API returns items with an index; sort to be safe
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/** Embed a large list in batches to stay well under request limits. */
export async function embedBatched(texts, batchSize = 96, opts) {
  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    out.push(...(await embed(texts.slice(i, i + batchSize), opts)));
  }
  return out;
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}
