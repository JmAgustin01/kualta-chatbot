import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chunkText } from '../src/rag/chunker.js';
import { loadKnowledge } from '../src/rag/knowledge.js';

test('chunker splits on headings and keeps heading as context', () => {
  const chunks = chunkText('# Services\n\n## Web Design\nWe design sites.\n\n## SEO\nWe do SEO.');
  assert.equal(chunks.length, 2);
  assert.match(chunks[0], /^Web Design\nWe design sites/);
  assert.match(chunks[1], /^SEO\nWe do SEO/);
});

test('chunker keeps chunks near the size limit', () => {
  const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} about the agency.`).join(' ');
  const chunks = chunkText(long, { maxChars: 400, overlapChars: 50 });
  assert.ok(chunks.length > 3);
  for (const c of chunks) assert.ok(c.length <= 400 + 50 + 10, `chunk too long: ${c.length}`);
});

test('loadKnowledge reads pages + Q&A and skips examples/README', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-'));
  await fs.writeFile(path.join(dir, 'services.md'), '# Services\n\nWe build websites for small businesses across the Philippines, with mobile-ready pages.');
  await fs.writeFile(path.join(dir, 'privacy.qa.json'), JSON.stringify([{ question: 'Do you sell data?', answer: 'No.' }]));
  await fs.writeFile(path.join(dir, '_example.qa.json'), '[]');
  await fs.writeFile(path.join(dir, 'README.md'), '# ignore me');

  const docs = await loadKnowledge(dir, fs);
  assert.equal(docs.length, 2);
  const qa = docs.find((d) => d.source === 'privacy.qa.json');
  assert.equal(qa.content, 'Q: Do you sell data?\nA: No.');
  assert.equal(docs.find((d) => d.source === 'services.md').title, 'Services');
});

test('loadKnowledge rejects malformed Q&A with a clear error', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-'));
  await fs.writeFile(path.join(dir, 'bad.qa.json'), JSON.stringify([{ question: 'missing answer' }]));
  await assert.rejects(loadKnowledge(dir, fs), /needs "question" and "answer"/);
});
