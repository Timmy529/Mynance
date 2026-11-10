import { useEffect, useMemo, useRef, useState } from 'react';
import { useData, useToast, navigate } from '../store.jsx';
import { Card, Field, Modal, Select, Tabs, MoneyInput, Empty, useConfirm, useSaving } from '../components/ui.jsx';
import { IconPlus, IconDownload, IconUpload } from '../components/icons.jsx';
import { ACCOUNT_TYPES, ACCOUNT_GROUPS, accountTypeInfo, isPaymentMethodAccount } from '@shared/accountTypes.js';
import { ACCOUNT_TYPE_OPTIONS } from '../lib/options.js';
import { api } from '../api.js';
import { formatDate } from '../lib/dates.js';
import ImportPanel from './Import.jsx';

const lower = (s) => String(s ?? '').toLowerCase();

function PromptModal({ title, label, initial = '', hint, onSubmit, onClose, submitLabel = 'Save' }) {
  const [value, setValue] = useState(initial);
  const { saving, error, run } = useSaving();
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(() => onSubmit(value.trim())).then(() => true).catch(() => false);
          if (ok) onClose();
        }}
      >
        <Field label={label} hint={hint}>
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </Field>
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions">
          <button className="btn primary" type="submit" disabled={saving || !value.trim()}>
            {submitLabel}
          </button>
          <button className="btn ghost" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function useUsage() {
  const { data } = useData();
  return useMemo(() => {
    const count = (list, key) => {
      const m = new Map();
      for (const r of list) m.set(lower(r[key]), (m.get(lower(r[key])) || 0) + 1);
      return m;
    };
    const { expenses, activity, balances } = data.records;
    const method = count(expenses, 'payment_method');
    const acct = count(activity, 'account');
    const bal = count(balances, 'account');
    const cat = count(expenses, 'category');
    const sub = new Map();
    for (const e of expenses) sub.set(lower(`${e.category}|${e.subcategory}`), (sub.get(lower(`${e.category}|${e.subcategory}`)) || 0) + 1);
    const actCat = count(activity, 'category');
    const budgetCats = new Set(Object.values(data.config.budgets).flatMap((b) => b.items.map((i) => lower(i.category))));
    return {
      account: (n) => (method.get(lower(n)) || 0) + (acct.get(lower(n)) || 0) + (bal.get(lower(n)) || 0),
      method: (n) => method.get(lower(n)) || 0,
      category: (n) => (cat.get(lower(n)) || 0) + (budgetCats.has(lower(n)) ? 1 : 0),
      sub: (c, s) => sub.get(lower(`${c}|${s}`)) || 0,
      activityCategory: (n) => actCat.get(lower(n)) || 0,
    };
  }, [data]);
}

