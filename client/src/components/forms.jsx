import { useMemo, useState } from 'react';
import { useData, useToast, usePref } from '../store.jsx';
import { Field, MoneyInput, Select, Segmented, useConfirm, useSaving } from './ui.jsx';
import { paymentMethodOptions, expenseCategoryOptions, subcategoryOptions, activityCategoryOptions, accountOptions, findCategory } from '../lib/options.js';
import { addDays } from '../lib/dates.js';
import { paycheckTotals, nextPaycheckDate } from '../lib/spending.js';
import { money } from '../lib/format.js';

const lower = (s) => String(s ?? '').toLowerCase();

function DateField({ value, onChange, today, label = 'Date' }) {
  return (
    <Field label={label}>
      <input className="input" type="date" value={value} onChange={(e) => onChange(e.target.value)} required />
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className={`chip ${value === today ? 'on' : ''}`} onClick={() => onChange(today)}>
          Today
        </button>
        <button type="button" className={`chip ${value === addDays(today, -1) ? 'on' : ''}`} onClick={() => onChange(addDays(today, -1))}>
          Yesterday
        </button>
      </div>
    </Field>
  );
}

function FormFooter({ saving, error, editing, onDelete, onCancel, addAnother }) {
  return (
    <>
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        <button className="btn primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Save'}
        </button>
        {!editing && addAnother && (
          <button className="btn" type="submit" name="another" value="1" disabled={saving}>
            Save &amp; add another
          </button>
        )}
        <button className="btn ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
        <span className="spacer" />
        {editing && (
          <button className="btn danger" type="button" onClick={onDelete} disabled={saving}>
            Delete
          </button>
        )}
      </div>
    </>
  );
}

function useDelete(collection, record, onDone, what) {
  const { remove } = useData();
  const confirm = useConfirm();
  const toast = useToast();
  return async () => {
    if (!(await confirm({ title: `Delete ${what}?`, message: 'This cannot be undone (backups keep older copies).', confirmLabel: 'Delete', danger: true }))) return;
    await remove(collection, record.id);
    toast(`${what[0].toUpperCase()}${what.slice(1)} deleted`);
    onDone();
  };
}

