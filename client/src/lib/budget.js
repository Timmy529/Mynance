import { daysBetween, daysInMonth, monthEnd, addDays, addMonths } from './dates.js';
import { inRange } from './spending.js';

const lower = (s) => String(s ?? '').toLowerCase();
const pad = (n) => String(n).padStart(2, '0');
const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// A budget line's amount in a given month (1-12). Lines with `months` are due only
// in those months (e.g. insurance in Mar & Sep); otherwise spread evenly.
export function itemMonthAmount(item, month) {
  if (item.months && item.months.length) {
    return item.months.includes(month) ? item.annual / item.months.length : 0;
  }
  return item.annual / 12;
}

export function budgetTotals(items) {
  const t = { fixed: 0, variable: 0, total: 0 };
  for (const it of items) {
    t[it.kind === 'fixed' ? 'fixed' : 'variable'] += it.annual;
    t.total += it.annual;
  }
  return t;
}

// Month-by-month expected spend split into fixed and variable.
export function budgetByMonth(items) {
  return ALL_MONTHS.map((m) => {
    const row = { month: m, fixed: 0, variable: 0, total: 0 };
    for (const it of items) {
      const a = itemMonthAmount(it, m);
      row[it.kind === 'fixed' ? 'fixed' : 'variable'] += a;
      row.total += a;
    }
    return row;
  });
}

function periodBounds(year, month) {
  if (month) {
    const key = `${year}-${pad(month)}`;
    return { start: `${key}-01`, end: monthEnd(key) };
  }
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function elapsedFraction(start, end, today) {
  if (today < start) return 0;
  if (today >= end) return 1;
  return (daysBetween(start, today) + 1) / (daysBetween(start, end) + 1);
}

// Budget vs actual per category for a month (month = 1-12) or the whole year (month = null).
// `expected` is how much of the budget should be used by today: variable lines
// accrue evenly; fixed lines count in full once their month starts.
export function budgetVsActual(items, expenses, { year, month = null, today }) {
  const { start, end } = periodBounds(year, month);
  const months = month ? [month] : ALL_MONTHS;
  const frac = elapsedFraction(start, end, today);
  const curMonth = today.slice(0, 4) === String(year) ? Number(today.slice(5, 7)) : today < start ? 0 : 13;

  const cats = new Map();
  const get = (name) => {
    const k = lower(name);
    if (!cats.has(k)) cats.set(k, { category: name, budget: 0, actual: 0, expected: 0, fixed: 0, variable: 0, subs: new Map() });
    return cats.get(k);
  };
  const getSub = (cat, name) => {
    const k = lower(name);
    if (!cat.subs.has(k)) cat.subs.set(k, { subcategory: name, budget: 0, actual: 0 });
    return cat.subs.get(k);
  };

  for (const it of items) {
    const cat = get(it.category);
    let b = 0;
    let expected = 0;
    for (const m of months) {
      const a = itemMonthAmount(it, m);
      b += a;
      if (it.kind === 'fixed') {
        if (month ? frac > 0 : m <= curMonth) expected += a;
      }
    }
    if (it.kind !== 'fixed') expected = b * frac;
    cat.budget += b;
    cat.expected += expected;
    cat[it.kind === 'fixed' ? 'fixed' : 'variable'] += b;
    if (it.subcategory) getSub(cat, it.subcategory).budget += b;
  }

  for (const e of inRange(expenses, start, end)) {
    const cat = get(e.category);
    cat.actual += e.amount || 0;
    if (e.subcategory) getSub(cat, e.subcategory).actual += e.amount || 0;
  }

  const rows = [...cats.values()]
    .map((c) => ({
      ...c,
      subs: [...c.subs.values()].sort((a, b) => b.budget - a.budget || b.actual - a.actual),
      remaining: c.budget - c.actual,
      used: c.budget > 0 ? c.actual / c.budget : null,
    }))
    .sort((a, b) => b.budget - a.budget || b.actual - a.actual);

  const totals = rows.reduce(
    (t, r) => ({ budget: t.budget + r.budget, actual: t.actual + r.actual, expected: t.expected + r.expected }),
    { budget: 0, actual: 0, expected: 0 },
  );
  totals.remaining = totals.budget - totals.actual;
  totals.used = totals.budget > 0 ? totals.actual / totals.budget : null;
  return { start, end, elapsed: frac, rows, totals };
}

// Burn-down: remaining budget over the period vs the planned remaining.
// Daily points for a month, monthly points for a year. `category` narrows it to one category.
export function burnDown(items, expenses, { year, month = null, today, category = null }) {
  const its = category ? items.filter((i) => lower(i.category) === lower(category)) : items;
  const exps = category ? expenses.filter((e) => lower(e.category) === lower(category)) : expenses;
  const { start, end } = periodBounds(year, month);
  const period = inRange(exps, start, end);
  const points = [];
  if (month) {
    const dim = daysInMonth(year, month);
    const fixed = its.filter((i) => i.kind === 'fixed').reduce((s, i) => s + itemMonthAmount(i, month), 0);
    const variable = its.filter((i) => i.kind !== 'fixed').reduce((s, i) => s + itemMonthAmount(i, month), 0);
    const budget = fixed + variable;
    const byDay = new Array(dim + 1).fill(0);
    for (const e of period) byDay[Number(e.date.slice(8, 10))] += e.amount || 0;
    let cum = 0;
    points.push({ label: '0', key: start, planned: budget, remaining: budget });
    for (let d = 1; d <= dim; d++) {
      cum += byDay[d];
      const date = `${year}-${pad(month)}-${pad(d)}`;
      points.push({
        label: String(d),
        key: date,
        planned: budget - (fixed + (variable * d) / dim),
        remaining: date <= today ? budget - cum : null,
      });
    }
    return { budget, points };
  }
  const monthly = budgetByMonth(its);
  const budget = monthly.reduce((s, m) => s + m.total, 0);
  const byMonth = new Array(13).fill(0);
  for (const e of period) byMonth[Number(e.date.slice(5, 7))] += e.amount || 0;
  let cumPlan = 0;
  let cum = 0;
  points.push({ label: 'Start', key: `${year}-00`, planned: budget, remaining: budget });
  for (let m = 1; m <= 12; m++) {
    cumPlan += monthly[m - 1].total;
    cum += byMonth[m];
    const key = `${year}-${pad(m)}`;
    points.push({
      label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1],
      key,
      planned: budget - cumPlan,
      remaining: `${key}-01` <= today ? budget - cum : null,
    });
  }
  return { budget, points };
}

