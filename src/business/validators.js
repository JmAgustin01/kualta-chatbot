/** Format checks for lead capture (CB-08) and detection of prohibited data (CB-17). */

export function isValidEmail(s) {
  const v = String(s ?? '').trim();
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v);
}

/**
 * Normalize a phone number. Accepts PH mobile (09xxxxxxxxx, +639xxxxxxxxx, 639xxxxxxxxx)
 * or any international E.164 number (+ and 8-15 digits).
 * @returns {string|null} E.164 form, or null if invalid
 */
export function normalizePhone(s) {
  const raw = String(s ?? '').trim();
  const digits = raw.replace(/[\s\-().]/g, '');
  if (/^09\d{9}$/.test(digits)) return '+63' + digits.slice(1);
  if (/^639\d{9}$/.test(digits)) return '+' + digits;
  if (/^\+639\d{9}$/.test(digits)) return digits;
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  return null;
}

function luhn(num) {
  let sum = 0;
  let dbl = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = Number(num[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const SECRET_WORDS = [
  /\b(my )?(password|passcode|pin|otp|one[- ]time (password|pin))\b\s*(is|:|=)/i,
  /\b(login|log-?in|username)\s*(and|&)\s*password\b/i,
  /\b(bank|savings|checking) (account|acct)( number| no\.?| #)?\s*(is|:)?\s*\d{6,}/i,
  /\b(cvv|cvc|card number|credit card|debit card)\b/i,
  /\b(account|acct) (number|no\.?|#)\s*(is|:)?\s*\d{6,}/i,
];

/**
 * CB-17: does the message contain card numbers, passwords, logins or bank details?
 * @returns {{ found: boolean, kinds: string[] }}
 */
export function detectProhibited(text) {
  const t = String(text ?? '');
  const kinds = [];
  for (const m of t.matchAll(/(?:\d[ -]?){13,19}/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) {
      kinds.push('card_number');
      break;
    }
  }
  if (SECRET_WORDS.some((re) => re.test(t))) kinds.push('credential_or_bank');
  return { found: kinds.length > 0, kinds };
}

/** Strip anything that looks like a card/account number or a password value before logging. */
export function redact(text) {
  return String(text ?? '')
    .replace(/(?:\d[ -]?){13,19}/g, '[REDACTED_NUMBER]')
    .replace(/((password|passcode|pin|otp)\s*(is|:|=)\s*)\S+/gi, '$1[REDACTED]')
    .replace(/((account|acct) (number|no\.?|#)\s*(is|:)?\s*)\d{6,}/gi, '$1[REDACTED]');
}
