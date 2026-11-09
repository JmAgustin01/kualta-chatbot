/**
 * Run the 18-question test set and write a results table for the docs/deck.
 *
 *   npm run eval                               -> in-process (uses .env keys directly)
 *   npm run eval -- --url https://xxx.onrender.com   -> against the deployed /chat endpoint (needs CHAT_API_KEY)
 *
 * Output: eval-results.csv. The "auto_route_ok" column is checked automatically;
 * "manual_verdict" and "notes" are for the QA reviewer to fill in after reading each answer.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const set = JSON.parse(await fs.readFile(path.resolve(here, '..', 'tests', 'test-set.json'), 'utf8'));

const urlIdx = process.argv.indexOf('--url');
const baseUrl = urlIdx > -1 ? process.argv[urlIdx + 1] : null;

let ask;
if (baseUrl) {
  const key = process.env.CHAT_API_KEY;
  if (!key) throw new Error('CHAT_API_KEY must be set to call the deployed /chat endpoint');
  ask = async (q) => {
    const r = await fetch(`${baseUrl.replace(/\/$/, '')}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ message: q }), // no userKey → fresh conversation per question
    });
    if (!r.ok) throw new Error(`/chat ${r.status}`);
    return r.json();
  };
} else {
  const { handleMessage } = await import('../src/chat.js');
  let n = 0;
  ask = (q) => handleMessage(q, { userKey: `eval:${Date.now()}:${n++}`, channel: 'eval' }); // fresh conversation per question
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
const header = ['set', 'id', 'category', 'question', 'route', 'rule', 'handoff', 'top_similarity', 'ms', 'auto_route_ok', 'answer', 'pass_if', 'manual_verdict', 'notes'];
const rows = [header.join(',')];
const autoPass = { core: 0, br: 0 };
const totals = { core: 0, br: 0 };

for (const t of set) {
  const r = await ask(t.question);
  const routeOk =
    t.allowedRoutes.includes(r.route) &&
    (!t.expectRule || t.expectRule === r.ruleId) &&
    (t.expectHandoff === undefined || t.expectHandoff === r.handoff);
  const set = t.set ?? 'core';
  totals[set]++;
  if (routeOk) autoPass[set]++;
  console.log(`${routeOk ? '✓' : '✗'} ${t.id} [${r.route}${r.ruleId ? ':' + r.ruleId : ''}] ${t.question}\n    → ${r.text.slice(0, 160)}`);
  rows.push(
    [set, t.id, t.category, t.question, r.route, r.ruleId, r.handoff, r.topSimilarity?.toFixed?.(3) ?? '', r.ms, routeOk ? 'PASS' : 'FAIL', r.text, t.passIf, '', '']
      .map(csvCell)
      .join(','),
  );
}

const out = path.resolve(here, '..', 'eval-results.csv');
await fs.writeFile(out, rows.join('\n') + '\n');
console.log(`\nAuto route checks: core ${autoPass.core}/${totals.core}, business-rule cases ${autoPass.br}/${totals.br}. Results: ${out}`);
console.log('Next: QA reads every answer and fills manual_verdict (PASS/FAIL) + notes.');
