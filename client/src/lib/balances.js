import { accountTypeInfo, isInvestmentType } from '@shared/accountTypes.js';
import { monthRange, monthEnd, addMonthKey, monthKey } from './dates.js';

const lower = (s) => String(s ?? '').toLowerCase();

// Map of account (lower-cased name) -> date-sorted [{ date, balance, contributed }].
// `contributed` is carried forward from the last row that had one.
export function buildBalanceIndex(balances) {
  const idx = new Map();
  for (const b of balances) {
    if (!b.date || b.balance === null || b.balance === undefined) continue;
    const k = lower(b.account);
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push({ date: b.date, balance: b.balance, contributed: b.contributed ?? null });
  }
  for (const list of idx.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let lastContrib = null;
    for (const e of list) {
      if (e.contributed !== null) lastContrib = e.contributed;
      else e.contributed = lastContrib;
    }
  }
  return idx;
}

// Latest entry on or before `date` (binary search), or null.
export function valueAsOf(index, account, date) {
  const list = index.get(lower(account));
  if (!list || !list.length || list[0].date > date) return null;
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid].date <= date) lo = mid;
    else hi = mid - 1;
  }
  return list[lo];
}

export function firstBalanceDate(balances) {
  let min = null;
  for (const b of balances) if (b.date && (!min || b.date < min)) min = b.date;
  return min;
}

export function emptyTotals() {
  return { cash: 0, brokerage: 0, retirement: 0, home: 0, asset: 0, credit: 0, mortgage: 0, loan: 0, contributed: 0 };
}

export function deriveTotals(t) {
  const investments = t.brokerage + t.retirement;
  const assets = t.cash + investments + t.home + t.asset;
  const liabilities = t.credit + t.mortgage + t.loan;
  return {
    ...t,
    investments,
    homeEquity: t.home - t.mortgage,
    assets,
    liabilities,
    netWorth: assets - liabilities,
  };
}

// Value of every account as of `date`. Liabilities are stored as amounts owed and
// counted as positive numbers in their group (subtracted in netWorth).
export function snapshot(accounts, index, date) {
  const t = emptyTotals();
  const rows = [];
  for (const acc of accounts) {
    const info = accountTypeInfo(acc.type);
    const v = valueAsOf(index, acc.name, date);
    if (!v) {
      rows.push({ account: acc, info, value: null, contributed: null, asOf: null });
      continue;
    }
    const value = info.liability ? Math.abs(v.balance) : v.balance;
    t[info.group] += value;
    if (info.investment) t.contributed += v.contributed ?? 0;
    rows.push({ account: acc, info, value, contributed: info.investment ? v.contributed : null, asOf: v.date });
  }
  return { date, rows, totals: deriveTotals(t) };
}

// One snapshot per month end from startKey..endKey (the current month uses `today`).
export function monthlySnapshots(accounts, index, startKey, endKey, today) {
  return monthRange(startKey, endKey).map((k) => {
    const end = monthEnd(k);
    const date = today && end > today ? today : end;
    return { month: k, date, ...snapshot(accounts, index, date).totals };
  });
}

// Activity categories that are investment returns, not money moved in or out.
const INTERNAL_FLOW = /^(interest|dividends?|fees?|capital gains?|reinvest(ed|ment)?)$/i;

// Monthly investment performance for a set of investment accounts. Flows come from
// the change in recorded "contributed" totals; when an account has no contributed
// data, account activity (deposits / withdrawals) is used instead.
// Return uses the Modified Dietz approximation: gain / (start + flows / 2).
export function monthlyInvestmentReturns(accounts, index, activity, startKey, endKey, today) {
  const inv = accounts.filter((a) => isInvestmentType(a.type));
  const activityByAccount = new Map();
  for (const a of activity) {
    if (INTERNAL_FLOW.test(a.category || '')) continue;
    const k = lower(a.account);
    if (!activityByAccount.has(k)) activityByAccount.set(k, []);
    activityByAccount.get(k).push(a);
  }
  const out = [];
  for (const k of monthRange(startKey, endKey)) {
    const s = monthEnd(addMonthKey(k, -1));
    let e = monthEnd(k);
    if (today && e > today) e = today;
    let start = 0;
    let end = 0;
    let flows = 0;
    let n = 0;
    for (const acc of inv) {
      const a0 = valueAsOf(index, acc.name, s);
      const a1 = valueAsOf(index, acc.name, e);
      if (!a0 || !a1) continue; // account wasn't tracked at the start of the month
      n++;
      start += a0.balance;
      end += a1.balance;
      if (a0.contributed !== null && a1.contributed !== null) {
        flows += a1.contributed - a0.contributed;
      } else {
        for (const act of activityByAccount.get(lower(acc.name)) || []) {
          if (act.date > s && act.date <= e) flows += act.amount || 0;
        }
      }
    }
    if (n === 0) continue;
    const gain = end - start - flows;
    const denom = start + flows / 2;
    out.push({ month: k, start, end, flows, gain, return: denom > 0 ? gain / denom : null });
  }
  return out;
}

// Chain monthly returns into an annualized (time-weighted) rate.
export function annualizeReturns(monthly) {
  const valid = monthly.filter((m) => m.return !== null && Number.isFinite(m.return));
  if (!valid.length) return null;
  const growth = valid.reduce((g, m) => g * (1 + m.return), 1);
  if (growth <= 0) return -1;
  return growth ** (12 / valid.length) - 1;
}

export function cumulativeReturn(monthly) {
  const valid = monthly.filter((m) => m.return !== null && Number.isFinite(m.return));
  if (!valid.length) return null;
  return valid.reduce((g, m) => g * (1 + m.return), 1) - 1;
}

// Average monthly change in a total over the trailing `months` (positive = growing).
export function averageMonthlyChange(series, field, months = 12) {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  const firstIdx = Math.max(0, series.length - 1 - months);
  const first = series[firstIdx];
  const span = series.length - 1 - firstIdx;
  if (span <= 0) return null;
  return (last[field] - first[field]) / span;
}

export function balanceHistoryStart(balances, today) {
  const first = firstBalanceDate(balances);
  return first ? monthKey(first) : monthKey(today);
}
