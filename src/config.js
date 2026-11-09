import 'dotenv/config';

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v !== undefined ? n : fallback;
};

export const config = {
  port: num(process.env.PORT, 3000),

  embeddings: {
    // gemini (default, free tier) or openai (needs credit)
    provider: (process.env.EMBEDDING_PROVIDER || 'gemini').toLowerCase(),
    geminiModel: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    openaiModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    // Tried in order when the main model is rate-limited or overloaded (each has its own free quota)
    fallbackModels: (process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.5-flash-lite,gemini-2.5-flash-lite')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    maxOutputTokens: num(process.env.MAX_OUTPUT_TOKENS, 1024),
    thinkingLevel: process.env.GEMINI_THINKING_LEVEL ?? 'low',
  },

  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },

  retrieval: {
    topK: num(process.env.TOP_K, 4),
    similarityThreshold: num(process.env.SIMILARITY_THRESHOLD, 0.6),
  },

  messenger: {
    // Graph API version shown in your Meta app dashboard
    apiVersion: process.env.GRAPH_API_VERSION || 'v25.0',
    pageAccessToken: process.env.MESSENGER_PAGE_ACCESS_TOKEN || '',
    verifyToken: process.env.META_VERIFY_TOKEN || '',
    appSecret: process.env.META_APP_SECRET || '',
    appId: process.env.META_APP_ID || '',
    // After a team member replies from the Page inbox, the bot stays quiet for this long
    humanPauseHours: num(process.env.HUMAN_PAUSE_HOURS, 12),
  },

  chatApiKey: process.env.CHAT_API_KEY || '',

  // Salt for hashing user identifiers (phone numbers) in sessions and logs
  dataHashSalt: process.env.DATA_HASH_SALT || '',

  business: {
    contactEmail: process.env.CONTACT_EMAIL || '',
    contactPhone: process.env.CONTACT_PHONE || '',
    hours: process.env.BUSINESS_HOURS || '',
  },
};

const embeddingProvider = () => (process.env.EMBEDDING_PROVIDER || 'gemini').toLowerCase();

/** Returns the names of required env vars that are missing for a given feature. */
export function missingFor(feature) {
  const req = {
    rag: ['GEMINI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', ...(embeddingProvider() === 'openai' ? ['OPENAI_API_KEY'] : [])],
    ingest: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', ...(embeddingProvider() === 'openai' ? ['OPENAI_API_KEY'] : ['GEMINI_API_KEY'])],
    messenger: ['MESSENGER_PAGE_ACCESS_TOKEN', 'META_VERIFY_TOKEN', 'META_APP_SECRET', 'META_APP_ID'],
  }[feature] || [];
  return req.filter((k) => !process.env[k]);
}
