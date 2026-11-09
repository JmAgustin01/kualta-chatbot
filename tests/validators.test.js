import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidEmail, normalizePhone, detectProhibited, redact } from '../src/business/validators.js';
import { isOpen } from '../src/business/hours.js';
import { br, OPEN, CLOSED } from './helpers.js';

test('email format check (CB-08)', () => {
  for (const ok of ['a@b.co', 'juan.dela-cruz@gmail.com']) assert.ok(isValidEmail(ok), ok);
  for (const bad of ['juan', 'juan@', '@x.com', 'juan@gmail', 'a b@c.com']) assert.ok(!isValidEmail(bad), bad);
});

test('phone format check normalizes PH numbers (CB-08)', () => {
  assert.equal(normalizePhone('0917 123 4567'), '+639171234567');
  assert.equal(normalizePhone('+63 917-123-4567'), '+639171234567');
  assert.equal(normalizePhone('639171234567'), '+639171234567');
  assert.equal(normalizePhone('+14155550123'), '+14155550123');
  for (const bad of ['12345', '0817 123 4567', 'abc', '091712345']) assert.equal(normalizePhone(bad), null, bad);
});

test('prohibited data detection (CB-17)', () => {
  assert.ok(detectProhibited('my card is 4111 1111 1111 1111').found);
  assert.ok(detectProhibited('password: hunter2').found);
  assert.ok(detectProhibited("here's my login and password").found);
  assert.ok(detectProhibited('bank account number 001234567890').found);
  assert.ok(!detectProhibited('call me at 0917 123 4567').found);
  assert.ok(!detectProhibited('I forgot my password to my website, can you help?').found);
  assert.ok(!detectProhibited('1234 5678 9012 3456').found); // fails Luhn
});

test('redact removes numbers and password values before logging', () => {
  assert.equal(redact('password: hunter2'), 'password: [REDACTED]');
  assert.match(redact('card 4111 1111 1111 1111'), /\[REDACTED_NUMBER\]/);
});

test('business hours: Mon-Fri 9-6 Manila; holidays closed', () => {
  assert.equal(isOpen(br.hours, OPEN), true);
  assert.equal(isOpen(br.hours, CLOSED), false);
  assert.equal(isOpen(br.hours, new Date('2026-11-08T03:00:00Z')), false); // Sunday
  assert.equal(isOpen({ ...br.hours, holidays: ['2026-11-09'] }, OPEN), false);
  assert.equal(isOpen({ ...br.hours, days: [] }, OPEN), null);
});
