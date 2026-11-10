import { useMemo } from 'react';
import { useData, useToast } from '../store.jsx';
import { useForms } from '../App.jsx';
import { Card, Stat, Empty } from '../components/ui.jsx';
import { ChartCard, TimeChart, BarsChart, Donut } from '../components/charts.jsx';
import { computeCore, projectionInputs, netWorthProjection, endOfYearNetWorth, salaryNow, cashflowSeries, windowFor, ledger } from '../lib/metrics.js';
import { averages, excludedCoreSet } from '../lib/spending.js';
import { dollars, pct, signedDollars, money } from '../lib/format.js';
import { monthLabel, monthLabelLong, formatDate, daysBetween } from '../lib/dates.js';
import { ACCOUNT_GROUPS } from '@shared/accountTypes.js';

const lower = (s) => String(s ?? '').toLowerCase();

function Onboarding({ data }) {
  const { config, records } = data;
  const steps = [
    { done: records.expenses.length + records.balances.length > 0, label: 'Have your history in a spreadsheet (e.g. Google Sheets)? Import it', href: '#/settings?tab=import' },
    { done: config.accounts.length > 0, label: 'Add your accounts (checking, credit cards, investments, home…)', href: '#/settings?tab=accounts' },
    { done: records.balances.length > 0, label: 'Record today’s balances', href: '#/balances' },
    { done: records.expenses.length > 0, label: 'Log an expense', href: '#/expenses' },
    { done: records.salary.length + records.paychecks.length > 0, label: 'Add your salary or a paycheck', href: '#/income' },
    { done: Object.keys(config.budgets).length > 0, label: 'Set up a budget', href: '#/budget' },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <div className="callout">
      <h2>Welcome to Mynance</h2>
      <p className="ink-2 small" style={{ marginTop: 4 }}>
        A few steps to get your dashboard filled in. Categories are already set up — adjust them anytime in Settings.
      </p>
      <div className="checklist">
        {steps.map((s) => (
          <a key={s.label} href={s.href} className={s.done ? 'done' : ''}>
            <span>{s.done ? '✓' : '○'}</span>
            {s.label}
          </a>
        ))}
      </div>
    </div>
  );
}

// Credit card owed = last recorded balance + charges since then - payments since then.
// Charges are only added while the recorded balance is recent (about one statement
// cycle); after that the balance is shown as recorded, since payments made outside
// Mynance would otherwise be missed. Cards with no recorded balance aren't estimated.
const CARD_ESTIMATE_DAYS = 45;
function creditCardOutstanding(data, core, today) {
  const cards = data.config.accounts.filter((a) => a.type === 'credit_card' && !a.archived);
  return cards.map((card) => {
    const row = core.current.rows.find((r) => r.account === card);
    const asOf = row?.asOf || null;
    if (!asOf) return { card, asOf, recorded: 0, charges: 0, payments: 0, owed: 0, status: 'none' };
    const recent = daysBetween(asOf, today) <= CARD_ESTIMATE_DAYS;
    const after = (r, key) => lower(r[key]) === lower(card.name) && r.date > asOf && r.date <= today;
    const charges = recent ? data.records.expenses.filter((e) => after(e, 'payment_method')).reduce((s, e) => s + (e.amount || 0), 0) : 0;
    const payments = recent ? data.records.activity.filter((a) => after(a, 'account')).reduce((s, a) => s + (a.amount || 0), 0) : 0;
    const recorded = row.value || 0;
    return { card, asOf, recorded, charges, payments, owed: Math.max(0, recorded + charges - payments), status: recent ? 'estimated' : 'stale' };
  });
}

