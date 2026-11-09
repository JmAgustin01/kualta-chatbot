import path from 'node:path';
import { chunkText } from './chunker.js';

/**
 * Read /knowledge into chunk objects.
 *   *.md / *.txt   -> a web page; first "# Heading" is the title; split by chunkText()
 *   *.qa.json      -> [{ "question": "...", "answer": "..." }]; each pair is ONE chunk
 *                     (Q&A pairs match sharper than long pages because we control the wording)
 * Files starting with "_" (examples/drafts) and README.md are skipped.
 */
export async function loadKnowledge(dir, fs) {
  let names;
  try {
    names = (await fs.readdir(dir)).sort();
  } catch {
    return [];
  }
  const out = [];

  for (const name of names) {
    if (name.startsWith('_') || name.toLowerCase() === 'readme.md') continue;
    const full = path.join(dir, name);

    if (name.endsWith('.qa.json')) {
      const pairs = JSON.parse(await fs.readFile(full, 'utf8'));
      if (!Array.isArray(pairs)) throw new Error(`${name} must be a JSON array of {question, answer}`);
      pairs.forEach((p, i) => {
        if (!p?.question || !p?.answer) throw new Error(`${name} item ${i + 1} needs "question" and "answer"`);
        out.push({
          source: name,
          title: p.question.trim(),
          content: `Q: ${p.question.trim()}\nA: ${p.answer.trim()}`,
          metadata: { type: 'qa', index: i },
        });
      });
    } else if (name.endsWith('.md') || name.endsWith('.txt')) {
      const text = await fs.readFile(full, 'utf8');
      const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.parse(name).name;
      chunkText(text)
        .filter((c) => c.length >= 40) // skip title-only / source-line fragments that match noisily
        .forEach((content, i) => out.push({ source: name, title, content, metadata: { type: 'page', index: i } }));
    }
  }
  return out;
}
