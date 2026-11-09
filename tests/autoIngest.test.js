import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureKnowledge } from '../src/rag/autoIngest.js';

/** Minimal fake of the supabase-js query builder calls ensureKnowledge makes. */
function fakeSupabase(rows = []) {
  const ops = [];
  const table = {
    select() { return this; },
    eq(_col, hash) { this._eq = hash; return this; },
    limit() { return Promise.resolve({ data: rows.filter((r) => r.metadata.kb_hash === this._eq).slice(0, 1), error: null }); },
    insert(newRows) { ops.push('insert'); rows.push(...newRows); return Promise.resolve({ error: null }); },
    delete() {
      return {
        or: (filter) => {
          ops.push('delete');
          const hash = filter.split('.neq.')[1];
          for (let i = rows.length - 1; i >= 0; i--) if (rows[i].metadata.kb_hash == null || rows[i].metadata.kb_hash !== hash) rows.splice(i, 1);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { rows, ops, from: () => Object.create(table) };
}
const quiet = { info() {}, warn() {} };

test('loads the knowledge files on first start, then does nothing until they change', async () => {
  const sb = fakeSupabase();
  let embedCalls = 0;
  const embedBatched = async (texts) => { embedCalls++; return texts.map(() => [0.1]); };

  const first = await ensureKnowledge({ supabase: sb, embedBatched, logger: quiet });
  assert.equal(first.status, 'loaded');
  assert.ok(first.chunks > 10);
  assert.deepEqual(sb.ops, ['insert', 'delete']);

  const second = await ensureKnowledge({ supabase: sb, embedBatched, logger: quiet });
  assert.equal(second.status, 'current');
  assert.equal(embedCalls, 1); // no second embedding cost
});

test('replaces old chunks when the files change', async () => {
  const sb = fakeSupabase([
    { source: 'old.md', content: 'x', metadata: { kb_hash: 'stale' } },
    { source: 'manual.md', content: 'y', metadata: {} }, // loaded by scripts/ingest.js, no hash
  ]);
  await ensureKnowledge({ supabase: sb, embedBatched: async (t) => t.map(() => [0]), logger: quiet });
  assert.ok(sb.rows.every((r) => r.metadata.kb_hash !== 'stale'));
  assert.ok(!sb.rows.some((r) => r.source === 'old.md' || r.source === 'manual.md'));
});