// ---------------- Expense ----------------
export function ExpenseForm({ initial, onDone }) {
  const { data, create, update, today } = useData();
  const toast = useToast();
  const { saving, error, setError, run } = useSaving();
  const [lastMethod, setLastMethod] = usePref('lastPaymentMethod', '');
  const config = data.config;
  const editing = !!initial?.id;

  const methodGroups = paymentMethodOptions(config, initial?.payment_method);
  const methodNames = methodGroups.flatMap((g) => g.options.map((o) => o.value));
  const blank = () => ({
    date: initial?.date || today,
    amount: '',
    vendor: '',
    payment_method: methodNames.includes(lastMethod) ? lastMethod : '',
    category: '',
    subcategory: '',
    notes: '',
  });
  const [f, setF] = useState(() => (editing ? { ...initial } : { ...blank(), ...(initial || {}) }));
  const [touched, setTouched] = useState({});
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  // Last expense per vendor, to auto-fill category and payment method.
  const vendors = useMemo(() => {
    const m = new Map();
    for (const e of data.records.expenses) if (e.vendor) m.set(lower(e.vendor), e);
    return m;
  }, [data.records.expenses]);
  const vendorList = useMemo(() => [...new Set(data.records.expenses.map((e) => e.vendor).filter(Boolean))].sort(), [data.records.expenses]);

  const onVendor = (v) => {
    const prev = vendors.get(lower(v));
    setF((x) => {
      const next = { ...x, vendor: v };
      if (prev && !editing) {
        if (!touched.category) {
          next.category = prev.category;
          next.subcategory = prev.subcategory;
        }
        if (!touched.payment_method && methodNames.includes(prev.payment_method)) next.payment_method = prev.payment_method;
      }
      return next;
    });
  };

  const onCategory = (c) => {
    setTouched((t) => ({ ...t, category: true }));
    const subs = findCategory(config, c)?.subcategories || [];
    setF((x) => ({ ...x, category: c, subcategory: subs.length === 1 ? subs[0] : subs.includes(x.subcategory) ? x.subcategory : '' }));
  };

  const subs = subcategoryOptions(config, f.category);

  const submit = async (e) => {
    e.preventDefault();
    const another = e.nativeEvent.submitter?.name === 'another';
    if (f.amount === '' || f.amount === null) return setError('Enter an amount');
    if (!f.vendor.trim()) return setError('Enter a vendor');
    if (!f.payment_method) return setError('Choose a payment method');
    if (!f.category) return setError('Choose a category');
    if (subs.length && !f.subcategory) return setError('Choose a subcategory');
    const ok = await run(async () => {
      if (editing) await update('expenses', initial.id, f);
      else await create('expenses', f);
      return true;
    }).catch(() => false);
    if (!ok) return;
    setLastMethod(f.payment_method);
    toast(editing ? 'Expense updated' : `Saved ${money(Number(f.amount))} at ${f.vendor}`);
    if (another) {
      setF({ ...blank(), date: f.date, payment_method: f.payment_method });
      setTouched({});
      document.querySelector('#expense-amount')?.focus();
    } else onDone();
  };

  const onDelete = useDelete('expenses', initial || {}, onDone, 'expense');

  return (
    <form className="form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Amount" className="full" hint="Use a negative amount for a refund.">
          <MoneyInput id="expense-amount" big value={f.amount} onChange={(v) => set('amount', v)} allowNegative autoFocus />
        </Field>
        <Field label="Vendor" className="full">
          <input className="input" list="vendor-list" value={f.vendor} onChange={(e) => onVendor(e.target.value)} placeholder="Where did you spend it?" autoComplete="off" />
          <datalist id="vendor-list">
            {vendorList.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </Field>
        <Field label="Category">
          <Select value={f.category} onChange={onCategory} options={expenseCategoryOptions(config, initial?.category)} placeholder="Choose…" />
        </Field>
        <Field label="Subcategory">
          <Select value={f.subcategory} onChange={(v) => set('subcategory', v)} options={subs} placeholder={subs.length ? 'Choose…' : '—'} disabled={!subs.length} />
        </Field>
        <Field label="Payment method">
          <Select
            value={f.payment_method}
            onChange={(v) => {
              setTouched((t) => ({ ...t, payment_method: true }));
              set('payment_method', v);
            }}
            options={methodGroups}
            placeholder="Choose…"
          />
        </Field>
        <DateField value={f.date} onChange={(v) => set('date', v)} today={today} />
        <Field label="Notes" className="full">
          <input className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      {!methodNames.length && <div className="form-error">Add an account or payment method in Settings first.</div>}
      <FormFooter saving={saving} error={error} editing={editing} onDelete={onDelete} onCancel={onDone} addAnother />
    </form>
  );
}

// ---------------- Account activity ----------------
export function ActivityForm({ initial, onDone }) {
  const { data, create, update, today } = useData();
  const toast = useToast();
  const { saving, error, setError, run } = useSaving();
  const config = data.config;
  const editing = !!initial?.id;
  const [dir, setDir] = useState(initial?.amount < 0 ? 'out' : 'in');
  const [f, setF] = useState(() => ({
    date: today,
    account: '',
    category: '',
    notes: '',
    ...(initial || {}),
    amount: initial?.amount !== undefined && initial?.amount !== null ? Math.abs(initial.amount) : '',
  }));
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    const another = e.nativeEvent.submitter?.name === 'another';
    if (f.amount === '') return setError('Enter an amount');
    if (!f.account) return setError('Choose an account');
    if (!f.category) return setError('Choose a category');
    const rec = { ...f, amount: dir === 'out' ? -Math.abs(f.amount) : Math.abs(f.amount) };
    const ok = await run(async () => {
      if (editing) await update('activity', initial.id, rec);
      else await create('activity', rec);
      return true;
    }).catch(() => false);
    if (!ok) return;
    toast(editing ? 'Activity updated' : 'Activity saved');
    if (another) setF((x) => ({ ...x, amount: '', notes: '' }));
    else onDone();
  };
  const onDelete = useDelete('activity', initial || {}, onDone, 'activity');

  return (
    <form className="form" onSubmit={submit}>
      <Segmented
        value={dir}
        onChange={setDir}
        label="Direction"
        options={[
          { value: 'in', label: 'Money in (deposit, contribution, payment)' },
          { value: 'out', label: 'Money out (withdrawal, transfer out)' },
        ]}
      />
      <div className="form-grid">
        <Field label="Amount" className="full">
          <MoneyInput big value={f.amount} onChange={(v) => set('amount', v)} autoFocus />
        </Field>
        <Field label="Account">
          <Select value={f.account} onChange={(v) => set('account', v)} options={accountOptions(config, { keep: initial?.account })} placeholder="Choose…" />
        </Field>
        <Field label="Category">
          <Select value={f.category} onChange={(v) => set('category', v)} options={activityCategoryOptions(config, initial?.category)} placeholder="Choose…" />
        </Field>
        <DateField value={f.date} onChange={(v) => set('date', v)} today={today} />
        <Field label="Notes">
          <input className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      <FormFooter saving={saving} error={error} editing={editing} onDelete={onDelete} onCancel={onDone} addAnother />
    </form>
  );
}