// Project next year's spend per category from one year of history, adjusted by a
// percentage (global, with optional per-category overrides). History shorter than a
// year is annualized.
export function projectSpending(expenses, { basis = 'trailing', today, year, adjustment = 0, categoryAdjustments = {} }) {
  let start;
  let end;
  if (basis === 'calendar') {
    start = `${year}-01-01`;
    end = `${year}-12-31`;
  } else {
    end = today;
    start = addDays(addMonths(today, -12), 1);
  }
  const list = inRange(expenses, start, end);
  const first = expenses.reduce((m, e) => (e.date && (!m || e.date < m) ? e.date : m), null);
  const windowDays = daysBetween(start, end) + 1;
  const coveredFrom = first && first > start ? first : start;
  const lastDate = end < today ? end : today;
  const coveredDays = first ? Math.max(1, daysBetween(coveredFrom, lastDate) + 1) : 0;
  const factor = coveredDays && coveredDays < windowDays - 1 ? 365 / coveredDays : 1;

  const byCat = new Map();
  for (const e of list) {
    const k = lower(e.category);
    if (!byCat.has(k)) byCat.set(k, { category: e.category, actual: 0 });
    byCat.get(k).actual += e.amount || 0;
  }
  const adjFor = (cat) => {
    const hit = Object.entries(categoryAdjustments).find(([k]) => lower(k) === lower(cat));
    return hit && hit[1] !== null && hit[1] !== '' && Number.isFinite(Number(hit[1])) ? Number(hit[1]) : adjustment;
  };
  const rows = [...byCat.values()]
    .map((r) => {
      const basisAmount = r.actual * factor;
      const adj = adjFor(r.category);
      return { ...r, basis: basisAmount, adjustment: adj, overridden: adj !== adjustment, projected: basisAmount * (1 + adj / 100) };
    })
    .sort((a, b) => b.projected - a.projected);
  const totals = rows.reduce((t, r) => ({ actual: t.actual + r.actual, basis: t.basis + r.basis, projected: t.projected + r.projected }), {
    actual: 0,
    basis: 0,
    projected: 0,
  });
  return { start, end, factor, coveredDays, rows, totals };
}
