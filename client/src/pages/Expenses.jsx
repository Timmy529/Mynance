import { useMemo, useState } from 'react';
import { useData, usePref } from '../store.jsx';
import { useForms } from '../App.jsx';
import { Card, Select, Empty, Stat } from '../components/ui.jsx';
import { IconPlus, IconDownload, IconSearch } from '../components/icons.jsx';
import { money, dollars } from '../lib/format.js';
import { monthKey, monthLabelLong, formatDate, addMonthKey, monthEnd } from '../lib/dates.js';
import { allPaymentMethodNames } from '../lib/options.js';

const lower = (s) => String(s ?? '').toLowerCase();

export function periodRange(period, today) {
  const y = today.slice(0, 4);
  const thisMonth = monthKey(today);
  switch (period) {
    case 'month':
      return [`${thisMonth}-01`, today];
    case 'last-month': {
      const k = addMonthKey(thisMonth, -1);
      return [`${k}-01`, monthEnd(k)];
    }
    case 'ytd':
      return [`${y}-01-01`, today];
    case '12m':
      return [`${addMonthKey(thisMonth, -11)}-01`, today];
    case 'all':
      return [null, null];
    default:
      if (/^\d{4}$/.test(period)) return [`${period}-01-01`, `${period}-12-31`];
      return [null, null];
  }
}

export function periodOptions(records) {
  const years = [...new Set(records.map((r) => r.date?.slice(0, 4)).filter(Boolean))].sort().reverse();
  return [
    { value: 'month', label: 'This month' },
    { value: 'last-month', label: 'Last month' },
    { value: 'ytd', label: 'Year to date' },
    { value: '12m', label: 'Last 12 months' },
    { value: 'all', label: 'All time' },
    ...years.map((y) => ({ value: y, label: y })),
  ];
}

const PAGE = 150;

export default function Expenses() {
  const { data, today } = useData();
  const openForm = useForms();
  const [period, setPeriod] = usePref('expenses.period', 'month');
  const [category, setCategory] = useState('');
  const [method, setMethod] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const [start, end] = periodRange(period, today);
  const filtered = useMemo(() => {
    const query = lower(q.trim());
    return data.records.expenses
      .filter((e) => (!start || e.date >= start) && (!end || e.date <= end))
      .filter((e) => !category || lower(e.category) === lower(category))
      .filter((e) => !method || lower(e.payment_method) === lower(method))
      .filter((e) => !query || [e.vendor, e.notes, e.category, e.subcategory, e.payment_method].some((v) => lower(v).includes(query)) || String(e.amount).includes(query))
      .slice()
      .reverse();
  }, [data.records.expenses, start, end, category, method, q]);

  const total = filtered.reduce((s, e) => s + (e.amount || 0), 0);
  const byCat = useMemo(() => {
    const m = new Map();
    for (const e of filtered) m.set(e.category, (m.get(e.category) || 0) + (e.amount || 0));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const groups = useMemo(() => {
    const out = [];
    for (const e of filtered.slice(0, limit)) {
      const k = monthKey(e.date);
      let g = out[out.length - 1];
      if (!g || g.key !== k) {
        g = { key: k, items: [], total: 0 };
        out.push(g);
      }
      g.items.push(e);
    }
    const totals = new Map();
    for (const e of filtered) totals.set(monthKey(e.date), (totals.get(monthKey(e.date)) || 0) + (e.amount || 0));
    for (const g of out) g.total = totals.get(g.key);
    return out;
  }, [filtered, limit]);

  const cats = data.config.categories.expense.map((c) => ({ value: c.name, label: c.name }));
  const methods = allPaymentMethodNames(data.config).map((n) => ({ value: n, label: n }));

  return (
    <div className="stack">
      <div className="filter-bar">
        <Select small value={period} onChange={(v) => { setPeriod(v); setLimit(PAGE); }} options={periodOptions(data.records.expenses)} aria-label="Period" style={{ width: 'auto' }} />
        <Select small value={category} onChange={setCategory} options={cats} placeholder="All categories" aria-label="Category" style={{ width: 'auto' }} />
        <Select small value={method} onChange={setMethod} options={methods} placeholder="All payment methods" aria-label="Payment method" style={{ width: 'auto' }} />
        <div className="input-prefix" style={{ flex: '1 1 180px', maxWidth: 320 }}>
          <span style={{ display: 'flex' }}>
            <IconSearch width={15} height={15} />
          </span>
          <input className="input sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendor, notes…" aria-label="Search" />
        </div>
        <span className="spacer" />
        <a className="btn sm ghost" href="/api/export/expenses.csv" download>
          <IconDownload /> CSV
        </a>
        <button className="btn primary sm" onClick={() => openForm('expense')}>
          <IconPlus /> Add expense
        </button>
      </div>

      <div className="tiles">
        <Stat label="Total" value={dollars(total)} sub={`${filtered.length} expense${filtered.length === 1 ? '' : 's'}`} />
        {byCat.slice(0, 3).map(([name, v]) => (
          <Stat key={name} label={name} value={dollars(v)} sub={total ? `${((v / total) * 100).toFixed(0)}% of total` : ''} onClick={() => setCategory(name)} />
        ))}
      </div>

      <Card flush>
        {filtered.length === 0 ? (
          <Empty title="No expenses here" action={<button className="btn primary" onClick={() => openForm('expense')}>Add an expense</button>}>
            {data.records.expenses.length ? 'Try a different period or filter.' : 'Log your first expense to start tracking spending.'}
          </Empty>
        ) : (
          <div style={{ padding: '0 20px 8px' }}>
            {groups.map((g) => (
              <div key={g.key}>
                <div className="list-group-head">
                  <span>{monthLabelLong(g.key)}</span>
                  <span className="tabular">{money(g.total)}</span>
                </div>
                {g.items.map((e) => (
                  <div className="list-item clickable" key={e.id} onClick={() => openForm('expense', e)} role="button" tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && openForm('expense', e)}>
                    <div className="grow">
                      <div className="title">{e.vendor}</div>
                      <div className="sub">
                        {formatDate(e.date, { year: false })} · {e.category}
                        {e.subcategory ? ` › ${e.subcategory}` : ''} · {e.payment_method}
                        {e.notes ? ` · ${e.notes}` : ''}
                      </div>
                    </div>
                    <div className={`amount ${e.amount < 0 ? 'good' : ''}`}>{money(e.amount)}</div>
                  </div>
                ))}
              </div>
            ))}
            {filtered.length > limit && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <button className="btn" onClick={() => setLimit((l) => l + PAGE)}>
                  Show more ({filtered.length - limit} left)
                </button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