export default function Dashboard() {
  const { data, today, saveConfig } = useData();
  const toast = useToast();
  const openForm = useForms();
  const settings = data.config.settings;
  const excluded = settings.dashboard.excludedCategories || [];

  const core = useMemo(() => computeCore(data, today), [data, today]);
  const inputs = useMemo(() => projectionInputs(data, core, today), [data, core, today]);
  const t = core.current.totals;

  const win = windowFor(settings.dashboard.averageMonths || 12, today);
  const avg = useMemo(() => averages(ledger(data), win.start, win.end, { exclude: excluded }), [data, win.start, win.end, excluded]);
  const eoy = useMemo(() => endOfYearNetWorth(core, inputs, today), [core, inputs, today]);
  const salary = useMemo(() => salaryNow(data, today), [data, today]);
  const cards = useMemo(() => creditCardOutstanding(data, core, today), [data, core, today]);
  const cardTotal = cards.reduce((s, c) => s + c.owed, 0);

  const prev = core.series.length >= 2 ? core.series[core.series.length - 2] : null;
  const nwDelta = prev ? t.netWorth - prev.netWorth : null;
  const monthsOfCash = avg.spending.monthlyAll ? t.cash / avg.spending.monthlyAll : null;

  // Net worth roadmap: actual history, then projection (dashed) from today.
  const roadmap = useMemo(() => {
    const years = settings.projection.years || 10;
    const past = core.series.map((s) => ({ month: s.month, actual: s.netWorth }));
    const future = netWorthProjection(core, inputs, years * 12).map((p) => ({ month: p.month, projected: p.netWorth }));
    if (past.length) past[past.length - 1].projected = past[past.length - 1].actual;
    return [...past, ...future];
  }, [core, inputs, settings.projection.years]);

  const cashflow = useMemo(() => cashflowSeries(data, 12, today), [data, today]);

  const allocation = [
    { name: 'Cash', value: Math.max(0, t.cash), color: 'var(--s1)' },
    { name: 'Investments', value: Math.max(0, t.investments), color: 'var(--s2)' },
    { name: 'Home equity', value: Math.max(0, t.homeEquity), color: 'var(--s3)' },
    { name: 'Other assets', value: Math.max(0, t.asset), color: 'var(--s4)' },
  ];

  // Categories with spending in the window, for the exclusion chips.
  const spendCats = useMemo(() => {
    const m = new Map();
    for (const e of data.records.expenses) if (e.date >= win.start && e.date <= win.end) m.set(e.category, (m.get(e.category) || 0) + (e.amount || 0));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [data.records.expenses, win.start, win.end]);
  const nonCore = excludedCoreSet(data.config.categories);

  const toggleExcluded = async (cat) => {
    const isOff = excluded.some((c) => lower(c) === lower(cat));
    const next = isOff ? excluded.filter((c) => lower(c) !== lower(cat)) : [...excluded, cat];
    try {
      await saveConfig('settings', { ...settings, dashboard: { ...settings.dashboard, excludedCategories: next } });
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const groups = useMemo(() => {
    const g = new Map();
    for (const r of core.current.rows) {
      if (r.account.archived) continue;
      const key = r.info.group;
      if (!g.has(key)) g.set(key, []);
      g.get(key).push(r);
    }
    return Object.keys(ACCOUNT_GROUPS)
      .filter((k) => g.has(k))
      .map((k) => ({ key: k, label: ACCOUNT_GROUPS[k], rows: g.get(k), total: g.get(k).reduce((s, r) => s + (r.value || 0), 0), liability: ['credit', 'mortgage', 'loan'].includes(k) }));
  }, [core]);

  const hasBalances = data.records.balances.length > 0;

  return (
    <div className="stack">
      <Onboarding data={data} />

      <div className="grid-12">
        <section className="card span-12">
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="stat-label">Net worth</div>
              <div className="hero" style={{ marginTop: 4 }}>
                <span className="hero-value">{dollars(t.netWorth)}</span>
                {nwDelta !== null && (
                  <span className={`delta ${nwDelta >= 0 ? 'up' : 'down'}`} style={{ paddingBottom: 8 }}>
                    {nwDelta >= 0 ? '▲' : '▼'} {signedDollars(nwDelta)} since {monthLabelLong(prev.month).split(' ')[0]}
                  </span>
                )}
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                Assets {dollars(t.assets)} · Liabilities {dollars(t.liabilities)}
              </div>
            </div>
            <a className="btn" href="#/balances">
              Update balances
            </a>
          </div>
        </section>
      </div>

      <div className="tiles">
        <Stat label="Investments" value={dollars(t.investments)} sub={t.contributed ? `${dollars(t.investments - t.contributed)} gain on ${dollars(t.contributed)} contributed` : `Retirement ${dollars(t.retirement)} · Brokerage ${dollars(t.brokerage)}`} />
        <Stat label="Cash" value={dollars(t.cash)} sub="Checking, savings and cash" />
        <Stat
          label="Credit cards owed"
          value={dollars(cardTotal)}
          sub={
            !cards.length
              ? 'No credit cards yet'
              : cards.some((c) => c.status === 'none')
                ? `${cards.filter((c) => c.status === 'none').length} card${cards.filter((c) => c.status === 'none').length > 1 ? 's have' : ' has'} no balance recorded`
                : cards.some((c) => c.charges)
                  ? `incl. ${dollars(cards.reduce((s, c) => s + c.charges, 0))} charged since last balance`
                  : `${cards.length} card${cards.length > 1 ? 's' : ''}, unpaid balance`
          }
          onClick={() => (window.location.hash = '/balances')}
        />
        <Stat label="Months of cash" value={monthsOfCash !== null ? monthsOfCash.toFixed(1) : '—'} sub={avg.spending.monthlyAll ? `Cash ÷ ${dollars(avg.spending.monthlyAll)}/mo spend` : 'Needs spending history'} />
        <Stat label={`Net worth, Dec 31 ${today.slice(0, 4)} (est.)`} value={dollars(eoy)} sub={`${signedDollars(eoy - t.netWorth)} from today`} />
        <Stat
          label="Salary vs investments"
          value={salary.amount ? `${(t.investments / salary.amount).toFixed(1)}×` : '—'}
          sub={salary.amount ? `Investments ÷ ${dollars(salary.amount)} ${salary.source === 'paychecks' ? 'pay (12 mo)' : 'salary'}` : 'Add salary on the Income page'}
        />
      </div>

      <div className="grid-12">
        <ChartCard
          className="span-8"
          title="Net worth roadmap"
          subtitle={`History and ${settings.projection.years}-year projection at ${settings.projection.expectedReturn}% returns, ${dollars(inputs.monthlyInvestment)}/mo invested`}
          legend={[
            { label: 'Actual', color: 'var(--s1)', type: 'line' },
            { label: 'Projected', color: 'var(--s1)', type: 'dashed' },
          ]}
          actions={
            <a className="btn sm ghost" href="#/projections">
              Assumptions
            </a>
          }
          table={{
            columns: [
              { key: 'month', label: 'Month', format: monthLabelLong },
              { key: 'actual', label: 'Actual', num: true, format: (v) => (v === undefined ? '' : dollars(v)) },
              { key: 'projected', label: 'Projected', num: true, format: (v) => (v === undefined ? '' : dollars(v)) },
            ],
            rows: roadmap,
          }}
        >
          {hasBalances ? (
            <TimeChart
              data={roadmap}
              xKey="month"
              xFormat={(k) => monthLabel(k)}
              labelFormat={(k) => monthLabelLong(k)}
              referenceX={core.endKey}
              referenceLabel="Today"
              series={[
                { key: 'actual', label: 'Actual', color: 'var(--s1)', area: true },
                { key: 'projected', label: 'Projected', color: 'var(--s1)', dashed: true },
              ]}
            />
          ) : (
            <Empty title="No balances yet" action={<a className="btn primary" href="#/balances">Record balances</a>}>
              Record account balances to see your net worth over time.
            </Empty>
          )}
        </ChartCard>

        <Card className="span-4" title="Where your net worth sits" subtitle="Cash vs investments vs home equity">
          <Donut data={allocation} centerLabel="Assets" centerValue={dollars(allocation.reduce((s, a) => s + a.value, 0))} />
          {t.homeEquity < 0 && <p className="small warn" style={{ marginTop: 8 }}>Home equity is negative ({dollars(t.homeEquity)}) and is left out.</p>}
        </Card>

        <ChartCard
          className="span-8"
          title="Income vs expenses"
          subtitle="Last 12 months · income is take-home pay plus other income"
          legend={[
            { label: 'Income', color: 'var(--s1)' },
            { label: 'Expenses', color: 'var(--s2)' },
          ]}
          table={{
            columns: [
              { key: 'month', label: 'Month', format: monthLabelLong },
              { key: 'income', label: 'Income', num: true, format: dollars },
              { key: 'expenses', label: 'Expenses', num: true, format: dollars },
              { key: 'savingsRate', label: 'Saved', num: true, format: (v) => pct(v) },
            ],
            rows: cashflow,
          }}
        >
          <BarsChart
            data={cashflow}
            xKey="month"
            xFormat={(k) => monthLabel(k, { year: false })}
            labelFormat={(k) => monthLabelLong(k)}
            series={[
              { key: 'income', label: 'Income', color: 'var(--s1)' },
              { key: 'expenses', label: 'Expenses', color: 'var(--s2)' },
            ]}
          />
        </ChartCard>

        <Card className="span-4" title="Monthly expense average" subtitle={`Last ${settings.dashboard.averageMonths || 12} months · tap a category to leave it out`}>
          <div className="hero-value" style={{ fontSize: 34 }}>
            {avg.spending.monthlyCustom !== null ? dollars(avg.spending.monthlyCustom) : '—'}
          </div>
          <div className="small muted" style={{ marginBottom: 12 }}>
            {excluded.length ? `Excluding ${excluded.length} categor${excluded.length > 1 ? 'ies' : 'y'} · ` : ''}All {dollars(avg.spending.monthlyAll)} · Core {dollars(avg.spending.monthlyCore)}
          </div>
          <div className="chips">
            {spendCats.map((c) => {
              const off = excluded.some((x) => lower(x) === lower(c));
              return (
                <button key={c} className={`chip ${off ? 'off' : ''}`} onClick={() => toggleExcluded(c)} aria-pressed={!off} title={nonCore.has(lower(c)) ? 'Not part of core spending' : undefined}>
                  {c}
                </button>
              );
            })}
            {!spendCats.length && <span className="muted small">No expenses in this period.</span>}
          </div>
        </Card>

        <Card
          className="span-7"
          title="Account balances"
          subtitle="Latest recorded value, nearest dollar"
          actions={
            <a className="btn sm" href="#/balances">
              Update
            </a>
          }
        >
          {groups.length === 0 ? (
            <Empty title="No accounts yet" action={<a className="btn primary" href="#/settings?tab=accounts">Add accounts</a>} />
          ) : (
            <div className="list">
              {groups.map((g) => (
                <div key={g.key}>
                  <div className="list-group-head">
                    <span>{g.label}</span>
                    <span className="tabular">{g.liability ? dollars(-g.total) : dollars(g.total)}</span>
                  </div>
                  {g.rows.map((r) => {
                    const stale = r.asOf && daysBetween(r.asOf, today) > 35;
                    const card = cards.find((c) => c.card === r.account);
                    return (
                      <div className="list-item" key={r.account.name}>
                        <div className="grow">
                          <div className="title">{r.account.name}</div>
                          <div className={`sub ${stale ? 'warn' : ''}`}>
                            {r.asOf ? `as of ${formatDate(r.asOf)}` : 'no balance recorded'}
                            {card && card.charges ? ` · +${dollars(card.charges)} charges since` : ''}
                          </div>
                        </div>
                        <div className="amount">{r.value === null ? '—' : g.liability ? dollars(-r.value) : dollars(r.value)}</div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="span-5" title="Averages" subtitle={`Last ${settings.dashboard.averageMonths || 12} months · core excludes ${[...nonCore].length ? data.config.categories.expense.filter((c) => c.excludeFromCore).map((c) => c.name).join(', ') : 'nothing'}`}>
          <dl className="kv">
            <dt>Average daily spend</dt>
            <dd>{money(avg.spending.dailyAll)}</dd>
            <dt>Average monthly spend (all)</dt>
            <dd>{dollars(avg.spending.monthlyAll)}</dd>
            <dt>Average monthly spend (core)</dt>
            <dd>{dollars(avg.spending.monthlyCore)}</dd>
            <dt>Average daily income</dt>
            <dd>{money(avg.income.daily)}</dd>
            <dt>Average monthly income</dt>
            <dd>{dollars(avg.income.monthly)}</dd>
            <dt>Savings rate</dt>
            <dd>{pct(avg.savingsRate)}</dd>
          </dl>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn sm" onClick={() => openForm('expense')}>
              Add expense
            </button>
            <button className="btn sm" onClick={() => openForm('paycheck')}>
              Add paycheck
            </button>
            <a className="btn sm ghost" href="#/metrics">
              More metrics
            </a>
          </div>
        </Card>
      </div>
    </div>
  );
}
