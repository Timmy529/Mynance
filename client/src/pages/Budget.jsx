import { useMemo, useState } from 'react';
import { useData, useToast, usePref } from '../store.jsx';
import { Card, Stat, Tabs, Segmented, Select, Field, MoneyInput, Modal, Empty, Meter, PercentInput, useConfirm, useSaving } from '../components/ui.jsx';
import { ChartCard, BarsChart, TimeChart } from '../components/charts.jsx';
import { IconPlus, IconChevronLeft, IconChevronRight } from '../components/icons.jsx';
import { budgetTotals, budgetByMonth, budgetVsActual, burnDown, projectSpending } from '../lib/budget.js';
import { dollars, money, pct } from '../lib/format.js';
import { MONTH_NAMES, formatDate } from '../lib/dates.js';
import { expenseCategoryOptions, subcategoryOptions } from '../lib/options.js';

const lower = (s) => String(s ?? '').toLowerCase();
const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function useBudget(year) {
  const { data, saveConfig } = useData();
  const budgets = data.config.budgets;
  const items = budgets[year]?.items || [];
  const save = (nextItems) => saveConfig('budgets', { ...budgets, [year]: { ...(budgets[year] || {}), items: nextItems } });
  return { items, exists: !!budgets[year], save, budgets };
}

function LineForm({ year, initial, index, onDone }) {
  const { data } = useData();
  const { items, save } = useBudget(year);
  const toast = useToast();
  const { saving, error, setError, run } = useSaving();
  const [f, setF] = useState(() => ({ category: '', subcategory: '', kind: 'variable', annual: '', months: [], notes: '', ...(initial || {}) }));
  const [entry, setEntry] = useState('monthly');
  const months = f.months?.length ? f.months : ALL;
  const perOccurrence = f.annual === '' ? '' : Math.round((f.annual / months.length) * 100) / 100;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!f.category) return setError('Choose a category');
    if (f.annual === '' || f.annual < 0) return setError('Enter an amount');
    const item = { ...f, annual: Number(f.annual), months: f.months?.length && f.months.length < 12 ? f.months : undefined };
    const next = items.slice();
    if (index !== undefined) next[index] = item;
    else next.push(item);
    const ok = await run(() => save(next)).catch(() => false);
    if (ok) {
      toast('Budget saved');
      onDone();
    }
  };

  const toggleMonth = (m) => {
    const cur = f.months?.length ? f.months : ALL;
    const next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m].sort((a, b) => a - b);
    if (next.length === 0) return;
    const per = perOccurrence;
    setF((x) => ({ ...x, months: next.length === 12 ? [] : next, annual: per === '' ? x.annual : Math.round(per * next.length * 100) / 100 }));
  };

  const subs = subcategoryOptions(data.config, f.category);
  return (
    <form className="form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Category">
          <Select value={f.category} onChange={(v) => setF((x) => ({ ...x, category: v, subcategory: '' }))} options={expenseCategoryOptions(data.config, initial?.category)} placeholder="Choose…" />
        </Field>
        <Field label="Subcategory" hint="Optional — leave blank to budget the whole category">
          <Select value={f.subcategory} onChange={(v) => set('subcategory', v)} options={subs} placeholder="Whole category" disabled={!subs.length} />
        </Field>
        <Field label="Type" className="full" hint={f.kind === 'fixed' ? 'Known, predictable bills (mortgage, insurance, subscriptions).' : 'Spending that varies month to month (groceries, dining, fuel).'}>
          <Segmented value={f.kind} onChange={(v) => set('kind', v)} options={[{ value: 'fixed', label: 'Fixed' }, { value: 'variable', label: 'Variable' }]} />
        </Field>
        <Field label="Due in months" className="full" hint={months.length === 12 ? 'Every month' : `${months.length} month${months.length > 1 ? 's' : ''} a year — the annual amount is split across these months`}>
          <div className="chips">
            {ALL.map((m) => (
              <button type="button" key={m} className={`chip ${months.includes(m) ? 'on' : ''}`} onClick={() => toggleMonth(m)}>
                {MONTH_NAMES[m - 1]}
              </button>
            ))}
            <button type="button" className="chip" onClick={() => setF((x) => ({ ...x, months: [], annual: perOccurrence === '' ? x.annual : Math.round(perOccurrence * 12 * 100) / 100 }))}>
              All
            </button>
          </div>
        </Field>
        <Field label={entry === 'annual' ? 'Amount per year' : months.length === 12 ? 'Amount per month' : 'Amount each time'}>
          {entry === 'annual' ? (
            <MoneyInput value={f.annual} onChange={(v) => set('annual', v)} />
          ) : (
            <MoneyInput value={perOccurrence} onChange={(v) => set('annual', v === '' ? '' : Math.round(v * months.length * 100) / 100)} />
          )}
        </Field>
        <Field label="Enter as">
          <Segmented value={entry} onChange={setEntry} options={[{ value: 'monthly', label: months.length === 12 ? 'Monthly' : 'Per occurrence' }, { value: 'annual', label: 'Annual' }]} />
        </Field>
      </div>
      <p className="small ink-2">
        {f.annual !== '' ? `${dollars(f.annual)} per year · ${money(f.annual / 12)} per month on average` : ' '}
      </p>
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        <button className="btn primary" type="submit" disabled={saving}>
          Save
        </button>
        <button className="btn ghost" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Plan({ year, setTab }) {
  const { items, exists, save, budgets } = useBudget(year);
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null);
  const totals = budgetTotals(items);
  const monthly = budgetByMonth(items);
  const prevYear = String(Number(year) - 1);

  const remove = async (i) => {
    if (!(await confirm({ title: 'Remove this budget line?', confirmLabel: 'Remove', danger: true }))) return;
    await save(items.filter((_, j) => j !== i));
    toast('Line removed');
  };
  const copyPrev = async () => {
    await save(budgets[prevYear].items);
    toast(`Copied ${prevYear} budget`);
  };

  const sorted = items.map((it, i) => ({ it, i })).sort((a, b) => (a.it.kind === b.it.kind ? b.it.annual - a.it.annual : a.it.kind === 'fixed' ? -1 : 1));

  return (
    <div className="stack">
      <div className="tiles">
        <Stat label={`${year} spend plan`} value={dollars(totals.total)} sub={`${items.length} line${items.length === 1 ? '' : 's'}`} />
        <Stat label="Fixed" value={dollars(totals.fixed)} sub={totals.total ? `${pct(totals.fixed / totals.total, 0)} of plan` : ''} />
        <Stat label="Variable" value={dollars(totals.variable)} sub={totals.total ? `${pct(totals.variable / totals.total, 0)} of plan` : ''} />
        <Stat label="Per month (avg)" value={dollars(totals.total / 12)} sub={`${dollars(totals.fixed / 12)} fixed + ${dollars(totals.variable / 12)} variable`} />
      </div>

      <Card
        title="Annual spend plan"
        subtitle="Fixed and variable expectations by category"
        actions={
          <button className="btn primary sm" onClick={() => setEditing({})}>
            <IconPlus /> Add line
          </button>
        }
        flush
      >
        {!items.length ? (
          <Empty title={`No ${year} budget yet`}>
            <span>Add lines one at a time, or start from your actual spending.</span>
            <span className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button className="btn primary" onClick={() => setEditing({})}>
                Add a line
              </button>
              <button className="btn" onClick={() => setTab('next')}>
                Build from history
              </button>
              {budgets[prevYear] && (
                <button className="btn" onClick={copyPrev}>
                  Copy {prevYear}
                </button>
              )}
            </span>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Type</th>
                  <th className="num">Per month</th>
                  <th className="num">Per year</th>
                  <th className="actions" />
                </tr>
              </thead>
              <tbody>
                {sorted.map(({ it, i }) => (
                  <tr key={i} className="clickable" onClick={() => setEditing({ item: it, index: i })}>
                    <td>
                      <div className="cell-main">{it.category}</div>
                      {it.subcategory && <div className="cell-sub">{it.subcategory}</div>}
                    </td>
                    <td>
                      <span className={`badge ${it.kind === 'fixed' ? 'accent' : ''}`}>{it.kind}</span>
                      {it.months?.length ? <div className="cell-sub">{it.months.map((m) => MONTH_NAMES[m - 1]).join(', ')}</div> : null}
                    </td>
                    <td className="num">{it.months?.length ? `${money(it.annual / it.months.length)} ×${it.months.length}` : money(it.annual / 12)}</td>
                    <td className="num">{dollars(it.annual)}</td>
                    <td className="actions">
                      <button
                        className="btn sm ghost danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(i);
                        }}
                        aria-label="Remove line"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Total</td>
                  <td className="num">{money(totals.total / 12)}</td>
                  <td className="num">{dollars(totals.total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {items.length > 0 && (
        <ChartCard
          title="Monthly expectations"
          subtitle="What the plan expects you to spend each month"
          legend={[
            { label: 'Fixed', color: 'var(--s1)' },
            { label: 'Variable', color: 'var(--s2)' },
          ]}
          table={{
            columns: [
              { key: 'month', label: 'Month', format: (m) => MONTH_NAMES[m - 1] },
              { key: 'fixed', label: 'Fixed', num: true, format: money },
              { key: 'variable', label: 'Variable', num: true, format: money },
              { key: 'total', label: 'Total', num: true, format: money },
            ],
            rows: monthly,
          }}
        >
          <BarsChart
            data={monthly}
            xKey="month"
            stacked
            xFormat={(m) => MONTH_NAMES[m - 1]}
            series={[
              { key: 'fixed', label: 'Fixed', color: 'var(--s1)' },
              { key: 'variable', label: 'Variable', color: 'var(--s2)' },
            ]}
          />
        </ChartCard>
      )}

      {editing && (
        <Modal title={editing.item ? 'Edit budget line' : 'Add budget line'} onClose={() => setEditing(null)}>
          <LineForm year={year} initial={editing.item} index={editing.index} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}

function Track({ year }) {
  const { data, today } = useData();
  const { items } = useBudget(year);
  const isCurrent = today.startsWith(year);
  const [period, setPeriod] = usePref('budget.period', 'month');
  const [month, setMonth] = useState(isCurrent ? Number(today.slice(5, 7)) : 12);
  const [category, setCategory] = useState('');
  const m = period === 'month' ? month : null;

  const report = useMemo(() => budgetVsActual(items, data.records.expenses, { year: Number(year), month: m, today }), [items, data.records.expenses, year, m, today]);
  const burn = useMemo(() => burnDown(items, data.records.expenses, { year: Number(year), month: m, today, category: category || null }), [items, data.records.expenses, year, m, today, category]);
  const t = report.totals;
  const paceDiff = t.actual - t.expected;

  if (!items.length) {
    return (
      <Card>
        <Empty title={`No ${year} budget yet`}>Create a plan on the Plan tab to compare against actual spending.</Empty>
      </Card>
    );
  }

  return (
    <div className="stack">
      <div className="filter-bar">
        <Segmented value={period} onChange={setPeriod} options={[{ value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }]} label="Period" />
        {period === 'month' && <Select small value={String(month)} onChange={(v) => setMonth(Number(v))} options={ALL.map((x) => ({ value: String(x), label: `${MONTH_NAMES[x - 1]} ${year}` }))} aria-label="Month" style={{ width: 'auto' }} />}
      </div>
      <div className="tiles">
        <Stat label="Budget" value={dollars(t.budget)} sub={period === 'month' ? `${MONTH_NAMES[month - 1]} ${year}` : `${year}`} />
        <Stat label="Spent" value={dollars(t.actual)} sub={t.budget ? `${pct(t.used, 0)} of budget` : ''} />
        <Stat label={t.remaining >= 0 ? 'Remaining' : 'Over budget'} value={dollars(Math.abs(t.remaining))} sub={report.elapsed < 1 && report.elapsed > 0 ? `${pct(1 - report.elapsed, 0)} of the ${period} left` : ''} />
        <Stat
          label="Pace"
          value={report.elapsed === 0 ? '—' : Math.abs(paceDiff) < 1 ? 'On track' : paceDiff > 0 ? `${dollars(paceDiff)} over` : `${dollars(-paceDiff)} under`}
          sub={report.elapsed === 0 ? 'Period has not started' : `Planned ${dollars(t.expected)} by ${report.elapsed >= 1 ? 'period end' : 'today'}`}
        />
      </div>

      <ChartCard
        title="Burn-down"
        subtitle="Budget remaining as you spend, against the planned pace"
        legend={[
          { label: 'Remaining (actual)', color: 'var(--s1)', type: 'line' },
          { label: 'Planned', color: 'var(--neutral-series)', type: 'dashed' },
        ]}
        actions={<Select small value={category} onChange={setCategory} options={report.rows.filter((r) => r.budget > 0).map((r) => ({ value: r.category, label: r.category }))} placeholder="All categories" aria-label="Category" style={{ width: 'auto' }} />}
      >
        <TimeChart
          data={burn.points}
          xKey="label"
          zeroLine
          labelFormat={(l, p) => (period === 'month' ? (l === '0' ? 'Start' : formatDate(p?.key)) : l)}
          series={[
            { key: 'planned', label: 'Planned', color: 'var(--neutral-series)', dashed: true },
            { key: 'remaining', label: 'Remaining', color: 'var(--s1)' },
          ]}
        />
      </ChartCard>

      <Card title="By category" subtitle="The tick marks where spending should be by today">
        <div className="list">
          {report.rows.map((r) => {
            const over = r.budget > 0 && r.actual > r.budget;
            return (
              <div className="list-item" key={r.category} style={{ display: 'block' }}>
                <div className="row between" style={{ marginBottom: 6 }}>
                  <span className="cell-main">
                    {r.category}{' '}
                    {r.budget === 0 && r.actual > 0 && <span className="badge warn">unbudgeted</span>}
                    {over && <span className="badge bad">over by {dollars(r.actual - r.budget)}</span>}
                  </span>
                  <span className="small tabular">
                    <strong>{dollars(r.actual)}</strong> <span className="muted">of {dollars(r.budget)}</span>
                  </span>
                </div>
                <Meter value={r.actual} max={r.budget} pace={report.elapsed > 0 && report.elapsed < 1 ? r.expected : null} label={`${r.category} spending`} />
                {r.subs.length > 0 && r.subs.some((s) => s.budget > 0) && (
                  <div className="small muted" style={{ marginTop: 4 }}>
                    {r.subs.map((s) => `${s.subcategory}: ${dollars(s.actual)}${s.budget ? ` / ${dollars(s.budget)}` : ''}`).join(' · ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function NextYear({ year }) {
  const { data, today, saveConfig } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const settings = data.config.settings;
  const target = String(Number(year) + 1);
  const isCurrent = today.startsWith(year);
  const [basis, setBasis] = useState(isCurrent ? 'trailing' : 'calendar');
  const [adj, setAdj] = useState(settings.budget.projectionAdjustment);
  const [catAdj, setCatAdj] = useState(settings.budget.categoryAdjustments || {});

  const proj = useMemo(
    () => projectSpending(data.records.expenses, { basis, today, year: Number(year), adjustment: Number(adj) || 0, categoryAdjustments: catAdj }),
    [data.records.expenses, basis, today, year, adj, catAdj],
  );
  const existing = data.config.budgets[target];

  const persist = async (nextAdj = adj, nextCat = catAdj) => {
    const clean = Object.fromEntries(Object.entries(nextCat).filter(([, v]) => v !== '' && v !== null && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)]));
    await saveConfig('settings', { ...settings, budget: { ...settings.budget, projectionAdjustment: Number(nextAdj) || 0, categoryAdjustments: clean } });
  };

  const create = async () => {
    if (existing && !(await confirm({ title: `Replace the ${target} budget?`, message: `${target} already has ${existing.items.length} lines. They will be replaced with this projection.`, confirmLabel: 'Replace', danger: true }))) return;
    const current = data.config.budgets[year]?.items || [];
    const items = proj.rows
      .filter((r) => r.projected > 0)
      .map((r) => {
        const prev = current.find((c) => lower(c.category) === lower(r.category) && !c.subcategory);
        return { category: r.category, subcategory: '', kind: prev?.kind || 'variable', annual: Math.round(r.projected), ...(prev?.months ? { months: prev.months } : {}) };
      });
    await persist();
    await saveConfig('budgets', { ...data.config.budgets, [target]: { items } });
    toast(`Created ${target} budget with ${items.length} lines`);
  };

  return (
    <div className="stack">
      <Card title={`Project ${target} spending`} subtitle="Start from one year of actual spending and adjust by a percentage">
        <div className="form-grid" style={{ maxWidth: 640 }}>
          <Field label="Based on">
            <Segmented
              value={basis}
              onChange={setBasis}
              options={[
                { value: 'trailing', label: 'Last 12 months' },
                { value: 'calendar', label: `${year} actual` },
              ]}
            />
          </Field>
          <Field label="Adjust all categories by" hint="e.g. 3 for inflation; override per category below">
            <PercentInput value={adj} onChange={setAdj} onBlur={() => persist()} />
          </Field>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          {formatDate(proj.start)} – {formatDate(proj.end)}
          {proj.factor !== 1 && proj.coveredDays ? ` · only ${Math.round(proj.coveredDays / 30.4)} months of data, scaled up to a full year` : ''}
        </p>
      </Card>

      <Card flush>
        {proj.rows.length === 0 ? (
          <Empty title="No spending in this period">Log expenses to project next year's budget.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">{basis === 'trailing' ? 'Last 12 mo' : year}</th>
                  <th className="num" style={{ width: 120 }}>
                    Adjust
                  </th>
                  <th className="num">{target} projected</th>
                  {existing && <th className="num hide-mobile">{target} budget</th>}
                </tr>
              </thead>
              <tbody>
                {proj.rows.map((r) => {
                  const key = Object.keys(catAdj).find((k) => lower(k) === lower(r.category)) || r.category;
                  const budgeted = existing?.items.filter((i) => lower(i.category) === lower(r.category)).reduce((s, i) => s + i.annual, 0);
                  return (
                    <tr key={r.category}>
                      <td className="cell-main">{r.category}</td>
                      <td className="num">{dollars(r.basis)}</td>
                      <td className="num">
                        <PercentInput
                          value={catAdj[key] ?? ''}
                          placeholder={String(adj)}
                          onChange={(v) => setCatAdj((c) => ({ ...c, [key]: v }))}
                          onBlur={() => persist()}
                          aria-label={`${r.category} adjustment`}
                          style={{ height: 32, textAlign: 'right' }}
                        />
                      </td>
                      <td className="num">
                        <strong>{dollars(r.projected)}</strong>
                      </td>
                      {existing && <td className="num hide-mobile">{budgeted ? dollars(budgeted) : '—'}</td>}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="num">{dollars(proj.totals.basis)}</td>
                  <td className="num muted">{proj.totals.basis ? `${(((proj.totals.projected / proj.totals.basis) - 1) * 100).toFixed(1)}%` : ''}</td>
                  <td className="num">{dollars(proj.totals.projected)}</td>
                  {existing && <td className="num hide-mobile">{dollars(budgetTotals(existing.items).total)}</td>}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      {proj.rows.length > 0 && (
        <div className="form-actions">
          <button className="btn primary" onClick={create}>
            {existing ? `Replace ${target} budget with this projection` : `Create ${target} budget from this projection`}
          </button>
          <span className="small muted">Fixed/variable types and due months carry over from {year} where they exist.</span>
        </div>
      )}
    </div>
  );
}

export default function Budget() {
  const { data, today } = useData();
  const [year, setYear] = useState(today.slice(0, 4));
  const [tab, setTab] = usePref('budget.tab', 'track');
  const hasBudget = !!data.config.budgets[year];
  const activeTab = !hasBudget && tab === 'track' ? 'plan' : tab;

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn icon sm" onClick={() => setYear(String(Number(year) - 1))} aria-label="Previous year">
          <IconChevronLeft />
        </button>
        <h2 style={{ minWidth: 56, textAlign: 'center' }}>{year}</h2>
        <button className="btn icon sm" onClick={() => setYear(String(Number(year) + 1))} aria-label="Next year">
          <IconChevronRight />
        </button>
        {year !== today.slice(0, 4) && (
          <button className="btn sm ghost" onClick={() => setYear(today.slice(0, 4))}>
            This year
          </button>
        )}
      </div>
      <Tabs
        value={activeTab}
        onChange={setTab}
        options={[
          { value: 'track', label: 'Budget vs actual' },
          { value: 'plan', label: 'Plan' },
          { value: 'next', label: `Project ${Number(year) + 1}` },
        ]}
      />
      {activeTab === 'plan' && <Plan year={year} setTab={setTab} />}
      {activeTab === 'track' && <Track year={year} />}
      {activeTab === 'next' && <NextYear year={year} />}
    </div>
  );
}
