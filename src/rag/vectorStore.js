import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

let client;

export function getSupabase() {
  if (!client) {
    if (!config.supabase.url || !config.supabase.serviceRoleKey) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
    }
    client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return client;
}

/**
 * Find the closest chunks to a query embedding.
 * Calls the `match_documents` SQL function in supabase/schema.sql.
 * @returns {Promise<Array<{id:string, source:string, title:string, content:string, similarity:number}>>}
 */
export async function searchSimilar(embedding, { topK = config.retrieval.topK, minSimilarity = 0, supabase = getSupabase() } = {}) {
  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: embedding,
    match_count: topK,
    min_similarity: minSimilarity,
  });
  if (error) throw new Error(`Vector search failed: ${error.message}`);
  return data ?? [];
}

/** Replace every chunk belonging to `source` with the new set (idempotent re-ingest). */
export async function replaceSource(source, rows, { supabase = getSupabase() } = {}) {
  const del = await supabase.from('documents').delete().eq('source', source);
  if (del.error) throw new Error(`Delete failed for ${source}: ${del.error.message}`);
  if (!rows.length) return 0;
  const ins = await supabase.from('documents').insert(rows);
  if (ins.error) throw new Error(`Insert failed for ${source}: ${ins.error.message}`);
  return rows.length;
}
