import { monthKey, daysBetween, addDays, DAYS_PER_MONTH, monthRange, addMonths } from './dates.js';

const lower = (s) => String(s ?? '').toLowerCase();
const amt = (r) => r.amount || 0;

export const PAYCHECK_TAX_KEYS = ['federal_tax', 'state_tax', 'social_security', 'medicare', 'other_tax'];
export const PAYCHECK_RETIREMENT_KEYS = ['retirement_401k', 'roth_401k', 'hsa'];
export const PAYCHECK_BENEFIT_KEYS = ['medical', 'dental', 'vision', 'other_deductions'];

export function paycheckTotals(p) {
  const v = (k) => p[k] || 0;
  const gross = v('gross') + v('bonus');
  const taxes = PAYCHECK_TAX_KEYS.reduce((s, k) => s + v(k), 0);
  const retirement = PAYCHECK_RETIREMENT_KEYS.reduce((s, k) => s + v(k), 0);
  const benefits = PAYCHECK_BENEFIT_KEYS.reduce((s, k) => s + v(k), 0);
  const computedNet = gross - taxes - retirement - benefits;
  const net = p.net === null || p.net === undefined ? computedNet : p.net;
  return { gross, taxes, retirement, benefits, net, computedNet, difference: net - computedNet, match: v('employer_match') };
}

export function inRange(records, start, end) {
  return records.filter((r) => r.date && (!start || r.date >= start) && (!end || r.date <= end));
}

export function excludedCoreSet(categories) {
  return new Set(categories.expense.filter((c) => c.excludeFromCore).map((c) => lower(c.name)));
}

export function incomeCategorySet(categories) {
  return new Set(categories.activity.filter((c) => c.countsAsIncome).map((c) => lower(c.name)));
}

// Account activity that counts as income (e.g. "Other Income", "Interest").
export function otherIncome(activity, categories) {
  const set = incomeCategorySet(categories);
  return activity.filter((a) => set.has(lower(a.category)) && (a.amount || 0) > 0);
}

export function sumBy(records, keyFn, valueFn = amt) {
  const m = new Map();
  for (const r of records) {
    const k = keyFn(r);
    m.set(k, (m.get(k) || 0) + valueFn(r));
  }
  return m;
}

// Totals per month: income (take-home + other income), expenses, core expenses,
// pre-tax/retirement savings withheld from paychecks, and the savings rate.
//   saved       = income + retirement withholdings - expenses
//   savingsRate = saved / (income + retirement withholdings)
export function monthlyCashflow({ expenses, paychecks, activity, categories }, startKey, endKey) {
  const months = monthRange(startKey, endKey);
  const rows = new Map(
    months.map((k) => [k, { month: k, net: 0, gross: 0, retirement: 0, other: 0, expenses: 0, core: 0 }]),
  );
  const nonCore = excludedCoreSet(categories);
  for (const e of expenses) {
    const row = rows.get(monthKey(e.date || '')) ;
    if (!row) continue;
    row.expenses += amt(e);
    if (!nonCore.has(lower(e.category))) row.core += amt(e);
  }
  for (const p of paychecks) {
    const row = rows.get(monthKey(p.date || ''));
    if (!row) continue;
    const t = paycheckTotals(p);
    row.net += t.net;
    row.gross += t.gross;
    row.retirement += t.retirement;
  }
  for (const a of otherIncome(activity, categories)) {
    const row = rows.get(monthKey(a.date));
    if (row) row.other += a.amount;
  }
  return months.map((k) => {
    const r = rows.get(k);
    const income = r.net + r.other;
    const saved = income + r.retirement - r.expenses;
    const base = income + r.retirement;
    return { ...r, income, saved, savingsRate: base > 0 ? saved / base : null };
  });
}

// Totals and averages over [start, end]. The window starts no earlier than the
// first record, so a newly started ledger isn't averaged over empty months.
export function averages({ expenses, paychecks, activity, categories }, start, end, { exclude = [] } = {}) {
  const nonCore = excludedCoreSet(categories);
  const excluded = new Set(exclude.map(lower));
  const exp = inRange(expenses, start, end);
  const pays = inRange(paychecks, start, end);
  const other = inRange(otherIncome(activity, categories), start, end);

  const firstOf = (list) => list.reduce((m, r) => (!m || r.date < m ? r.date : m), null);
  const spanDays = (first) => {
    if (!first) return 0;
    const s = first > start ? first : start;
    return Math.max(1, daysBetween(s, end) + 1);
  };

  const total = exp.reduce((s, e) => s + amt(e), 0);
  const core = exp.filter((e) => !nonCore.has(lower(e.category))).reduce((s, e) => s + amt(e), 0);
  const custom = exp.filter((e) => !excluded.has(lower(e.category))).reduce((s, e) => s + amt(e), 0);
  const spendDays = spanDays(firstOf(expenses));

  let net = 0;
  let gross = 0;
  let retirement = 0;
  for (const p of pays) {
    const t = paycheckTotals(p);
    net += t.net;
    gross += t.gross;
    retirement += t.retirement;
  }
  const otherTotal = other.reduce((s, a) => s + a.amount, 0);
  const income = net + otherTotal;
  const incomeFirst = [firstOf(paychecks), firstOf(otherIncome(activity, categories))].filter(Boolean).sort()[0] || null;
  const incomeDays = spanDays(incomeFirst);

  const perMonth = (v, days) => (days ? v / (days / DAYS_PER_MONTH) : null);
  const perDay = (v, days) => (days ? v / days : null);
  const base = income + retirement;
  return {
    start,
    end,
    spendDays,
    incomeDays,
    spending: {
      total,
      core,
      custom,
      dailyAll: perDay(total, spendDays),
      dailyCore: perDay(core, spendDays),
      monthlyAll: perMonth(total, spendDays),
      monthlyCore: perMonth(core, spendDays),
      monthlyCustom: perMonth(custom, spendDays),
    },
    income: {
      total: income,
      net,
      gross: gross + otherTotal,
      other: otherTotal,
      retirement,
      daily: perDay(income, incomeDays),
      monthly: perMonth(income, incomeDays),
      monthlyGross: perMonth(gross + otherTotal, incomeDays),
    },
    savingsRate: base > 0 ? (base - total) / base : null,
  };
}

