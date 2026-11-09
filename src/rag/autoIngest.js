import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKnowledge } from './knowledge.js';
import { embeddingModelId } from './embeddings.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const KNOWLEDGE_DIR = path.resolve(here, '..', '..', 'knowledge');

/** Fingerprint of everything that would be ingested (file names + chunk text). */
export function knowledgeHash(docs, model = embeddingModelId()) {
  const h = crypto.createHash('sha256');
  h.update(`${model}\u0000`); // a different embedding model means every vector must be redone
  for (const d of docs) h.update(`${d.source}\u0000${d.content}\u0000`);
  return h.digest('hex').slice(0, 16);
}

/**
 * Called at startup: if the /knowledge files changed since the last load (or the table is
 * empty), re-embed and replace them in Supabase. No API cost when nothing changed.
 * Sources that were deleted from /knowledge are removed from the table too.
 */
export async function ensureKnowledge({ supabase, embedBatched, dir = KNOWLEDGE_DIR, logger = console } = {}) {
  const docs = await loadKnowledge(dir, fs);
  if (!docs.length) {
    logger.warn('[kb] /knowledge is empty; nothing to load');
    return { status: 'empty' };
  }
  const hash = knowledgeHash(docs);

  const existing = await supabase.from('documents').select('id').eq('metadata->>kb_hash', hash).limit(1);
  if (existing.error) throw new Error(`KB check failed: ${existing.error.message}`);
  if (existing.data?.length) {
    logger.info(`[kb] knowledge base up to date (${hash})`);
    return { status: 'current', hash };
  }

  logger.info(`[kb] loading ${docs.length} chunks (${hash})...`);
  const vectors = await embedBatched(docs.map((d) => d.content));
  const rows = docs.map((d, i) => ({
    source: d.source,
    title: d.title,
    content: d.content,
    embedding: vectors[i],
    metadata: { ...d.metadata, kb_hash: hash },
  }));

  // Insert the new set first, then remove every older row, so the bot never sees an empty table.
  const ins = await supabase.from('documents').insert(rows);
  if (ins.error) throw new Error(`KB insert failed: ${ins.error.message}`);
  // "is null" too: rows from the manual ingest script have no kb_hash, and SQL's <> skips nulls
  const del = await supabase.from('documents').delete().or(`metadata->>kb_hash.is.null,metadata->>kb_hash.neq.${hash}`);
  if (del.error) throw new Error(`KB cleanup failed: ${del.error.message}`);

  logger.info(`[kb] loaded ${rows.length} chunks`);
  return { status: 'loaded', hash, chunks: rows.length };
}
