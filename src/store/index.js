import crypto from 'node:crypto';
import { config } from '../config.js';
import { createMemoryStore } from './memoryStore.js';
import { createSupabaseStore } from './supabaseStore.js';

let store;

/** Supabase when configured, otherwise in-memory (with a warning: data is lost on restart). */
export function getStore() {
  if (!store) {
    if (config.supabase.url && config.supabase.serviceRoleKey) {
      store = createSupabaseStore();
    } else {
      console.warn('[store] Supabase not configured: using in-memory store (sessions/leads/logs lost on restart)');
      store = createMemoryStore();
    }
  }
  return store;
}

/**
 * Stable, non-reversible key for a user (e.g. a Messenger user ID), so logs and sessions
 * don't store raw platform IDs. Leads store contact details only after consent (CB-09).
 */
export function userKeyFor(channel, id, salt = config.dataHashSalt) {
  return `${channel}:` + crypto.createHash('sha256').update(`${salt}:${id}`).digest('hex').slice(0, 32);
}
