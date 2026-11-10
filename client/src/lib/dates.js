// Dates are plain 'YYYY-MM-DD' strings everywhere. Math is done in UTC so local
// timezone / DST never shifts a day. Month keys are 'YYYY-MM'.

const pad = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d || 1));
}

// Today in the browser's local timezone.
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const dim = daysInMonth(target.getUTCFullYear(), target.getUTCMonth() + 1);
  target.setUTCDate(Math.min(d, dim));
  return toISO(target);
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function daysBetween(a, b) {
  return Math.round((fromISO(b) - fromISO(a)) / 86400000);
}

export const monthKey = (iso) => iso.slice(0, 7);
export const yearOf = (iso) => Number(iso.slice(0, 4));
export const monthOf = (iso) => Number(iso.slice(5, 7));

export function monthStart(key) {
  return `${key}-01`;
}

export function monthEnd(key) {
  const [y, m] = key.split('-').map(Number);
  return `${key}-${pad(daysInMonth(y, m))}`;
}

export function addMonthKey(key, n) {
  return monthKey(addMonths(`${key}-01`, n));
}

// Inclusive list of month keys from a to b.
export function monthRange(a, b) {
  const out = [];
  if (!a || !b || a > b) return out;
  let k = a;
  while (k <= b) {
    out.push(k);
    k = addMonthKey(k, 1);
  }
  return out;
}

export function monthsBetweenKeys(a, b) {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = MONTHS;

export function monthLabel(key, { year = true } = {}) {
  const [y, m] = key.split('-').map(Number);
  return year ? `${MONTHS[m - 1]} ’${String(y).slice(2)}` : MONTHS[m - 1];
}

export function monthLabelLong(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function formatDate(iso, { year = true } = {}) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return year ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${d}`;
}

export function yearStart(y) {
  return `${y}-01-01`;
}

export function yearEnd(y) {
  return `${y}-12-31`;
}

// Fraction of a year elapsed through `iso` (inclusive of that day).
export function yearFraction(iso) {
  const y = yearOf(iso);
  const days = daysBetween(yearStart(y), yearEnd(y)) + 1;
  return (daysBetween(yearStart(y), iso) + 1) / days;
}

export const DAYS_PER_MONTH = 365.25 / 12;
