let currency = 'USD';
let locale = 'en-US';
const cache = new Map();

export function setLocale(next = {}) {
  currency = next.currency || 'USD';
  locale = next.locale || 'en-US';
  cache.clear();
}

function fmt(key, opts) {
  const k = `${key}|${currency}|${locale}`;
  if (!cache.has(k)) {
    try {
      cache.set(k, new Intl.NumberFormat(locale, opts()));
    } catch {
      cache.set(k, new Intl.NumberFormat('en-US', opts()));
    }
  }
  return cache.get(k);
}

const fix = (n) => (Object.is(n, -0) || Math.abs(n) < 0.005 ? 0 : n);

// $1,234.56
export function money(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return fmt('money', () => ({ style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })).format(fix(n));
}

// $1,235 (nearest dollar)
export function dollars(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return fmt('dollars', () => ({ style: 'currency', currency, maximumFractionDigits: 0, minimumFractionDigits: 0 })).format(
    fix(Math.round(n)),
  );
}

// $1.2K / $3.4M
export function compactMoney(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (Math.abs(n) < 10000) return dollars(n);
  return fmt('compact', () => ({ style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 })).format(n);
}

export function pct(x, digits = 1) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

export function signedPct(x, digits = 1) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  const s = (x * 100).toFixed(digits);
  return x > 0 ? `+${s}%` : `${s}%`;
}

export function signedDollars(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n > 0 ? `+${dollars(n)}` : dollars(n);
}

export function num(n, digits = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

// Axis ticks: full under 10K, compact above.
export function axisMoney(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return `${n < 0 ? '-' : ''}$${+(a / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${n < 0 ? '-' : ''}$${+(a / 1e3).toFixed(0)}K`;
  if (a >= 1e3) return `${n < 0 ? '-' : ''}$${(a / 1e3).toFixed(1)}K`;
  return `${n < 0 ? '-' : ''}$${Math.round(a)}`;
}
