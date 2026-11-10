import { useEffect, useMemo, useState } from 'react';
import { useData, useToast, usePref } from '../store.jsx';
import { Card, Field, MoneyInput, Modal, Select, Tabs, Empty, useConfirm, useSaving } from '../components/ui.jsx';
import { ChartCard, TimeChart } from '../components/charts.jsx';
import { ACCOUNT_GROUPS, accountTypeInfo } from '@shared/accountTypes.js';
import { buildBalanceIndex, valueAsOf } from '../lib/balances.js';
import { dollars, money } from '../lib/format.js';
import { formatDate, addDays } from '../lib/dates.js';

const lower = (s) => String(s ?? '').toLowerCase();

function UpdateBalances() {
  const { data, today, saveBalances } = useData();
  const toast = useToast();
  const { saving, error, run } = useSaving();
  const [date, setDate] = useState(today);
  const [values, setValues] = useState({});
  const index = useMemo(() => buildBalanceIndex(data.records.balances), [data.records.balances]);
  const accounts = data.config.accounts.filter((a) => !a.archived);

  // Prefill with anything already recorded on the chosen date.
  useEffect(() => {
    const v = {};
    for (const b of data.records.balances) {
      if (b.date === date) v[lower(b.account)] = { balance: b.balance ?? '', contributed: b.contributed ?? '', saved: true };
    }
    setValues(v);
  }, [date, data.records.balances]);

  const set = (acc, k, val) => setValues((v) => ({ ...v, [lower(acc)]: { ...v[lower(acc)], [k]: val, saved: false } }));
  const entries = accounts
    .map((a) => ({ a, v: values[lower(a.name)] }))
    .filter(({ v }) => v && !v.saved && v.balance !== '' && v.balance !== undefined);

  const save = async () => {
    const records = entries.map(({ a, v }) => ({
      date,
      account: a.name,
      balance: v.balance,
      contributed: accountTypeInfo(a.type).investment && v.contributed !== '' ? v.contributed : null,
    }));
    const ok = await run(() => saveBalances(records)).catch(() => false);
    if (ok) toast(`Saved ${records.length} balance${records.length > 1 ? 's' : ''} for ${formatDate(date)}`);
  };

  const groups = Object.keys(ACCOUNT_GROUPS)
    .map((g) => ({ g, label: ACCOUNT_GROUPS[g], list: accounts.filter((a) => accountTypeInfo(a.type).group === g) }))
    .filter((x) => x.list.length);

  if (!accounts.length) {
    return (
      <Card>
        <Empty title="No accounts yet" action={<a className="btn primary" href="#/settings?tab=accounts">Add accounts</a>}>
          Add your checking, savings, credit card, investment, home and mortgage accounts first.
        </Empty>
      </Card>
    );
  }

  return (
    <Card
      title="Record balances"
      subtitle="Enter today's value for any account that changed. Credit cards, mortgages and loans: enter the amount owed. Investment accounts also take the total you've contributed."
    >
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 180 }} aria-label="Date" />
        <button className={`chip ${date === today ? 'on' : ''}`} onClick={() => setDate(today)}>
          Today
        </button>
        <button className={`chip ${date === addDays(today, -1) ? 'on' : ''}`} onClick={() => setDate(addDays(today, -1))}>
          Yesterday
        </button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Account</th>
              <th className="num hide-mobile">Last recorded</th>
              <th style={{ minWidth: 130 }}>Balance</th>
              <th className="hide-mobile" style={{ minWidth: 130 }}>Contributed</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ g, label, list }) => (
              <FragmentGroup key={g} label={label}>
                {list.map((a) => {
                  const info = accountTypeInfo(a.type);
                  const last = valueAsOf(index, a.name, date);
                  const prior = last && last.date === date ? valueAsOf(index, a.name, addDays(date, -1)) : last;
                  const v = values[lower(a.name)] || {};
                  return (
                    <tr key={a.name}>
                      <td>
                        <div className="cell-main">{a.name}</div>
                        <div className="cell-sub">
                          {info.label}
                          <span className="hide-desktop">{prior ? ` · last ${dollars(prior.balance)}` : ''}</span>
                        </div>
                      </td>
                      <td className="num hide-mobile">
                        {prior ? (
                          <>
                            <div>{money(prior.balance)}</div>
                            <div className="cell-sub">{formatDate(prior.date)}</div>
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                          <MoneyInput value={v.balance ?? ''} onChange={(x) => set(a.name, 'balance', x)} placeholder={prior ? String(prior.balance) : '0.00'} aria-label={`${a.name} balance`} />
                          {prior && (v.balance === undefined || v.balance === '') && (
                            <button className="btn sm ghost" title="Same as last" onClick={() => set(a.name, 'balance', prior.balance)}>
                              =
                            </button>
                          )}
                        </div>
                        {info.investment && (
                          <div className="hide-desktop" style={{ marginTop: 6 }}>
                            <div className="cell-sub">Total contributed</div>
                            <MoneyInput value={v.contributed ?? ''} onChange={(x) => set(a.name, 'contributed', x)} placeholder={prior?.contributed !== null && prior?.contributed !== undefined ? String(prior.contributed) : 'optional'} aria-label={`${a.name} contributed`} />
                          </div>
                        )}
                        {v.saved && <div className="cell-sub good">saved</div>}
                      </td>
                      <td className="hide-mobile">
                        {info.investment ? (
                          <MoneyInput value={v.contributed ?? ''} onChange={(x) => set(a.name, 'contributed', x)} placeholder={prior?.contributed !== null && prior?.contributed !== undefined ? String(prior.contributed) : 'optional'} aria-label={`${a.name} contributed`} />
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </FragmentGroup>
            ))}
          </tbody>
        </table>
      </div>
      {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
      <div className="form-actions" style={{ marginTop: 14 }}>
        <button className="btn primary" disabled={!entries.length || saving} onClick={save}>
          {saving ? 'Saving…' : entries.length ? `Save ${entries.length} balance${entries.length > 1 ? 's' : ''}` : 'Save balances'}
        </button>
        <span className="small muted">Leave a row blank to keep its last value. Contributed carries forward if left blank.</span>
      </div>
    </Card>
  );
}

function FragmentGroup({ label, children }) {
  return (
    <>
      <tr className="group">
        <td colSpan={4}>{label}</td>
      </tr>
      {children}
    </>
  );
}

function EditBalance({ record, onDone }) {
  const { update, remove } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const { saving, error, run } = useSaving();
  const [f, setF] = useState({ ...record });
  const submit = async (e) => {
    e.preventDefault();
    const ok = await run(() => update('balances', record.id, f)).catch(() => false);
    if (ok) {
      toast('Balance updated');
      onDone();
    }
  };
  const del = async () => {
    if (!(await confirm({ title: 'Delete this balance?', confirmLabel: 'Delete', danger: true }))) return;
    await remove('balances', record.id);
    toast('Balance deleted');
    onDone();
  };
  return (
    <form className="form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Date">
          <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="Balance">
          <MoneyInput value={f.balance} onChange={(v) => setF({ ...f, balance: v })} allowNegative />
        </Field>
        <Field label="Total contributed" hint="Investment accounts only">
          <MoneyInput value={f.contributed ?? ''} onChange={(v) => setF({ ...f, contributed: v === '' ? null : v })} />
        </Field>
        <Field label="Notes">
          <input className="input" value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        <button className="btn primary" type="submit" disabled={saving}>
          Save changes
        </button>
        <button className="btn ghost" type="button" onClick={onDone}>
          Cancel
        </button>
        <span className="spacer" />
        <button className="btn danger" type="button" onClick={del}>
          Delete
        </button>
      </div>
    </form>
  );
}

function History() {
  const { data } = useData();
  const accounts = data.config.accounts;
  const [account, setAccount] = usePref('balances.account', accounts[0]?.name || '');
  const [editing, setEditing] = useState(null);
  const acc = accounts.find((a) => lower(a.name) === lower(account)) || accounts[0];
  const info = acc ? accountTypeInfo(acc.type) : null;
  const rows = useMemo(() => {
    if (!acc) return [];
    const list = data.records.balances.filter((b) => lower(b.account) === lower(acc.name));
    let lastC = null;
    return list.map((b) => {
      if (b.contributed !== null) lastC = b.contributed;
      return { ...b, contributedCarried: lastC };
    });
  }, [data.records.balances, acc]);

  if (!acc) return <Card><Empty title="No accounts yet" /></Card>;

  return (
    <div className="stack">
      <div className="filter-bar">
        <Select small value={acc.name} onChange={setAccount} options={accounts.map((a) => ({ value: a.name, label: a.name + (a.archived ? ' (archived)' : '') }))} aria-label="Account" style={{ width: 'auto' }} />
      </div>
      <ChartCard
        title={acc.name}
        subtitle={`${info.label}${info.liability ? ' · amount owed' : ''}`}
        legend={info.investment ? [{ label: 'Value', color: 'var(--s1)', type: 'line' }, { label: 'Contributed', color: 'var(--s2)', type: 'line' }] : null}
      >
        {rows.length ? (
          <TimeChart
            data={rows.map((r) => ({ date: r.date, balance: r.balance, contributed: info.investment ? r.contributedCarried : undefined }))}
            xKey="date"
            xFormat={(d) => formatDate(d)}
            series={[
              { key: 'balance', label: info.investment ? 'Value' : 'Balance', color: 'var(--s1)', area: !info.investment },
              ...(info.investment ? [{ key: 'contributed', label: 'Contributed', color: 'var(--s2)', step: true }] : []),
            ]}
          />
        ) : (
          <Empty>No balances recorded for this account yet.</Empty>
        )}
      </ChartCard>
      <Card flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="num">Balance</th>
                {info.investment && <th className="num">Contributed</th>}
                <th className="hide-mobile">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .slice()
                .reverse()
                .map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => setEditing(r)}>
                    <td>{formatDate(r.date)}</td>
                    <td className="num">{money(r.balance)}</td>
                    {info.investment && <td className="num">{r.contributed === null ? <span className="muted">{r.contributedCarried === null ? '—' : money(r.contributedCarried)}</span> : money(r.contributed)}</td>}
                    <td className="hide-mobile muted">{r.notes}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
      {editing && (
        <Modal title={`Edit ${editing.account} balance`} onClose={() => setEditing(null)}>
          <EditBalance record={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}

export default function Balances() {
  const [tab, setTab] = usePref('balances.tab', 'update');
  return (
    <div>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'update', label: 'Record balances' },
          { value: 'history', label: 'History' },
        ]}
      />
      {tab === 'update' ? <UpdateBalances /> : <History />}
    </div>
  );
}
