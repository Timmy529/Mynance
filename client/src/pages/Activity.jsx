import { useMemo, useState } from 'react';
import { useData, usePref } from '../store.jsx';
import { useForms } from '../App.jsx';
import { Card, Select, Empty, Stat } from '../components/ui.jsx';
import { IconPlus, IconDownload } from '../components/icons.jsx';
import { money, dollars } from '../lib/format.js';
import { monthKey, monthLabelLong, formatDate } from '../lib/dates.js';
import { accountOptions, activityCategoryOptions } from '../lib/options.js';
import { periodRange, periodOptions } from './Expenses.jsx';

const lower = (s) => String(s ?? '').toLowerCase();

export default function Activity() {
  const { data, today } = useData();
  const openForm = useForms();
  const [period, setPeriod] = usePref('activity.period', 'ytd');
  const [account, setAccount] = useState('');
  const [category, setCategory] = useState('');
  const [start, end] = periodRange(period, today);

  const incomeCats = new Set(data.config.categories.activity.filter((c) => c.countsAsIncome).map((c) => lower(c.name)));

  const filtered = useMemo(
    () =>
      data.records.activity
        .filter((a) => (!start || a.date >= start) && (!end || a.date <= end))
        .filter((a) => !account || lower(a.account) === lower(account))
        .filter((a) => !category || lower(a.category) === lower(category))
        .slice()
        .reverse(),
    [data.records.activity, start, end, account, category],
  );

  const moneyIn = filtered.filter((a) => a.amount > 0).reduce((s, a) => s + a.amount, 0);
  const moneyOut = filtered.filter((a) => a.amount < 0).reduce((s, a) => s + a.amount, 0);
  const income = filtered.filter((a) => incomeCats.has(lower(a.category)) && a.amount > 0).reduce((s, a) => s + a.amount, 0);

  const groups = useMemo(() => {
    const out = [];
    for (const a of filtered.slice(0, 300)) {
      const k = monthKey(a.date);
      let g = out[out.length - 1];
      if (!g || g.key !== k) out.push((g = { key: k, items: [] }));
      g.items.push(a);
    }
    return out;
  }, [filtered]);

  return (
    <div className="stack">
      <p className="small ink-2">
        Money moving in or out of an account that isn’t an expense: deposits, transfers, contributions, credit card payments, interest. Activity in an
        income category ({data.config.categories.activity.filter((c) => c.countsAsIncome).map((c) => c.name).join(', ') || 'none set'}) counts toward income.
      </p>
      <div className="filter-bar">
        <Select small value={period} onChange={setPeriod} options={periodOptions(data.records.activity)} aria-label="Period" style={{ width: 'auto' }} />
        <Select small value={account} onChange={setAccount} options={accountOptions(data.config, { keep: account })} placeholder="All accounts" aria-label="Account" style={{ width: 'auto' }} />
        <Select small value={category} onChange={setCategory} options={activityCategoryOptions(data.config, category)} placeholder="All categories" aria-label="Category" style={{ width: 'auto' }} />
        <span className="spacer" />
        <a className="btn sm ghost" href="/api/export/activity.csv" download>
          <IconDownload /> CSV
        </a>
        <button className="btn primary sm" onClick={() => openForm('activity')}>
          <IconPlus /> Add activity
        </button>
      </div>

      <div className="tiles">
        <Stat label="Money in" value={dollars(moneyIn)} />
        <Stat label="Money out" value={dollars(-moneyOut)} />
        <Stat label="Counted as income" value={dollars(income)} />
      </div>

      <Card flush>
        {filtered.length === 0 ? (
          <Empty title="No account activity here" action={<button className="btn primary" onClick={() => openForm('activity')}>Add activity</button>} />
        ) : (
          <div style={{ padding: '0 20px 8px' }}>
            {groups.map((g) => (
              <div key={g.key}>
                <div className="list-group-head">
                  <span>{monthLabelLong(g.key)}</span>
                </div>
                {g.items.map((a) => (
                  <div className="list-item clickable" key={a.id} onClick={() => openForm('activity', a)} role="button" tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && openForm('activity', a)}>
                    <div className="grow">
                      <div className="title">
                        {a.account} <span className="badge">{a.category}</span>
                        {incomeCats.has(lower(a.category)) && <span className="badge good" style={{ marginLeft: 4 }}>income</span>}
                      </div>
                      <div className="sub">
                        {formatDate(a.date, { year: false })}
                        {a.notes ? ` · ${a.notes}` : ''}
                      </div>
                    </div>
                    <div className={`amount ${a.amount > 0 ? 'good' : ''}`}>{a.amount > 0 ? `+${money(a.amount)}` : money(a.amount)}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