// ---------------- Accounts ----------------
function AccountForm({ initial, onDone }) {
  const { data, saveConfig, rename, saveBalances, today } = useData();
  const toast = useToast();
  const { saving, error, setError, run } = useSaving();
  const editing = !!initial;
  const [f, setF] = useState(() => ({ name: '', type: 'checking', institution: '', notes: '', ...(initial || {}) }));
  const [payment, setPayment] = useState(() => (initial ? isPaymentMethodAccount(initial) : !!ACCOUNT_TYPES.checking.payment));
  const [opening, setOpening] = useState({ balance: '', contributed: '', date: today });
  const info = accountTypeInfo(f.type);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    const name = f.name.trim();
    if (!name) return setError('Enter a name');
    const ok = await run(async () => {
      let accounts = data.config.accounts;
      if (editing && name !== initial.name) {
        const res = await rename({ kind: 'account', from: initial.name, to: name });
        accounts = res.config.accounts;
      }
      const acc = { name, type: f.type };
      if (f.institution?.trim()) acc.institution = f.institution.trim();
      if (f.notes?.trim()) acc.notes = f.notes.trim();
      if (payment !== !!info.payment) acc.isPaymentMethod = payment;
      if (initial?.archived) acc.archived = true;
      const next = editing ? accounts.map((a) => (lower(a.name) === lower(name) ? acc : a)) : [...accounts, acc];
      await saveConfig('accounts', next);
      if (!editing && opening.balance !== '') {
        await saveBalances([{ date: opening.date, account: name, balance: opening.balance, contributed: info.investment && opening.contributed !== '' ? opening.contributed : null }]);
      }
      return true;
    }).catch(() => false);
    if (ok) {
      toast(editing ? 'Account saved' : `Added ${name}`);
      onDone();
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Name" className="full">
          <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Chase Sapphire, Fidelity 401(k)" autoFocus />
        </Field>
        <Field label="Type">
          <Select
            value={f.type}
            onChange={(v) => {
              set('type', v);
              if (!editing) setPayment(!!ACCOUNT_TYPES[v].payment);
            }}
            options={ACCOUNT_TYPE_OPTIONS}
          />
        </Field>
        <Field label="Institution">
          <input className="input" value={f.institution || ''} onChange={(e) => set('institution', e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Notes" className="full">
          <input className="input" value={f.notes || ''} onChange={(e) => set('notes', e.target.value)} placeholder="Optional" />
        </Field>
        <label className="check full">
          <input type="checkbox" checked={payment} onChange={(e) => setPayment(e.target.checked)} />
          Show as a payment method for expenses
        </label>
      </div>
      <p className="small muted">
        {info.liability ? 'Liability: record the amount owed as a positive number.' : info.investment ? 'Investment account: record its value and the total you have contributed.' : info.group === 'home' ? 'Record the estimated market value. Track the loan as a separate Mortgage account.' : ''}
      </p>
      {!editing && (
        <div className="form-grid">
          <Field label={info.liability ? 'Current amount owed' : 'Current balance'} hint="Optional — records today's balance">
            <MoneyInput value={opening.balance} onChange={(v) => setOpening((o) => ({ ...o, balance: v }))} />
          </Field>
          {info.investment ? (
            <Field label="Total contributed so far" hint="Optional">
              <MoneyInput value={opening.contributed} onChange={(v) => setOpening((o) => ({ ...o, contributed: v }))} />
            </Field>
          ) : (
            <Field label="As of">
              <input className="input" type="date" value={opening.date} onChange={(e) => setOpening((o) => ({ ...o, date: e.target.value }))} />
            </Field>
          )}
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        <button className="btn primary" type="submit" disabled={saving}>
          {editing ? 'Save account' : 'Add account'}
        </button>
        <button className="btn ghost" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Accounts() {
  const { data, saveConfig, saveBalances, today } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const usage = useUsage();
  const [editing, setEditing] = useState(null);
  const accounts = data.config.accounts;

  const toggleArchive = async (acc) => {
    if (!acc.archived) {
      const yes = await confirm({
        title: `Archive ${acc.name}?`,
        message: 'Archived accounts are hidden from forms and the dashboard but keep their history. If the account is closed, record a final $0 balance so it stops counting toward net worth.',
        confirmLabel: 'Archive and record $0 today',
      });
      if (!yes) return;
      await saveBalances([{ date: today, account: acc.name, balance: 0, contributed: null }]);
    }
    await saveConfig('accounts', accounts.map((a) => (a === acc ? { ...a, archived: !a.archived || undefined } : a)));
    toast(acc.archived ? 'Account restored' : 'Account archived');
  };
  const del = async (acc) => {
    if (!(await confirm({ title: `Delete ${acc.name}?`, confirmLabel: 'Delete', danger: true }))) return;
    await saveConfig('accounts', accounts.filter((a) => a !== acc));
    toast('Account deleted');
  };

  const groups = Object.keys(ACCOUNT_GROUPS)
    .map((g) => ({ g, label: ACCOUNT_GROUPS[g], list: accounts.filter((a) => accountTypeInfo(a.type).group === g) }))
    .filter((x) => x.list.length);

  return (
    <Card
      title="Accounts"
      subtitle="Checking, savings, credit cards, investment and retirement accounts, your home and its mortgage"
      actions={
        <button className="btn primary sm" onClick={() => setEditing({})}>
          <IconPlus /> Add account
        </button>
      }
      flush
    >
      {!accounts.length ? (
        <Empty title="No accounts yet" action={<button className="btn primary" onClick={() => setEditing({})}>Add your first account</button>}>
          Tip: add a “Home” account for your home's value and a “Mortgage” account for the loan to track home equity. Have your history in a
          spreadsheet? <a href="#/settings?tab=import">Import it</a> and accounts are created for you.
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="hide-mobile">Type</th>
                <th className="hide-mobile">Pays expenses</th>
                <th className="num hide-mobile">Records</th>
                <th className="actions" />
              </tr>
            </thead>
            <tbody>
              {groups.map(({ g, label, list }) => (
                <AccountGroup key={g} label={label}>
                  {list.map((a) => {
                    const used = usage.account(a.name);
                    return (
                      <tr key={a.name} style={a.archived ? { opacity: 0.55 } : undefined}>
                        <td>
                          <div className="cell-main">
                            {a.name} {a.archived && <span className="badge">archived</span>}
                          </div>
                          <div className="cell-sub">
                            <span className="hide-desktop">{accountTypeInfo(a.type).label} · </span>
                            {a.institution}
                          </div>
                        </td>
                        <td className="hide-mobile">{accountTypeInfo(a.type).label}</td>
                        <td className="hide-mobile">{isPaymentMethodAccount(a) ? 'Yes' : ''}</td>
                        <td className="num hide-mobile">{used}</td>
                        <td className="actions">
                          <button className="btn sm ghost" onClick={() => setEditing({ account: a })}>
                            Edit
                          </button>
                          <button className="btn sm ghost" onClick={() => toggleArchive(a)}>
                            {a.archived ? 'Restore' : 'Archive'}
                          </button>
                          {used === 0 && (
                            <button className="btn sm ghost danger" onClick={() => del(a)}>
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </AccountGroup>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <Modal title={editing.account ? `Edit ${editing.account.name}` : 'Add account'} onClose={() => setEditing(null)}>
          <AccountForm initial={editing.account} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </Card>
  );
}

function AccountGroup({ label, children }) {
  return (
    <>
      <tr className="group">
        <td colSpan={5}>{label}</td>
      </tr>
      {children}
    </>
  );
}

// ---------------- Payment methods ----------------
function PaymentMethods() {
  const { data, saveConfig, rename } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const usage = useUsage();
  const [prompt, setPrompt] = useState(null);
  const list = data.config.paymentMethods;
  const accountMethods = data.config.accounts.filter((a) => isPaymentMethodAccount(a) && !a.archived);

  return (
    <Card
      title="Payment methods"
      subtitle="Accounts marked “pays expenses” appear automatically. Add other ways you pay here (cash, gift cards, Venmo…)."
      actions={
        <button className="btn primary sm" onClick={() => setPrompt({ mode: 'add' })}>
          <IconPlus /> Add method
        </button>
      }
    >
      <div className="section-title" style={{ marginBottom: 8 }}>
        From accounts
      </div>
      <div className="chips" style={{ marginBottom: 16 }}>
        {accountMethods.map((a) => (
          <span key={a.name} className="chip static">
            {a.name}
          </span>
        ))}
        {!accountMethods.length && <span className="muted small">No accounts are set to pay expenses.</span>}
      </div>
      <div className="section-title">Other methods</div>
      <div className="list">
        {list.map((p) => {
          const used = usage.method(p.name);
          return (
            <div className="list-item" key={p.name} style={p.archived ? { opacity: 0.55 } : undefined}>
              <div className="grow">
                <div className="title">
                  {p.name} {p.archived && <span className="badge">archived</span>}
                </div>
                <div className="sub">{used} expense{used === 1 ? '' : 's'}</div>
              </div>
              <button className="btn sm ghost" onClick={() => setPrompt({ mode: 'rename', item: p })}>
                Rename
              </button>
              <button
                className="btn sm ghost"
                onClick={async () => {
                  await saveConfig('paymentMethods', list.map((x) => (x === p ? { ...x, archived: !x.archived || undefined } : x)));
                  toast(p.archived ? 'Restored' : 'Archived');
                }}
              >
                {p.archived ? 'Restore' : 'Archive'}
              </button>
              {used === 0 && (
                <button
                  className="btn sm ghost danger"
                  onClick={async () => {
                    if (!(await confirm({ title: `Delete ${p.name}?`, confirmLabel: 'Delete', danger: true }))) return;
                    await saveConfig('paymentMethods', list.filter((x) => x !== p));
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          );
        })}
      </div>
      {prompt && (
        <PromptModal
          title={prompt.mode === 'add' ? 'Add payment method' : `Rename ${prompt.item.name}`}
          label="Name"
          initial={prompt.item?.name}
          hint={prompt.mode === 'rename' ? 'Every expense using this method is updated.' : undefined}
          onClose={() => setPrompt(null)}
          onSubmit={async (name) => {
            if (prompt.mode === 'add') await saveConfig('paymentMethods', [...list, { name }]);
            else await rename({ kind: 'paymentMethod', from: prompt.item.name, to: name });
            toast('Saved');
          }}
        />
      )}
    </Card>
  );
}

// ---------------- Expense categories ----------------
function ExpenseCategories() {
  const { data, saveConfig, rename } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const usage = useUsage();
  const [prompt, setPrompt] = useState(null);
  const cats = data.config.categories;
  const save = (expense) => saveConfig('categories', { ...cats, expense });
  const update = (cat, patch) => save(cats.expense.map((c) => (c === cat ? { ...c, ...patch } : c)));

  return (
    <Card
      title="Expense categories"
      subtitle="Categories and subcategories offered when logging expenses. “Not core” categories are left out of core spending averages."
      actions={
        <button className="btn primary sm" onClick={() => setPrompt({ mode: 'addCategory' })}>
          <IconPlus /> Add category
        </button>
      }
    >
      <div className="list">
        {cats.expense.map((c) => {
          const used = usage.category(c.name);
          return (
            <div key={c.name} className="list-item" style={{ display: 'block', opacity: c.archived ? 0.55 : 1 }}>
              <div className="row" style={{ marginBottom: 8 }}>
                <strong>{c.name}</strong>
                {c.archived && <span className="badge">archived</span>}
                {c.excludeFromCore && <span className="badge warn">not core</span>}
                <span className="muted small">{used} uses</span>
                <span className="spacer" />
                <label className="check small" title="Exclude from core spending">
                  <input type="checkbox" checked={!!c.excludeFromCore} onChange={(e) => update(c, { excludeFromCore: e.target.checked })} /> Not core
                </label>
                <button className="btn sm ghost" onClick={() => setPrompt({ mode: 'renameCategory', cat: c })}>
                  Rename
                </button>
                <button className="btn sm ghost" onClick={() => update(c, { archived: !c.archived || undefined })}>
                  {c.archived ? 'Restore' : 'Archive'}
                </button>
                {used === 0 && (
                  <button
                    className="btn sm ghost danger"
                    onClick={async () => {
                      if (!(await confirm({ title: `Delete ${c.name}?`, confirmLabel: 'Delete', danger: true }))) return;
                      await save(cats.expense.filter((x) => x !== c));
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
              <div className="chips">
                {c.subcategories.map((s) => {
                  const n = usage.sub(c.name, s);
                  return (
                    <span key={s} className="chip" title={`${n} expenses`}>
                      <button className="link-btn" style={{ color: 'inherit', fontWeight: 400 }} onClick={() => setPrompt({ mode: 'renameSub', cat: c, sub: s })}>
                        {s}
                      </button>
                      {n === 0 && (
                        <button className="link-btn muted" aria-label={`Remove ${s}`} onClick={() => update(c, { subcategories: c.subcategories.filter((x) => x !== s) })}>
                          ✕
                        </button>
                      )}
                    </span>
                  );
                })}
                <button className="chip" onClick={() => setPrompt({ mode: 'addSub', cat: c })}>
                  + subcategory
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {prompt && (
        <PromptModal
          title={
            { addCategory: 'Add category', renameCategory: `Rename ${prompt.cat?.name}`, addSub: `Add subcategory to ${prompt.cat?.name}`, renameSub: `Rename ${prompt.sub}` }[prompt.mode]
          }
          label={prompt.mode === 'addCategory' ? 'Category name' : 'Name'}
          initial={prompt.mode === 'renameCategory' ? prompt.cat.name : prompt.mode === 'renameSub' ? prompt.sub : ''}
          hint={prompt.mode.startsWith('rename') ? 'Every expense and budget line using it is updated.' : prompt.mode === 'addCategory' ? 'A "General" subcategory is added; add more after.' : undefined}
          onClose={() => setPrompt(null)}
          onSubmit={async (name) => {
            if (prompt.mode === 'addCategory') await save([...cats.expense, { name, subcategories: ['General'], excludeFromCore: false }]);
            if (prompt.mode === 'addSub') await update(prompt.cat, { subcategories: [...prompt.cat.subcategories, name] });
            if (prompt.mode === 'renameCategory') await rename({ kind: 'expenseCategory', from: prompt.cat.name, to: name });
            if (prompt.mode === 'renameSub') await rename({ kind: 'subcategory', parent: prompt.cat.name, from: prompt.sub, to: name });
            toast('Saved');
          }}
        />
      )}
    </Card>
  );
}

// ---------------- Activity categories ----------------
function ActivityCategories() {
  const { data, saveConfig, rename } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const usage = useUsage();
  const [prompt, setPrompt] = useState(null);
  const cats = data.config.categories;
  const save = (activity) => saveConfig('categories', { ...cats, activity });
  const update = (cat, patch) => save(cats.activity.map((c) => (c === cat ? { ...c, ...patch } : c)));
  return (
    <Card
      title="Account activity categories"
      subtitle="Used for deposits, transfers, contributions and other account activity. “Counts as income” adds it to income totals (paychecks are tracked separately on the Income page)."
      actions={
        <button className="btn primary sm" onClick={() => setPrompt({ mode: 'add' })}>
          <IconPlus /> Add category
        </button>
      }
    >
      <div className="list">
        {cats.activity.map((c) => {
          const used = usage.activityCategory(c.name);
          return (
            <div key={c.name} className="list-item" style={c.archived ? { opacity: 0.55 } : undefined}>
              <div className="grow">
                <div className="title">
                  {c.name} {c.countsAsIncome && <span className="badge good">income</span>} {c.archived && <span className="badge">archived</span>}
                </div>
                <div className="sub">{used} uses</div>
              </div>
              <label className="check small">
                <input type="checkbox" checked={!!c.countsAsIncome} onChange={(e) => update(c, { countsAsIncome: e.target.checked })} /> Income
              </label>
              <button className="btn sm ghost" onClick={() => setPrompt({ mode: 'rename', cat: c })}>
                Rename
              </button>
              <button className="btn sm ghost" onClick={() => update(c, { archived: !c.archived || undefined })}>
                {c.archived ? 'Restore' : 'Archive'}
              </button>
              {used === 0 && (
                <button
                  className="btn sm ghost danger"
                  onClick={async () => {
                    if (!(await confirm({ title: `Delete ${c.name}?`, confirmLabel: 'Delete', danger: true }))) return;
                    await save(cats.activity.filter((x) => x !== c));
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          );
        })}
      </div>
      {prompt && (
        <PromptModal
          title={prompt.mode === 'add' ? 'Add activity category' : `Rename ${prompt.cat.name}`}
          label="Name"
          initial={prompt.cat?.name}
          onClose={() => setPrompt(null)}
          onSubmit={async (name) => {
            if (prompt.mode === 'add') await save([...cats.activity, { name, countsAsIncome: false }]);
            else await rename({ kind: 'activityCategory', from: prompt.cat.name, to: name });
            toast('Saved');
          }}
        />
      )}
    </Card>
  );
}

// ---------------- Preferences ----------------
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'JPY', 'INR', 'MXN', 'BRL', 'SEK', 'NOK', 'DKK', 'ZAR', 'SGD'];
const LOCALES = ['en-US', 'en-GB', 'en-CA', 'en-AU', 'en-IN', 'de-DE', 'fr-FR', 'es-ES', 'es-MX', 'pt-BR', 'it-IT', 'nl-NL', 'ja-JP', 'sv-SE'];

function Preferences() {
  const { data, saveConfig } = useData();
  const toast = useToast();
  const s = data.config.settings;
  const save = async (patch) => {
    await saveConfig('settings', { ...s, ...patch });
    toast('Preferences saved');
  };
  return (
    <Card title="Preferences">
      <div className="form-grid" style={{ maxWidth: 640 }}>
        <Field label="Currency">
          <Select value={s.currency} onChange={(v) => save({ currency: v })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label="Number format">
          <Select value={s.locale} onChange={(v) => save({ locale: v })} options={LOCALES.map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label="Dashboard averages cover" hint="Monthly expense average, months of cash, averages card">
          <Select
            value={String(s.dashboard.averageMonths)}
            onChange={(v) => save({ dashboard: { ...s.dashboard, averageMonths: Number(v) } })}
            options={[3, 6, 12, 24].map((m) => ({ value: String(m), label: `Last ${m} months` }))}
          />
        </Field>
      </div>
      <p className="small muted" style={{ marginTop: 14 }}>
        Projection and retirement assumptions live on the <a href="#/projections">Projections</a> page. Light/dark theme is in the sidebar (or the More menu on mobile).
      </p>
    </Card>
  );
}

// ---------------- Backup ----------------
function Backup() {
  const { data, reload } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const load = () => api.get('/api/backups').then(setInfo).catch((e) => toast(e.message, 'error'));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createNow = async () => {
    setBusy(true);
    try {
      const b = await api.post('/api/backups');
      toast(`Backup saved: ${b.name}`);
      await load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (file) => {
    if (!file) return;
    const ok = await confirm({
      title: `Restore from ${file.name}?`,
      message: 'Your current data is backed up first, then replaced with the contents of this file.',
      confirmLabel: 'Restore',
      danger: true,
    });
    if (fileRef.current) fileRef.current.value = '';
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch('/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Restore failed');
      await reload();
      await load();
      toast(`Restored ${body.restored.length} files`);
      navigate('dashboard');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const files = [
    ['expenses', 'Expenses'],
    ['activity', 'Account activity'],
    ['balances', 'Balances'],
    ['paychecks', 'Paychecks'],
    ['salary', 'Salary'],
  ];

  return (
    <div className="stack">
      <Card title="Your data" subtitle="Everything is stored as plain CSV and JSON files you can open in a spreadsheet or text editor.">
        <dl className="kv" style={{ gridTemplateColumns: 'auto 1fr' }}>
          <dt>Data folder</dt>
          <dd style={{ textAlign: 'left', fontWeight: 500, wordBreak: 'break-all' }}>{data.meta?.dataDir}</dd>
          <dt>Backups folder</dt>
          <dd style={{ textAlign: 'left', fontWeight: 500, wordBreak: 'break-all' }}>{info?.dir || data.meta?.backupDir}</dd>
        </dl>
        <div className="row" style={{ marginTop: 14 }}>
          {files.map(([k, label]) => (
            <a key={k} className="btn sm" href={`/api/export/${k}.csv`} download>
              <IconDownload /> {label}
            </a>
          ))}
        </div>
      </Card>
      <Card title="Backups" subtitle={`A snapshot is taken automatically once a day when something changed; the newest ${info?.retention ?? 30} are kept.`}>
        <div className="row">
          <a className="btn primary" href="/api/backup" download>
            <IconDownload /> Download backup (.zip)
          </a>
          <button className="btn" onClick={createNow} disabled={busy}>
            Save a backup now
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
            <IconUpload /> Restore from .zip…
          </button>
          <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => restore(e.target.files?.[0])} />
        </div>
        <div className="list" style={{ marginTop: 12 }}>
          {info?.backups?.length ? (
            info.backups.map((b) => (
              <div className="list-item" key={b.name}>
                <div className="grow">
                  <div className="title">{b.name}</div>
                  <div className="sub">
                    {formatDate(b.created.slice(0, 10))} {b.created.slice(11, 16)} UTC · {(b.size / 1024).toFixed(1)} KB
                  </div>
                </div>
                <a className="btn sm ghost" href={`/api/backups/${encodeURIComponent(b.name)}`} download>
                  <IconDownload /> Download
                </a>
              </div>
            ))
          ) : (
            <p className="muted small">No backups yet.</p>
          )}
        </div>
      </Card>
    </div>
  );
}

export default function Settings({ params }) {
  const [tab, setTab] = useState(params?.tab || 'accounts');
  useEffect(() => {
    if (params?.tab) setTab(params.tab);
  }, [params?.tab]);
  return (
    <div>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'accounts', label: 'Accounts' },
          { value: 'methods', label: 'Payment methods' },
          { value: 'categories', label: 'Expense categories' },
          { value: 'activity', label: 'Activity categories' },
          { value: 'import', label: 'Import' },
          { value: 'preferences', label: 'Preferences' },
          { value: 'backup', label: 'Backup & data' },
        ]}
      />
      {tab === 'accounts' && <Accounts />}
      {tab === 'methods' && <PaymentMethods />}
      {tab === 'categories' && <ExpenseCategories />}
      {tab === 'activity' && <ActivityCategories />}
      {tab === 'import' && <ImportPanel />}
      {tab === 'preferences' && <Preferences />}
      {tab === 'backup' && <Backup />}
    </div>
  );
}
