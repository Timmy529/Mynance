import { useMemo, useState } from 'react';
import { useData, usePref } from '../store.jsx';
import { Card, Stat, Tabs, Segmented, Select, Empty } from '../components/ui.jsx';
import { ChartCard, BarsChart, TimeChart, Donut, RankedBars, colorMap, NEUTRAL } from '../components/charts.jsx';
import { computeCore, ledger } from '../lib/metrics.js';
import { expenseBreakdown, averages, monthlyCashflow } from '../lib/spending.js';
import { monthlySnapshots, monthlyInvestmentReturns, annualizeReturns, cumulativeReturn, buildBalanceIndex, snapshot, balanceHistoryStart } from '../lib/balances.js';
import { dollars, money, pct, signedPct, signedDollars } from '../lib/format.js';
import { monthKey, monthLabel, monthLabelLong, addMonthKey } from '../lib/dates.js';
import { categoryOrder } from '../lib/options.js';
import { isInvestmentType, accountTypeInfo } from '@shared/accountTypes.js';

const lower = (s) => String(s ?? '').toLowerCase();

function rangeFor(range, today, firstDate) {
  const y = today.slice(0, 4);
  if (range === 'ytd') return { start: `${y}-01-01`, end: today };
  // Whole calendar months, ending with the current (partial) month.
  if (range === '12m') return { start: `${addMonthKey(monthKey(today), -11)}-01`, end: today };
  if (range === '24m') return { start: `${addMonthKey(monthKey(today), -23)}-01`, end: today };
  if (range === 'all') return { start: firstDate || `${y}-01-01`, end: today };
  if (/^\d{4}$/.test(range)) return { start: `${range}-01-01`, end: range === y ? today : `${range}-12-31` };
  return { start: `${y}-01-01`, end: today };
}

function firstRecordDate(records) {
  let min = null;
  for (const list of [records.expenses, records.paychecks, records.balances, records.activity]) for (const r of list) if (r.date && (!min || r.date < min)) min = r.date;
  return min;
}

const DIM_PLURAL = { category: 'categories', subcategory: 'subcategories', vendor: 'vendors', payment_method: 'accounts / payment methods' };
const DIM_SINGULAR = { category: 'category', subcategory: 'subcategory', vendor: 'vendor', payment_method: 'account / payment method' };

