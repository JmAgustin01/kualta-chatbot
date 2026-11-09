import { loadBusinessRules } from '../src/business/br.js';
import { createMemoryStore } from '../src/store/memoryStore.js';
import { handleMessage } from '../src/chat.js';

export const br = loadBusinessRules();
export const business = { contactEmail: '', contactPhone: '', hours: '' };
// Mon 10:00 and Mon 22:00 Philippine time (UTC+8)
export const OPEN = new Date('2026-11-09T02:00:00Z');
export const CLOSED = new Date('2026-11-09T14:00:00Z');
export const ctx = (open = true) => ({ br, business, open, channelPhone: null });

/** A conversation with its own memory store. RAG is mocked unless overridden. */
export function conversation({ now = OPEN, rag = {}, userKey = 'fb:test-user', channelPhone = null } = {}) {
  const store = createMemoryStore();
  const quiet = { error() {} };
  const deps = {
    embed: async () => [[0.1]],
    search: async () => [],
    generate: async () => ({ text: 'NO_ANSWER' }),
    threshold: 0.35,
    logger: quiet,
    ...rag,
  };
  const say = (text) => handleMessage(text, { store, br, business, now, userKey, channel: 'messenger', channelPhone, ...deps });
  return { store, say };
}
