// Composes the low-level calculations into the numbers the pages show.
import { buildBalanceIndex, snapshot, monthlySnapshots, monthlyInvestmentReturns, balanceHistoryStart, averageMonthlyChange } from './balances.js';
import { averages, trailingYear, currentSalary, monthlyCashflow } from './spending.js';
import { projectNetWorth } from './projections.js';
import { monthKey, addMonthKey, monthOf, DAYS_PER_MONTH, addMonths, addDays } from './dates.js';

// Records plus the category config that income/spending calculations need.
const ledgers = new WeakMap();
export function ledger(data) {
  if (!ledgers.has(data)) ledgers.set(data, { ...data.records, categories: data.config.categories });
  return ledgers.get(data);
}

export function computeCore(data, today) {
  const { config, records } = data;
  const accounts = config.accounts;
  const index = buildBalanceIndex(records.balances);
  const current = snapshot(accounts, index, today);
  const startKey = balanceHistoryStart(records.balances, today);
  const endKey = monthKey(today);
  const series = monthlySnapshots(accounts, index, startKey, endKey, today);
  const returns = monthlyInvestmentReturns(accounts, index, records.activity, addMonthKey(startKey, 1), endKey, today);
  return { index, current, series, returns, startKey, endKey };
}

export function windowFor(months, today) {
  if (months === 'ytd') return { start: `${today.slice(0, 4)}-01-01`, end: today };
  if (months === 'all') return { start: '0000-01-01', end: today };
  return { start: addDays(addMonths(today, -Number(months || 12)), 1), end: today };
}

// Inputs for projections: settings override, otherwise estimated from history.
export function projectionInputs(data, core, today) {
  const p = data.config.settings.projection;
  const last12 = core.returns.slice(-12);
  const flowAvg = last12.length ? last12.reduce((s, r) => s + r.flows, 0) / last12.length : null;

  const { start, end } = trailingYear(today);
  const avg = averages(ledger(data), start, end);
  const months = avg.incomeDays ? avg.incomeDays / DAYS_PER_MONTH : 0;
  const savedMonthly = months && avg.spendDays ? (avg.income.total + avg.income.retirement) / months - avg.spending.monthlyAll : null;

  const autoInvestment = flowAvg !== null && flowAvg > 0 ? flowAvg : savedMonthly !== null ? Math.max(0, savedMonthly) : 0;
  const autoSource = flowAvg !== null && flowAvg > 0 ? 'contributions' : savedMonthly !== null ? 'savings' : 'none';
  const mortgagePaydown = Math.max(0, -(averageMonthlyChange(core.series, 'mortgage', 12) ?? 0));

  return {
    expectedReturn: p.expectedReturn,
    homeAppreciation: p.homeAppreciation,
    cashReturn: p.cashReturn,
    inflation: p.inflation,
    years: p.years,
    monthlyInvestment: p.monthlyInvestment ?? autoInvestment,
    monthlyCash: p.monthlyCash ?? 0,
    autoInvestment,
    autoSource,
    mortgagePaydown,
  };
}

export function netWorthProjection(core, inputs, months) {
  return projectNetWorth(core.current.totals, { ...inputs, startMonth: core.endKey, months });
}

export function endOfYearNetWorth(core, inputs, today) {
  const remaining = 12 - monthOf(today);
  if (remaining <= 0) return core.current.totals.netWorth;
  const proj = netWorthProjection(core, inputs, remaining);
  return proj[proj.length - 1].netWorth;
}

export function salaryNow(data, today) {
  const s = currentSalary(data.records.salary, today);
  if (s.total > 0) return { amount: s.total, source: 'salary' };
  // Fall back to the last 12 months of paycheck gross pay.
  const { start, end } = trailingYear(today);
  const avg = averages(ledger(data), start, end);
  if (avg.income.monthlyGross) return { amount: avg.income.monthlyGross * 12, source: 'paychecks' };
  return { amount: 0, source: 'none' };
}

export function cashflowSeries(data, months, today) {
  const end = monthKey(today);
  return monthlyCashflow(ledger(data), addMonthKey(end, -(months - 1)), end);
}
