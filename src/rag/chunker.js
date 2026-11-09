/**
 * Split a markdown/plain-text page into retrieval chunks.
 * Strategy: split on headings and blank lines, then pack paragraphs into chunks
 * of ~maxChars with a small overlap so a sentence cut at a boundary still matches.
 * Each chunk keeps its nearest heading as context ("Services > Web Design: ...").
 */
export function chunkText(text, { maxChars = 900, overlapChars = 120 } = {}) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const blocks = []; // { heading, body }
  let heading = '';
  let buf = [];

  const flush = () => {
    const body = buf.join('\n').trim();
    if (body) blocks.push({ heading, body });
    buf = [];
  };

  for (const line of lines) {
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      flush();
      heading = h[1].trim();
    } else if (!line.trim()) {
      flush();
    } else {
      buf.push(line);
    }
  }
  flush();

  const chunks = [];
  let current = '';
  let currentHeading = '';

  const push = () => {
    const c = current.trim();
    if (c) chunks.push(currentHeading ? `${currentHeading}\n${c}` : c);
  };

  for (const { heading: hd, body } of blocks) {
    // A new heading starts a new chunk so topics don't bleed together
    if (hd !== currentHeading && current) {
      push();
      current = '';
    }
    currentHeading = hd;

    for (const piece of splitLong(body, maxChars)) {
      if ((current + '\n\n' + piece).length > maxChars && current) {
        push();
        current = current.slice(-overlapChars) + '\n\n' + piece;
      } else {
        current = current ? `${current}\n\n${piece}` : piece;
      }
    }
  }
  push();
  return chunks;
}

/** Break a single over-long paragraph on sentence boundaries. */
function splitLong(paragraph, maxChars) {
  if (paragraph.length <= maxChars) return [paragraph];
  const sentences = paragraph.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [paragraph];
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > maxChars && cur) {
      out.push(cur.trim());
      cur = s;
    } else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