// ---------------- Spending ----------------
function Spending({ start, end, exclude }) {
  const { data } = useData();
  const [period, setPeriod] = usePref('metrics.period', 'month');
  const [by, setBy] = usePref('metrics.by', 'category');
  const breakdown = useMemo(() => expenseBreakdown(data.records.expenses, { start, end, period, by: by === 'total' ? null : by, exclude }), [data.records.expenses, start, end, period, by, exclude]);
  const byCategory = useMemo(() => expenseBreakdown(data.records.expenses, { start, end, period, by: 'category', exclude, topN: 100 }), [data.records.expenses, start, end, period, exclude]);
  const stable = by === 'category' ? categoryOrder(data.config) : by === 'payment_method' ? [...data.config.accounts.map((a) => a.name), ...data.config.paymentMethods.map((p) => p.name)] : breakdown.names;
  const colors = colorMap(breakdown.names, stable);
  const series = by === 'total' ? [{ key: 'Total', label: 'Total spend', color: 'var(--s1)' }] : breakdown.names.map((n) => ({ key: n, label: n, color: colors[n] }));
  const avg = averages(ledger(data), start, end, { exclude });
  const ranked = (by === 'total' ? byCategory : breakdown).totals;
  const rankedColors = by === 'total' ? colorMap(byCategory.names, categoryOrder(data.config)) : colors;
  const fmtPeriod = (p) => (period === 'year' ? p : monthLabel(p));

  return (
    <div className="stack">
      <div className="tiles">
        <Stat label="Total spent" value={dollars(breakdown.grandTotal)} sub={exclude.length ? `excluding ${exclude.join(', ')}` : 'all categories'} />
        <Stat label="Per month" value={dollars(avg.spending.monthlyCustom)} sub={`core ${dollars(avg.spending.monthlyCore)} · all ${dollars(avg.spending.monthlyAll)}`} />
        <Stat label="Per day" value={money(avg.spendDays ? avg.spending.custom / avg.spendDays : null)} sub={`over ${avg.spendDays} days`} />
        <Stat label="Largest category" value={byCategory.totals[0]?.name || '—'} sub={byCategory.totals[0] ? `${dollars(byCategory.totals[0].total)} · ${pct(byCategory.totals[0].total / (byCategory.grandTotal || 1), 0)}` : ''} />
      </div>
      <div className="filter-bar" style={{ marginBottom: 0 }}>
        <Segmented value={period} onChange={setPeriod} options={[{ value: 'month', label: 'By month' }, { value: 'year', label: 'By year' }]} label="Group by" />
        <Segmented
          value={by}
          onChange={setBy}
          label="Break down by"
          options={[
            { value: 'total', label: 'Total' },
            { value: 'category', label: 'Category' },
            { value: 'payment_method', label: 'Account' },
            { value: 'subcategory', label: 'Subcategory' },
            { value: 'vendor', label: 'Vendor' },
          ]}
        />
      </div>
      <div className="grid-12">
        <ChartCard
          className="span-8"
          title={`Expenses by ${period}`}
          subtitle={by === 'total' ? 'Total spending' : breakdown.names.includes('Other') ? `Top ${breakdown.names.length - 1} ${DIM_PLURAL[by]}, the rest grouped as Other` : `By ${DIM_SINGULAR[by]}`}
          legend={series.map((s) => ({ label: s.label, color: s.color }))}
          table={{
            columns: [{ key: 'period', label: period === 'year' ? 'Year' : 'Month', format: fmtPeriod }, ...series.map((s) => ({ key: s.key, label: s.label, num: true, format: dollars })), ...(by !== 'total' ? [{ key: 'total', label: 'Total', num: true, format: dollars }] : [])],
            rows: breakdown.rows,
          }}
        >
          {breakdown.rows.length ? <BarsChart data={breakdown.rows} xKey="period" stacked={by !== 'total'} xFormat={fmtPeriod} labelFormat={(p) => (period === 'year' ? p : monthLabelLong(p))} series={series} height={300} /> : <Empty>No expenses in this range.</Empty>}
        </ChartCard>
        <Card className="span-4" title={`Total by ${by === 'total' ? 'category' : DIM_SINGULAR[by]}`} subtitle={`${dollars(breakdown.grandTotal)} in range`}>
          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            <RankedBars items={ranked.slice(0, 25).map((t) => ({ name: t.name, value: t.total, color: rankedColors[t.name] || NEUTRAL }))} />
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---------------- Income & savings ----------------
function IncomeSavings({ start, end, exclude }) {
  const { data } = useData();
  const avg = useMemo(() => averages(ledger(data), start, end, { exclude }), [data, start, end, exclude]);
  const rows = useMemo(() => monthlyCashflow(ledger(data), monthKey(start), monthKey(end)), [data, start, end]);
  const withRate = rows.map((r) => ({ ...r, rate: r.savingsRate === null ? null : r.savingsRate }));

  return (
    <div className="stack">
      <div className="tiles">
        <Stat label="Average daily spend" value={money(avg.spending.dailyAll)} sub={`core ${money(avg.spending.dailyCore)}`} />
        <Stat label="Average monthly spend" value={dollars(avg.spending.monthlyAll)} sub={`core ${dollars(avg.spending.monthlyCore)}`} />
        <Stat label="Average daily income" value={money(avg.income.daily)} sub="take-home + other income" />
        <Stat label="Average monthly income" value={dollars(avg.income.monthly)} sub={`gross ${dollars(avg.income.monthlyGross)}`} />
        <Stat label="Saved of income" value={pct(avg.savingsRate)} sub="incl. 401(k)/HSA from paychecks" />
        <Stat label="Retirement from paychecks" value={dollars(avg.income.retirement)} sub="in range" />
      </div>
      <ChartCard
        title="Income vs expenses"
        subtitle="Monthly take-home pay plus other income, against spending"
        legend={[
          { label: 'Income', color: 'var(--s1)' },
          { label: 'Expenses', color: 'var(--s2)' },
        ]}
        table={{
          columns: [
            { key: 'month', label: 'Month', format: monthLabelLong },
            { key: 'income', label: 'Income', num: true, format: dollars },
            { key: 'retirement', label: '401(k)/HSA', num: true, format: dollars },
            { key: 'expenses', label: 'Expenses', num: true, format: dollars },
            { key: 'core', label: 'Core', num: true, format: dollars },
            { key: 'saved', label: 'Saved', num: true, format: dollars },
            { key: 'savingsRate', label: 'Rate', num: true, format: (v) => pct(v) },
          ],
          rows,
        }}
      >
        <BarsChart
          data={rows}
          xKey="month"
          xFormat={(k) => monthLabel(k)}
          labelFormat={monthLabelLong}
          series={[
            { key: 'income', label: 'Income', color: 'var(--s1)' },
            { key: 'expenses', label: 'Expenses', color: 'var(--s2)' },
          ]}
        />
      </ChartCard>
      <ChartCard title="Percent of income saved" subtitle="(income + paycheck retirement savings − expenses) ÷ (income + paycheck retirement savings)">
        <TimeChart
          data={withRate}
          xKey="month"
          xFormat={(k) => monthLabel(k)}
          labelFormat={monthLabelLong}
          yFormat={(v) => `${Math.round(v * 100)}%`}
          valueFormat={(v) => pct(v)}
          zeroLine
          series={[{ key: 'rate', label: 'Saved', color: 'var(--s1)' }]}
        />
      </ChartCard>
    </div>
  );
}

// ---------------- Investments ----------------
function Investments({ start, end }) {
  const { data, today } = useData();
  const [scope, setScope] = usePref('metrics.invScope', 'all');
  const invAccounts = data.config.accounts.filter((a) => isInvestmentType(a.type));
  const accounts = useMemo(() => {
    if (scope === 'all') return invAccounts;
    if (scope === 'retirement' || scope === 'brokerage') return invAccounts.filter((a) => accountTypeInfo(a.type).group === scope);
    return invAccounts.filter((a) => a.name === scope);
  }, [scope, invAccounts]);

  const index = useMemo(() => buildBalanceIndex(data.records.balances), [data.records.balances]);
  const startKey = monthKey(start);
  const endKey = monthKey(end);
  const series = useMemo(() => monthlySnapshots(accounts, index, startKey, endKey, today).map((s) => ({ month: s.month, value: s.investments, contributed: s.contributed || null })), [accounts, index, startKey, endKey, today]);
  const returns = useMemo(() => monthlyInvestmentReturns(accounts, index, data.records.activity, startKey, endKey, today), [accounts, index, data.records.activity, startKey, endKey, today]);
  const allReturns = useMemo(() => monthlyInvestmentReturns(accounts, index, data.records.activity, balanceHistoryStart(data.records.balances, today), monthKey(today), today), [accounts, index, data.records.activity, data.records.balances, today]);
  const now = snapshot(data.config.accounts, index, today).totals;
  const sub = snapshot(accounts, index, today).totals;
  const value = sub.investments;
  const contributed = sub.contributed;
  const annualized = annualizeReturns(returns);
  const lifetime = annualizeReturns(allReturns);
  const totalGain = returns.reduce((s, r) => s + r.gain, 0);
  const hasContrib = series.some((s) => s.contributed);

  if (!invAccounts.length) {
    return (
      <Card>
        <Empty title="No investment accounts" action={<a className="btn primary" href="#/settings?tab=accounts">Add accounts</a>}>
          Add brokerage, Roth IRA, 401(k) or other investment accounts in Settings.
        </Empty>
      </Card>
    );
  }

  return (
    <div className="stack">
      <div className="filter-bar" style={{ marginBottom: 0 }}>
        <Select
          small
          value={scope}
          onChange={setScope}
          aria-label="Accounts"
          style={{ width: 'auto' }}
          options={[
            { value: 'all', label: 'All investments' },
            { value: 'retirement', label: 'Retirement accounts' },
            { value: 'brokerage', label: 'Brokerage accounts' },
            { group: 'Accounts', options: invAccounts.map((a) => ({ value: a.name, label: a.name })) },
          ]}
        />
      </div>
      <div className="tiles">
        <Stat label="Current value" value={dollars(value)} />
        <Stat label="Total contributed" value={contributed ? dollars(contributed) : '—'} sub={contributed ? `${dollars(value - contributed)} gain (${pct((value - contributed) / contributed)})` : 'Record contributions with balances'} />
        <Stat label="Gain in range" value={signedDollars(totalGain)} sub={`cumulative ${signedPct(cumulativeReturn(returns))}`} />
        <Stat label="Annualized return" value={signedPct(annualized)} sub={`${returns.filter((r) => r.return !== null).length} months in range · lifetime ${signedPct(lifetime)}`} />
        <Stat label="Retirement share of investments" value={pct(now.investments ? now.retirement / now.investments : null)} sub={`${dollars(now.retirement)} of ${dollars(now.investments)}`} />
        <Stat label="Investments share of net worth" value={pct(now.netWorth > 0 ? now.investments / now.netWorth : null)} sub={`${pct(now.assets ? now.investments / now.assets : null)} of total assets`} />
      </div>
      <ChartCard
        title="Contributions vs value"
        subtitle="What you put in compared with what it's worth"
        legend={[
          { label: 'Value', color: 'var(--s1)', type: 'line' },
          { label: 'Contributed', color: 'var(--s2)', type: 'line' },
        ]}
        table={{
          columns: [
            { key: 'month', label: 'Month', format: monthLabelLong },
            { key: 'value', label: 'Value', num: true, format: dollars },
            { key: 'contributed', label: 'Contributed', num: true, format: (v) => (v ? dollars(v) : '—') },
            { key: 'gain', label: 'Gain', num: true, format: (v, r) => (r.contributed ? dollars(r.value - r.contributed) : '—') },
          ],
          rows: series,
        }}
      >
        <TimeChart
          data={series}
          xKey="month"
          xFormat={(k) => monthLabel(k)}
          labelFormat={monthLabelLong}
          series={[{ key: 'value', label: 'Value', color: 'var(--s1)', area: true }, ...(hasContrib ? [{ key: 'contributed', label: 'Contributed', color: 'var(--s2)' }] : [])]}
          height={300}
        />
      </ChartCard>
      <ChartCard
        title="Monthly gain"
        subtitle="Percent gain each month, net of contributions"
        table={{
          columns: [
            { key: 'month', label: 'Month', format: monthLabelLong },
            { key: 'start', label: 'Start', num: true, format: dollars },
            { key: 'flows', label: 'Contributions', num: true, format: signedDollars },
            { key: 'end', label: 'End', num: true, format: dollars },
            { key: 'gain', label: 'Gain', num: true, format: signedDollars },
            { key: 'return', label: 'Gain %', num: true, format: (v) => signedPct(v, 2) },
          ],
          rows: returns.slice().reverse(),
        }}
      >
        {returns.length ? (
          <BarsChart
            data={returns}
            xKey="month"
            xFormat={(k) => monthLabel(k)}
            labelFormat={monthLabelLong}
            yFormat={(v) => `${(v * 100).toFixed(0)}%`}
            valueFormat={(v) => signedPct(v, 2)}
            zeroLine
            series={[{ key: 'return', label: 'Gain', color: 'var(--s1)' }]}
            cellColor={(d) => (d.return < 0 ? 'var(--s8)' : 'var(--s1)')}
          />
        ) : (
          <Empty>Record balances for at least two months to see monthly gains.</Empty>
        )}
      </ChartCard>
    </div>
  );
}

// ---------------- Net worth ----------------
function NetWorth({ start, end }) {
  const { data, today } = useData();
  const [homeMode, setHomeMode] = usePref('metrics.homeMode', 'equity');
  const core = useMemo(() => computeCore(data, today), [data, today]);
  const series = core.series.filter((s) => s.month >= monthKey(start) && s.month <= monthKey(end));
  const t = core.current.totals;
  const homeValue = homeMode === 'equity' ? Math.max(0, t.homeEquity) : t.home;
  const relationship = [
    { name: homeMode === 'equity' ? 'Home equity' : 'Home value', value: homeValue, color: 'var(--s1)' },
    { name: 'Retirement', value: Math.max(0, t.retirement), color: 'var(--s2)' },
    { name: 'Brokerage', value: Math.max(0, t.brokerage), color: 'var(--s3)' },
    { name: 'Cash', value: Math.max(0, t.cash), color: 'var(--s4)' },
  ];
  const assetRows = core.current.rows.filter((r) => !r.info.liability && (r.value || 0) > 0).sort((a, b) => b.value - a.value);
  const top = assetRows.slice(0, 7);
  const rest = assetRows.slice(7).reduce((s, r) => s + r.value, 0);
  const order = data.config.accounts.map((a) => a.name);
  const colors = colorMap(top.map((r) => r.account.name), order);
  const accountsPie = [...top.map((r) => ({ name: r.account.name, value: r.value, color: colors[r.account.name] })), ...(rest > 0 ? [{ name: 'Other', value: rest, color: NEUTRAL }] : [])];
  const first = series[0];
  const last = series[series.length - 1];

  return (
    <div className="stack">
      <div className="tiles">
        <Stat label="Net worth" value={dollars(t.netWorth)} sub={first && last ? `${signedDollars(last.netWorth - first.netWorth)} in range` : ''} />
        <Stat label="Total assets" value={dollars(t.assets)} />
        <Stat label="Total liabilities" value={dollars(t.liabilities)} sub={`mortgage ${dollars(t.mortgage)} · cards ${dollars(t.credit)}`} />
        <Stat label="Home equity" value={dollars(t.homeEquity)} sub={t.home ? `${pct(t.homeEquity / t.home)} of ${dollars(t.home)} home value` : 'Add a Home account'} />
      </div>
      <ChartCard
        title="Net worth over time"
        subtitle="Month-end values from recorded balances"
        legend={[
          { label: 'Net worth', color: 'var(--s1)', type: 'line' },
          { label: 'Investments', color: 'var(--s2)', type: 'line' },
          { label: 'Home equity', color: 'var(--s3)', type: 'line' },
          { label: 'Cash', color: 'var(--s4)', type: 'line' },
        ]}
        table={{
          columns: [
            { key: 'month', label: 'Month', format: monthLabelLong },
            { key: 'netWorth', label: 'Net worth', num: true, format: dollars },
            { key: 'investments', label: 'Investments', num: true, format: dollars },
            { key: 'homeEquity', label: 'Home equity', num: true, format: dollars },
            { key: 'cash', label: 'Cash', num: true, format: dollars },
            { key: 'liabilities', label: 'Liabilities', num: true, format: dollars },
          ],
          rows: series,
        }}
      >
        <TimeChart
          data={series}
          xKey="month"
          xFormat={(k) => monthLabel(k)}
          labelFormat={monthLabelLong}
          height={300}
          series={[
            { key: 'netWorth', label: 'Net worth', color: 'var(--s1)', area: true },
            { key: 'investments', label: 'Investments', color: 'var(--s2)' },
            { key: 'homeEquity', label: 'Home equity', color: 'var(--s3)' },
            { key: 'cash', label: 'Cash', color: 'var(--s4)' },
          ]}
        />
      </ChartCard>
      <div className="grid-12">
        <Card className="span-6" title="Home vs retirement vs brokerage vs cash" actions={<Segmented value={homeMode} onChange={setHomeMode} options={[{ value: 'equity', label: 'Equity' }, { value: 'value', label: 'Value' }]} label="Home" />}>
          <Donut data={relationship} centerLabel="Total" centerValue={dollars(relationship.reduce((s, r) => s + r.value, 0))} />
        </Card>
        <Card className="span-6" title="All accounts" subtitle="Share of total assets by account">
          <Donut data={accountsPie} centerLabel="Assets" centerValue={dollars(t.assets)} />
        </Card>
      </div>
    </div>
  );
}

export default function Metrics() {
  const { data, today } = useData();
  const [tab, setTab] = usePref('metrics.tab', 'spending');
  const [range, setRange] = usePref('metrics.range', '12m');
  const [exclude, setExclude] = usePref('metrics.exclude', []);
  const [showExclude, setShowExclude] = useState(false);
  const first = useMemo(() => firstRecordDate(data.records), [data.records]);
  const { start, end } = rangeFor(range, today, first);
  const years = useMemo(() => {
    const ys = new Set();
    for (const list of [data.records.expenses, data.records.balances, data.records.paychecks]) for (const r of list) if (r.date) ys.add(r.date.slice(0, 4));
    return [...ys].sort().reverse();
  }, [data.records]);
  const cats = data.config.categories.expense.map((c) => c.name);

  return (
    <div>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'spending', label: 'Spending' },
          { value: 'income', label: 'Income & savings' },
          { value: 'investments', label: 'Investments' },
          { value: 'networth', label: 'Net worth & allocation' },
        ]}
      />
      <div className="filter-bar">
        <Select
          small
          value={range}
          onChange={setRange}
          aria-label="Date range"
          style={{ width: 'auto' }}
          options={[
            { value: 'ytd', label: 'Year to date' },
            { value: '12m', label: 'Last 12 months' },
            { value: '24m', label: 'Last 24 months' },
            { value: 'all', label: 'All time' },
            ...years.map((y) => ({ value: y, label: y })),
          ]}
        />
        {(tab === 'spending' || tab === 'income') && (
          <button className={`btn sm ${exclude.length ? '' : 'ghost'}`} onClick={() => setShowExclude((v) => !v)} aria-expanded={showExclude}>
            {exclude.length ? `Excluding ${exclude.length} categor${exclude.length > 1 ? 'ies' : 'y'}` : 'Exclude categories'}
          </button>
        )}
      </div>
      {showExclude && (tab === 'spending' || tab === 'income') && (
        <div className="chips" style={{ marginBottom: 16 }}>
          {cats.map((c) => {
            const off = exclude.some((x) => lower(x) === lower(c));
            return (
              <button key={c} className={`chip ${off ? 'off' : ''}`} onClick={() => setExclude(off ? exclude.filter((x) => lower(x) !== lower(c)) : [...exclude, c])}>
                {c}
              </button>
            );
          })}
          {exclude.length > 0 && (
            <button className="link-btn small" onClick={() => setExclude([])}>
              Clear
            </button>
          )}
        </div>
      )}
      {tab === 'spending' && <Spending start={start} end={end} exclude={exclude} />}
      {tab === 'income' && <IncomeSavings start={start} end={end} exclude={exclude} />}
      {tab === 'investments' && <Investments start={start} end={end} />}
      {tab === 'networth' && <NetWorth start={start} end={end} />}
    </div>
  );
}
