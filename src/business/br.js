import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(here, '..', '..', 'config', 'business-rules.json');

/** A value counts as configured only if it is non-empty and not a placeholder. */
export function isSet(v) {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim() !== '' && !/^\s*(todo|tbd|placeholder)\b/i.test(v);
  return true;
}

export function loadBusinessRules(file = process.env.BUSINESS_RULES_PATH || DEFAULT_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return normalizeBR(raw);
}

/** Flatten the JSON into the shape the code uses. Unset values become null / []. */
export function normalizeBR(raw = {}) {
  const s = (v) => (isSet(v) ? String(v).trim() : null);
  const hours = raw.hours_BR02 ?? {};
  return {
    services: Array.isArray(raw.services_BR03) ? raw.services_BR03.filter(isSet) : [],
    consultationOffer: s(raw.consultation_BR04?.offer),
    priceList: (raw.pricing_BR05?.priceList ?? [])
      .filter((p) => isSet(p?.service) && isSet(p?.startingAt))
      .map((p) => ({ service: p.service, startingAt: p.startingAt, keywords: (p.keywords ?? []).map((k) => k.toLowerCase()) })),
    quotationNote: s(raw.pricing_BR05?.quotationNote),
    discountReply: s(raw.discounts_BR07?.reply),
    policies: {
      payment: s(raw.policies_BR09_BR19?.payment),
      revision: s(raw.policies_BR09_BR19?.revision),
      cancellation: s(raw.policies_BR09_BR19?.cancellation),
      ownership: s(raw.policies_BR09_BR19?.ownership),
    },
    resultsReply: s(raw.results_BR16?.reply),
    hours: {
      timezone: s(hours.timezone) ?? 'Asia/Manila',
      days: Array.isArray(hours.days) ? hours.days.map(Number).filter((d) => d >= 1 && d <= 7) : [],
      open: s(hours.open),
      close: s(hours.close),
      holidays: Array.isArray(hours.holidays) ? hours.holidays.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [],
      label: s(hours.label),
      afterHoursReply: s(hours.afterHoursReply),
    },
    privacyNotice: s(raw.privacy_BR20?.notice),
    privacyNoticeUrl: s(raw.privacy_BR20?.noticeUrl),
    prohibitedReply: s(raw.prohibited_BR21?.reply),
    complaintReply: s(raw.complaints_BR22?.reply),
    bookingUrl: s(raw.booking?.url),
  };
}
