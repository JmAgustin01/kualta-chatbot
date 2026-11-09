/**
 * Business hours check (CB-10, CB-11).
 * @returns {boolean|null} true = open, false = closed, null = hours not configured (don't claim either way)
 */
export function isOpen(hours, now = new Date()) {
  if (!hours?.days?.length || !hours.open || !hours.close) return null;

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: hours.timezone || 'Asia/Manila',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const day = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.weekday];
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const toMin = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + (m || 0);
  };
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  if (hours.holidays?.includes(ymd)) return false;
  return hours.days.includes(day) && minutes >= toMin(hours.open) && minutes < toMin(hours.close);
}