export function trailingYear(today) {
  return { start: addDays(addMonths(today, -12), 1), end: today };
}

// Expense totals grouped by period (month/year) and optionally broken down by a
// dimension. The breakdown keeps the top N names and folds the rest into "Other".
export function expenseBreakdown(expenses, { start, end, period = 'month', by = null, exclude = [], topN = 7 } = {}) {
  const excluded = new Set(exclude.map(lower));
  const list = inRange(expenses, start, end).filter((e) => !excluded.has(lower(e.category)));
  const periodOf = (e) => (period === 'year' ? e.date.slice(0, 4) : monthKey(e.date));
  const dim = (e) => (by ? e[by] || '(none)' : 'Total');

  const totalsByName = sumBy(list, dim);
  const ranked = [...totalsByName.entries()].sort((a, b) => b[1] - a[1]);
  const keep = ranked.slice(0, ranked.length > topN + 1 ? topN : ranked.length).map(([n]) => n);
  const keepSet = new Set(keep);
  const names = ranked.length > keep.length ? [...keep, 'Other'] : keep;

  let periods;
  if (period === 'year') {
    const ys = list.map((e) => Number(e.date.slice(0, 4)));
    const y0 = start ? Number(start.slice(0, 4)) : Math.min(...ys);
    const y1 = end ? Number(end.slice(0, 4)) : Math.max(...ys);
    periods = [];
    if (Number.isFinite(y0) && Number.isFinite(y1)) for (let y = y0; y <= y1; y++) periods.push(String(y));
  } else {
    const ms = list.map((e) => monthKey(e.date)).sort();
    periods = monthRange(start ? monthKey(start) : ms[0], end ? monthKey(end) : ms[ms.length - 1]);
  }
  const rows = new Map(periods.map((p) => [p, Object.fromEntries([['period', p], ['total', 0], ...names.map((n) => [n, 0])])]));
  for (const e of list) {
    const row = rows.get(periodOf(e));
    if (!row) continue;
    const n = keepSet.has(dim(e)) ? dim(e) : 'Other';
    row[n] += amt(e);
    row.total += amt(e);
  }
  return {
    names,
    rows: [...rows.values()],
    totals: ranked.map(([name, total]) => ({ name, total })),
    grandTotal: list.reduce((s, e) => s + amt(e), 0),
  };
}

// Salary in effect on `date`: the latest record per employer, summed. An entry with
// salary 0 ends that employer.
export function currentSalary(salary, date) {
  const latest = new Map();
  for (const s of salary) {
    if (!s.date || s.date > date) continue;
    const k = lower(s.employer);
    if (!latest.has(k) || latest.get(k).date <= s.date) latest.set(k, s);
  }
  const active = [...latest.values()].filter((s) => (s.salary || 0) > 0);
  return { total: active.reduce((sum, s) => sum + s.salary, 0), records: active };
}

// Salary history with raise % relative to the previous entry for the same employer.
export function salaryHistory(salary) {
  const sorted = [...salary].filter((s) => s.date).sort((a, b) => (a.date < b.date ? -1 : 1));
  const prevBy = new Map();
  return sorted.map((s) => {
    const k = lower(s.employer);
    const prev = prevBy.get(k);
    prevBy.set(k, s);
    const change = prev && prev.salary > 0 && s.salary > 0 ? s.salary / prev.salary - 1 : null;
    return { ...s, previous: prev?.salary ?? null, change };
  });
}

// Total salary at each change point (for a step chart), plus today.
export function salaryTimeline(salary, today) {
  const dates = [...new Set(salary.filter((s) => s.date).map((s) => s.date))].sort();
  const points = dates.map((d) => ({ date: d, total: currentSalary(salary, d).total }));
  if (points.length && points[points.length - 1].date < today) points.push({ date: today, total: currentSalary(salary, today).total });
  return points;
}

// Predict the next paycheck date from the gap between the last two.
export function nextPaycheckDate(paychecks, today) {
  const sorted = [...paychecks].filter((p) => p.date).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (sorted.length === 0) return today;
  const last = sorted[sorted.length - 1].date;
  if (sorted.length === 1) return addDays(last, 14);
  const gap = daysBetween(sorted[sorted.length - 2].date, last);
  if (gap >= 28 && gap <= 31) return addMonths(last, 1); // monthly
  return addDays(last, Math.max(1, gap)); // weekly / bi-weekly / other fixed gap
}