// ---------------- Paycheck ----------------
const PAY_SECTIONS = [
  { title: 'Earnings', fields: [['gross', 'Gross pay'], ['bonus', 'Bonus']] },
  { title: 'Taxes', fields: [['federal_tax', 'Federal'], ['state_tax', 'State'], ['social_security', 'Social Security'], ['medicare', 'Medicare'], ['other_tax', 'Other / local']] },
  { title: 'Retirement & savings', fields: [['retirement_401k', '401(k)'], ['roth_401k', 'Roth 401(k)'], ['hsa', 'HSA']] },
  { title: 'Benefits', fields: [['medical', 'Medical'], ['dental', 'Dental'], ['vision', 'Vision'], ['other_deductions', 'Other deductions']] },
];
const PAY_KEYS = PAY_SECTIONS.flatMap((s) => s.fields.map(([k]) => k));

export function PaycheckForm({ initial, onDone }) {
  const { data, create, update, today } = useData();
  const toast = useToast();
  const { saving, error, setError, run } = useSaving();
  const editing = !!initial?.id;
  const previous = data.records.paychecks[data.records.paychecks.length - 1];

  // New paychecks start as a copy of the previous one, dated one pay period later.
  const [f, setF] = useState(() => {
    if (editing) return { ...initial };
    const base = { date: nextPaycheckDate(data.records.paychecks, today), employer: '', notes: '', net: '', employer_match: '' };
    for (const k of PAY_KEYS) base[k] = '';
    if (previous) {
      base.employer = previous.employer;
      for (const k of PAY_KEYS) base[k] = k === 'bonus' ? '' : previous[k] ?? '';
      base.employer_match = previous.employer_match ?? '';
    }
    return base;
  });
  const [netTouched, setNetTouched] = useState(editing);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const totals = paycheckTotals({ ...Object.fromEntries(PAY_KEYS.map((k) => [k, num(f[k])])), net: null });
  const netValue = netTouched ? f.net : Math.round(totals.computedNet * 100) / 100;
  const diff = netTouched && f.net !== '' ? Number(f.net) - totals.computedNet : 0;
  const employers = [...new Set(data.records.paychecks.map((p) => p.employer).filter(Boolean))];

  const submit = async (e) => {
    e.preventDefault();
    if (f.gross === '' || f.gross === null) return setError('Enter gross pay');
    const rec = { ...f, net: netValue === '' ? null : netValue };
    const ok = await run(async () => {
      if (editing) await update('paychecks', initial.id, rec);
      else await create('paychecks', rec);
      return true;
    }).catch(() => false);
    if (!ok) return;
    toast(editing ? 'Paycheck updated' : 'Paycheck saved');
    onDone();
  };
  const onDelete = useDelete('paychecks', initial || {}, onDone, 'paycheck');

  return (
    <form className="form" onSubmit={submit}>
      {!editing && previous && <div className="callout small">Pre-filled from your {previous.date} paycheck. Adjust anything that changed.</div>}
      <div className="form-grid">
        <Field label="Pay date">
          <input className="input" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} required />
        </Field>
        <Field label="Employer">
          <input className="input" list="employer-list" value={f.employer} onChange={(e) => set('employer', e.target.value)} />
          <datalist id="employer-list">
            {employers.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </Field>
      </div>
      {PAY_SECTIONS.map((s) => (
        <div key={s.title}>
          <div className="section-title" style={{ marginBottom: 8 }}>
            {s.title}
          </div>
          <div className="form-grid">
            {s.fields.map(([k, label]) => (
              <Field key={k} label={label}>
                <MoneyInput value={f[k]} onChange={(v) => set(k, v)} />
              </Field>
            ))}
          </div>
        </div>
      ))}
      <div className="form-grid">
        <Field label="Net pay (take-home)" hint={netTouched ? (Math.abs(diff) >= 0.01 ? `Differs from calculated ${money(totals.computedNet)} by ${money(diff)}` : 'Matches the calculated amount') : 'Calculated from the fields above. Type to override.'}>
          <MoneyInput
            value={netValue}
            onChange={(v) => {
              setNetTouched(v !== '');
              set('net', v);
            }}
          />
        </Field>
        <Field label="Employer 401(k) match" hint="Not deducted from pay; tracked for reference.">
          <MoneyInput value={f.employer_match} onChange={(v) => set('employer_match', v)} />
        </Field>
        <Field label="Notes" className="full">
          <input className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      <FormFooter saving={saving} error={error} editing={editing} onDelete={onDelete} onCancel={onDone} />
    </form>
  );
}

