/**
 * Step 0 of the RAG flow: load the client's content into Supabase pgvector.
 *
 *   npm run ingest              -> ingest everything in /knowledge
 *   npm run ingest -- --dry-run -> show chunks, no API calls, no DB writes
 *
 * Re-running is safe: each source file's old chunks are replaced.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingFor } from '../src/config.js';
import { loadKnowledge } from '../src/rag/knowledge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.resolve(here, '..', 'knowledge');
const dryRun = process.argv.includes('--dry-run');

const docs = await loadKnowledge(KNOWLEDGE_DIR, fs);
if (!docs.length) {
  console.error('No knowledge files found. Add .md pages or .qa.json files to /knowledge (see knowledge/README.md).');
  process.exit(1);
}

const bySource = new Map();
for (const d of docs) {
  if (!bySource.has(d.source)) bySource.set(d.source, []);
  bySource.get(d.source).push(d);
}
console.log(`Found ${docs.length} chunks across ${bySource.size} files.`);

if (dryRun) {
  for (const [source, chunks] of bySource) {
    console.log(`\n=== ${source} (${chunks.length} chunks)`);
    chunks.forEach((c, i) => console.log(`--- [${i + 1}] ${c.title}\n${c.content.slice(0, 300)}${c.content.length > 300 ? '…' : ''}`));
  }
  process.exit(0);
}

const missing = missingFor('ingest');
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const { embedBatched } = await import('../src/rag/embeddings.js');
const { replaceSource } = await import('../src/rag/vectorStore.js');

let total = 0;
for (const [source, chunks] of bySource) {
  const vectors = await embedBatched(chunks.map((c) => c.content));
  const rows = chunks.map((c, i) => ({
    source: c.source,
    title: c.title,
    content: c.content,
    embedding: vectors[i],
    metadata: c.metadata,
  }));
  total += await replaceSource(source, rows);
  console.log(`✓ ${source}: ${rows.length} chunks`);
}
console.log(`Done. ${total} chunks stored.`);
