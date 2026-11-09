/**
 * CB-18: offensive language detection (English + Filipino). Kept short on purpose;
 * extend from real logs, not guesses. Matching is on normalized text (lowercase, no accents).
 */
const OFFENSIVE = [
  /\bf+u+c+k+(ing|er|ed)?\b/,
  /\bsh+i+t+\b/,
  /\bb+i+t+c+h+\b/,
  /\ba+s+s+h+o+l+e+\b/,
  /\bstupid bot\b/,
  /\bput(ang)? ?ina\b/,
  /\btang ?ina\b/,
  /\bgago\b/,
  /\bbobo\b/,
  /\btanga\b/,
  /\bulol\b/,
  /\bpakyu\b/,
];

export function isOffensive(normalizedText) {
  return OFFENSIVE.some((re) => re.test(normalizedText));
}

export const ABUSE_LIMIT = 3; // after this many offensive messages, the chat is ended (CB-18)
export const ABUSE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