// ---------------- Salary ----------------
export function SalaryForm({ initial, onDone }) {
  const { data, create, update, today } = useData();
  const toast = useToast();
  const { saving, error, setError, run } = useSaving();
  const editing = !!initial?.id;
  const last = data.records.salary[data.records.salary.length - 1];
  const [f, setF] = useState(() => (editing ? { ...initial } : { date: today, employer: last?.employer || '', title: last?.title || '', salary: '', notes: '', ...(initial || {}) }));
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const prev = useMemo(() => {
    const same = data.records.salary.filter((s) => lower(s.employer) === lower(f.employer) && s.date < f.date && s.id !== initial?.id);
    return same[same.length - 1];
  }, [data.records.salary, f.employer, f.date, initial]);
  const change = prev && prev.salary > 0 && f.salary !== '' ? Number(f.salary) / prev.salary - 1 : null;
  const employers = [...new Set(data.records.salary.map((p) => p.employer).filter(Boolean))];

  const submit = async (e) => {
    e.preventDefault();
    if (f.salary === '') return setError('Enter the annual salary (0 if the job ended)');
    const ok = await run(async () => {
      if (editing) await update('salary', initial.id, f);
      else await create('salary', f);
      return true;
    }).catch(() => false);
    if (!ok) return;
    toast(editing ? 'Salary updated' : 'Salary saved');
    onDone();
  };
  const onDelete = useDelete('salary', initial || {}, onDone, 'salary entry');

  return (
    <form className="form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Annual salary" className="full" hint={change !== null ? `${change >= 0 ? 'Raise' : 'Change'} of ${(change * 100).toFixed(1)}% from ${money(prev.salary)}` : 'Base pay per year. Enter 0 to mark a job as ended.'}>
          <MoneyInput big value={f.salary} onChange={(v) => set('salary', v)} autoFocus />
        </Field>
        <Field label="Effective date">
          <input className="input" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} required />
        </Field>
        <Field label="Employer">
          <input className="input" list="salary-employers" value={f.employer} onChange={(e) => set('employer', e.target.value)} />
          <datalist id="salary-employers">
            {employers.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </Field>
        <Field label="Title / role">
          <input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Notes">
          <input className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="e.g. annual review, promotion" />
        </Field>
      </div>
      <FormFooter saving={saving} error={error} editing={editing} onDelete={onDelete} onCancel={onDone} />
    </form>
  );
}
