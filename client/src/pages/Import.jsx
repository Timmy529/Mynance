import { useEffect, useMemo, useRef, useState } from 'react';
import { useData, useToast, usePref, navigate } from '../store.jsx';
import { Card, Field, Select, Empty, useConfirm } from '../components/ui.jsx';
import { IconUpload } from '../components/icons.jsx';
import { KINDS, KIND_OPTIONS, colName, autoConfig, configFor, buildSheet, findUnknowns, defaultDecisions, buildPayload, detectDateOrder, ACCOUNT_TYPE_LIST } from '../lib/importer.js';
import { money } from '../lib/format.js';
import { formatDate } from '../lib/dates.js';

const lower = (s) => String(s ?? '').toLowerCase();
const LABELS = { expenses: 'Expenses', activity: 'Account activity', balances: 'Balances', paychecks: 'Paychecks', salary: 'Salary entries' };
const EMPTY_DECISIONS = { accounts: {}, paymentMethods: {}, categories: {}, activityCategories: {} };

// Drop remembered "same as existing" choices whose target no longer exists.
function usableChoices(choices, config) {
  const names = (list) => new Set(list.map((x) => lower(x.name)));
  const targets = {
    accounts: names(config.accounts),
    paymentMethods: names([...config.accounts, ...config.paymentMethods]),
    categories: names(config.categories.expense),
    activityCategories: names(config.categories.activity),
  };
  const out = {};
  for (const [group, entries] of Object.entries(EMPTY_DECISIONS)) {
    out[group] = Object.fromEntries(Object.entries({ ...entries, ...(choices?.[group] || {}) }).filter(([, d]) => d.action !== 'map' || targets[group].has(lower(d.to))));
  }
  return out;
}

function HowToExport() {
  return (
    <div className="callout small" style={{ lineHeight: 1.6 }}>
      <strong>Getting data out of a Google Sheet (even one too big to open):</strong>
      <ol style={{ margin: '6px 0 0', paddingLeft: 20 }}>
        <li>
          Go to <strong>drive.google.com</strong>, right-click the spreadsheet and choose <strong>Download</strong>. Drive converts it to an Excel
          <strong> .xlsx</strong> file with every tab, without opening the sheet.
        </li>
        <li>
          If Drive can't convert it, open this link with your sheet's ID (the long code in its URL):{' '}
          <code style={{ wordBreak: 'break-all' }}>https://docs.google.com/spreadsheets/d/SHEET_ID/export?format=xlsx</code>. For one tab as CSV use{' '}
          <code>?format=csv&amp;gid=TAB_ID</code> (the first tab is <code>gid=0</code>).
        </li>
        <li>Last resort: Google Takeout → Drive, which exports Sheets as .xlsx.</li>
      </ol>
      <div style={{ marginTop: 6 }}>
        Also accepts .csv and .tsv from any app. A backup is saved before anything is imported, and re-importing the same file skips rows you already have.
      </div>
    </div>
  );
}

function columnOptions(sheet, headerRow) {
  const headers = sheet.rows[headerRow] || [];
  const width = Math.max(headers.length, ...sheet.rows.slice(headerRow, headerRow + 50).map((r) => r.length));
  const opts = [];
  for (let i = 0; i < width; i++) {
    const sample = sheet.rows.slice(headerRow + 1).find((r) => String(r[i] ?? '').trim() !== '')?.[i];
    const head = String(headers[i] ?? '').trim() || '(no header)';
    opts.push({ value: `c:${i}`, label: `${colName(i)} · ${head}${sample !== undefined ? ` — “${String(sample).slice(0, 24)}”` : ''}` });
  }
  return opts;
}

function SheetMapper({ sheet, cfg, setCfg, built }) {
  const cols = useMemo(() => columnOptions(sheet, cfg.headerRow), [sheet, cfg.headerRow]);
  const kind = KINDS[cfg.kind];
  const dateCol = cfg.kind === 'balancesWide' ? cfg.wide?.dateCol : cfg.map.date?.col;
  const detected = useMemo(() => (dateCol !== undefined && dateCol !== null ? detectDateOrder(sheet.rows.slice(cfg.headerRow + 1).map((r) => r[dateCol])) : 'MDY'), [sheet, cfg.headerRow, dateCol]);
  const headerChoices = sheet.rows.slice(0, 15).map((r, i) => ({ value: String(i), label: `Row ${i + 1}: ${r.filter(Boolean).slice(0, 4).join(', ').slice(0, 60) || '(empty)'}` }));

  const setField = (key, v) => {
    const map = { ...cfg.map };
    if (v === '') delete map[key];
    else if (v === 'fixed') map[key] = { value: '' };
    else map[key] = { col: Number(v.slice(2)) };
    setCfg({ ...cfg, map });
  };
  const setWide = (patch) => setCfg({ ...cfg, wide: { ...cfg.wide, ...patch } });
  const setWideAccount = (i, patch) => setWide({ accounts: cfg.wide.accounts.map((a, j) => (j === i ? { ...a, ...patch } : a)) });

  const preview = built.records.slice(0, 6);
  const previewCols = cfg.kind === 'balancesWide' ? ['date', 'account', 'balance', 'contributed'] : kind ? kind.fields.map((f) => f.key).filter((k) => preview.some((r) => r[k] !== '' && r[k] !== null && r[k] !== undefined)) : [];
  const fmt = (k, v) => (v === null || v === undefined || v === '' ? '' : k === 'date' ? formatDate(v) : typeof v === 'number' ? money(v) : String(v));

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        <Field label="This tab contains">
          <Select value={cfg.kind} onChange={(k) => setCfg(configFor(sheet, k, cfg.headerRow))} options={KIND_OPTIONS} />
        </Field>
        {cfg.kind !== 'skip' && (
          <>
            <Field label="Column names are in">
              <Select value={String(cfg.headerRow)} onChange={(v) => setCfg(configFor(sheet, cfg.kind, Number(v)))} options={headerChoices} />
            </Field>
            <Field label="Dates are written" hint={cfg.dateOrder === 'auto' ? `Detected ${detected === 'DMY' ? 'day/month/year' : 'month/day/year'}` : undefined}>
              <Select
                value={cfg.dateOrder}
                onChange={(v) => setCfg({ ...cfg, dateOrder: v })}
                options={[
                  { value: 'auto', label: 'Detect automatically' },
                  { value: 'MDY', label: 'Month/Day/Year (1/31/2024)' },
                  { value: 'DMY', label: 'Day/Month/Year (31/1/2024)' },
                ]}
              />
            </Field>
            {(cfg.kind === 'expenses' || cfg.kind === 'activity') && (
              <Field label="Amounts" hint={cfg.kind === 'expenses' ? 'Mynance stores purchases as positive numbers' : 'Mynance stores money in as positive, out as negative'}>
                <Select
                  value={cfg.flipSign ? 'flip' : 'keep'}
                  onChange={(v) => setCfg({ ...cfg, flipSign: v === 'flip' })}
                  options={[
                    { value: 'keep', label: 'Use as they are' },
                    { value: 'flip', label: cfg.kind === 'expenses' ? 'Flip sign (spending is negative here)' : 'Flip sign' },
                  ]}
                />
              </Field>
            )}
          </>
        )}
      </div>

      {kind && cfg.kind !== 'balancesWide' && (
        <>
          <div className="section-title">Match columns</div>
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {kind.fields.map((fl) => {
              const spec = cfg.map[fl.key];
              const value = !spec ? '' : spec.value !== undefined ? 'fixed' : `c:${spec.col}`;
              return (
                <Field key={fl.key} label={`${fl.label}${fl.required ? ' *' : ''}`}>
                  <Select
                    value={value}
                    onChange={(v) => setField(fl.key, v)}
                    options={[...cols, ...(fl.type === 'text' ? [{ value: 'fixed', label: 'Same value for every row…' }] : [])]}
                    placeholder="— not in this tab —"
                  />
                  {value === 'fixed' && (
                    <input className="input sm" placeholder={fl.key === 'payment_method' ? 'e.g. Rewards Visa' : 'Value'} value={spec.value} onChange={(e) => setCfg({ ...cfg, map: { ...cfg.map, [fl.key]: { value: e.target.value } } })} />
                  )}
                </Field>
              );
            })}
          </div>
        </>
      )}

      {cfg.kind === 'balancesWide' && cfg.wide && (
        <>
          <div className="section-title">Date column and account columns</div>
          <div className="form-grid" style={{ maxWidth: 520 }}>
            <Field label="Date column *">
              <Select value={cfg.wide.dateCol === null ? '' : `c:${cfg.wide.dateCol}`} onChange={(v) => setWide({ dateCol: v ? Number(v.slice(2)) : null })} options={cols} placeholder="Choose…" />
            </Field>
          </div>
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Import</th>
                  <th>Column</th>
                  <th>Account name</th>
                  <th>Total contributed from</th>
                </tr>
              </thead>
              <tbody>
                {cfg.wide.accounts.map((a, i) => (
                  <tr key={a.col}>
                    <td>
                      <input type="checkbox" checked={a.include} onChange={(e) => setWideAccount(i, { include: e.target.checked })} aria-label={`Import ${a.name}`} />
                    </td>
                    <td className="muted">{colName(a.col)}</td>
                    <td>
                      <input className="input sm" value={a.name} onChange={(e) => setWideAccount(i, { name: e.target.value })} />
                    </td>
                    <td>
                      <Select small value={a.contributedCol === null || a.contributedCol === undefined ? '' : `c:${a.contributedCol}`} onChange={(v) => setWideAccount(i, { contributedCol: v ? Number(v.slice(2)) : null })} options={cols} placeholder="—" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!cfg.wide.accounts.length && <p className="small warn">No numeric columns found. Pick a different header row or tab type.</p>}
        </>
      )}

      {cfg.kind !== 'skip' && (
        <>
          {built.missing.length > 0 ? (
            <div className="form-error">Choose a column for: {built.missing.join(', ')}.</div>
          ) : (
            <>
              <div className="section-title">
                Preview · {built.records.length.toLocaleString()} {LABELS[built.collection]?.toLowerCase()}
                {built.skipped.length ? ` · ${built.skipped.length.toLocaleString()} row${built.skipped.length === 1 ? '' : 's'} skipped` : ''}
              </div>
              {preview.length > 0 && (
                <div className="table-wrap">
                  <table className="table compact">
                    <thead>
                      <tr>
                        {previewCols.map((k) => (
                          <th key={k} className={typeof preview[0][k] === 'number' ? 'num' : ''}>
                            {k.replace(/_/g, ' ')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((r, i) => (
                        <tr key={i}>
                          {previewCols.map((k) => (
                            <td key={k} className={typeof r[k] === 'number' ? 'num' : ''}>
                              {fmt(k, r[k])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {built.skipped.length > 0 && (
                <details className="small">
                  <summary className="warn" style={{ cursor: 'pointer' }}>
                    Why {built.skipped.length.toLocaleString()} row{built.skipped.length > 1 ? 's were' : ' was'} skipped
                  </summary>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                    {built.skipped.slice(0, 12).map((s, i) => (
                      <li key={i}>
                        Row {s.row}: {s.reason}
                      </li>
                    ))}
                    {built.skipped.length > 12 && <li>…and {built.skipped.length - 12} more</li>}
                  </ul>
                </details>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function DecisionTable({ title, hint, items, render }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="section-title" style={{ marginBottom: 4 }}>
        {title}
      </div>
      {hint && <p className="small muted" style={{ marginBottom: 6 }}>{hint}</p>}
      <div className="table-wrap">
        <table className="table compact">
          <tbody>
            {items.map((it) => (
              <tr key={it.name}>
                <td className="cell-main">{it.name}</td>
                <td className="num muted">{it.count.toLocaleString()} rows</td>
                <td style={{ width: '50%', minWidth: 220 }}>{render(it)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Decisions({ unknowns, decisions, setDecision, config }) {
  const typeOpts = (prefix) => ACCOUNT_TYPE_LIST.map((t) => ({ value: `${prefix}${t.value}`, label: t.label }));
  const existingAccounts = config.accounts.map((a) => ({ value: `map:${a.name}`, label: a.name }));
  const existingMethods = [...config.accounts, ...config.paymentMethods].map((a) => ({ value: `map:${a.name}`, label: a.name }));
  const existingCats = config.categories.expense.map((c) => ({ value: `map:${c.name}`, label: c.name }));
  const existingActivity = config.categories.activity.map((c) => ({ value: `map:${c.name}`, label: c.name }));
  const enc = (d) => (d.action === 'map' ? `map:${d.to}` : d.action === 'create' && d.type ? `create:${d.type}` : d.action === 'account' ? `account:${d.type}` : d.action === 'create' && 'income' in d ? (d.income ? 'create:income' : 'create:plain') : d.action);
  const dec = (v) => {
    const [a, ...rest] = v.split(':');
    const val = rest.join(':');
    if (a === 'map') return { action: 'map', to: val };
    if (a === 'account') return { action: 'account', type: val };
    if (a === 'method') return { action: 'method' };
    if (val === 'income' || val === 'plain') return { action: 'create', income: val === 'income' };
    if (val) return { action: 'create', type: val };
    return { action: 'create' };
  };
  const total = unknowns.accounts.length + unknowns.paymentMethods.length + unknowns.categories.length + unknowns.activityCategories.length;
  if (!total) return <p className="small muted">Every account and category in this file already exists in Mynance.</p>;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <DecisionTable
        title="New accounts"
        hint="Pick each account's type, or point it at an account you already have."
        items={unknowns.accounts}
        render={(it) => (
          <Select
            small
            value={enc(decisions.accounts[lower(it.name)])}
            onChange={(v) => setDecision('accounts', it.name, dec(v))}
            options={[{ group: 'Create account as', options: typeOpts('create:') }, ...(existingAccounts.length ? [{ group: 'Same as existing account', options: existingAccounts }] : [])]}
          />
        )}
      />
      <DecisionTable
        title="New payment methods"
        hint="Cards and bank accounts can become accounts (so you can track their balances); anything else becomes a simple payment method."
        items={unknowns.paymentMethods}
        render={(it) => (
          <Select
            small
            value={enc(decisions.paymentMethods[lower(it.name)])}
            onChange={(v) => setDecision('paymentMethods', it.name, dec(v))}
            options={[
              { group: 'Create', options: [{ value: 'method', label: 'Payment method (not an account)' }, ...typeOpts('account:').map((o) => ({ ...o, label: `Account: ${o.label}` }))] },
              ...(existingMethods.length ? [{ group: 'Same as existing', options: existingMethods }] : []),
            ]}
          />
        )}
      />
      <DecisionTable
        title="New expense categories"
        hint="Create them as-is, or fold them into a category you already have. Subcategories from the file are added automatically."
        items={unknowns.categories}
        render={(it) => (
          <Select
            small
            value={enc(decisions.categories[lower(it.name)])}
            onChange={(v) => setDecision('categories', it.name, dec(v))}
            options={[{ value: 'create', label: 'Create new category' }, { group: 'Same as existing category', options: existingCats }]}
          />
        )}
      />
      <DecisionTable
        title="New account activity categories"
        items={unknowns.activityCategories}
        render={(it) => (
          <Select
            small
            value={enc(decisions.activityCategories[lower(it.name)])}
            onChange={(v) => setDecision('activityCategories', it.name, dec(v))}
            options={[
              { value: 'create:plain', label: 'Create (not income)' },
              { value: 'create:income', label: 'Create (counts as income)' },
              { group: 'Same as existing category', options: existingActivity },
            ]}
          />
        )}
      />
    </div>
  );
}

export default function ImportPanel() {
  const { data, reload } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState(null);
  const [cfgs, setCfgs] = useState([]);
  const [active, setActive] = useState(0);
  // Remembered per browser so the next import (e.g. new rows next month) reuses your choices.
  const [choices, setChoices] = usePref('import.decisions', EMPTY_DECISIONS);
  const [skipDup, setSkipDup] = useState(true);
  const [check, setCheck] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const built = useMemo(() => (sheets ? sheets.map((s, i) => buildSheet(s, cfgs[i])) : []), [sheets, cfgs]);
  const records = useMemo(() => {
    const r = {};
    for (const b of built) if (b.collection && b.records.length && !b.missing.length) (r[b.collection] ||= []).push(...b.records);
    return r;
  }, [built]);
  const unknowns = useMemo(() => findUnknowns(records, data.config), [records, data.config]);
  const decisions = useMemo(() => defaultDecisions(unknowns, usableChoices(choices, data.config)), [unknowns, choices, data.config]);
  const payload = useMemo(() => buildPayload(records, decisions, data.config), [records, decisions, data.config]);
  useEffect(() => setCheck(null), [payload, skipDup]);

  const counts = Object.entries(payload.records).map(([k, v]) => [k, v.length]).filter(([, n]) => n);
  const totalRecords = counts.reduce((s, [, n]) => s + n, 0);
  const dates = Object.values(payload.records).flat().map((r) => r.date).sort();

  const onFile = async (file) => {
    if (!file) return;
    setBusy(`Reading ${file.name}…`);
    setError('');
    try {
      const res = await fetch(`/api/import/parse?filename=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not read that file');
      const usable = body.sheets.filter((s) => s.rows.length > 1);
      if (!usable.length) throw new Error('No rows found in that file.');
      const nextCfgs = usable.map(autoConfig);
      setSheets(usable);
      setCfgs(nextCfgs);
      setActive(Math.max(0, nextCfgs.findIndex((c) => c.kind !== 'skip')));
      setFileName(file.name);
      setResult(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const send = async (dryRun) => {
    const res = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, skipDuplicates: skipDup, dryRun }) });
    const body = await res.json();
    if (!res.ok) {
      const err = new Error(body.error || 'Import failed');
      err.details = body.details;
      throw err;
    }
    return body;
  };

  const runCheck = async () => {
    setBusy('Checking…');
    setError('');
    try {
      setCheck(await send(true));
    } catch (e) {
      setError(e.details?.length > 1 ? `${e.message} (and ${e.details.length - 1} more)` : e.message);
    } finally {
      setBusy('');
    }
  };

  const runImport = async () => {
    const summary = counts.map(([k, n]) => `${n.toLocaleString()} ${LABELS[k].toLowerCase()}`).join(', ');
    if (!(await confirm({ title: 'Import this data?', message: `${summary}. A backup of your current data is saved first.`, confirmLabel: 'Import' }))) return;
    setBusy('Importing…');
    setError('');
    try {
      const body = await send(false);
      setResult(body);
      await reload();
      toast('Import complete');
    } catch (e) {
      setError(e.details?.length > 1 ? `${e.message} (and ${e.details.length - 1} more)` : e.message);
    } finally {
      setBusy('');
    }
  };

  const setCfg = (i, cfg) => setCfgs((all) => all.map((c, j) => (j === i ? cfg : c)));
  const setDecision = (group, name, value) => setChoices((c) => ({ ...c, [group]: { ...c[group], [lower(name)]: value } }));

  if (result) {
    const added = Object.entries(result.added).filter(([, n]) => n);
    const skipped = Object.values(result.skipped).reduce((s, n) => s + n, 0);
    return (
      <Card title="Import complete">
        <p>
          Added {added.map(([k, n]) => `${n.toLocaleString()} ${LABELS[k].toLowerCase()}`).join(', ') || 'nothing new'}
          {skipped ? `; skipped ${skipped.toLocaleString()} already in Mynance` : ''}.
        </p>
        {result.created && Object.values(result.created).some(Boolean) && (
          <p className="small ink-2" style={{ marginTop: 6 }}>
            Created {result.created.accounts} accounts, {result.created.paymentMethods} payment methods, {result.created.expenseCategories} expense categories and{' '}
            {result.created.activityCategories} activity categories.
          </p>
        )}
        {result.backup && <p className="small muted" style={{ marginTop: 6 }}>Your data before the import was saved as {result.backup}.</p>}
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={() => navigate('dashboard')}>
            Go to dashboard
          </button>
          <button className="btn" onClick={() => navigate('settings', { tab: 'accounts' })}>
            Review accounts
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              setResult(null);
              setSheets(null);
              setFileName('');
            }}
          >
            Import another file
          </button>
        </div>
      </Card>
    );
  }

  return (
    <div className="stack">
      <Card title="Import from a spreadsheet" subtitle="Bring in history from Google Sheets, Excel or any CSV export">
        <HowToExport />
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={!!busy}>
            <IconUpload /> {sheets ? 'Choose a different file' : 'Choose .xlsx or .csv file'}
          </button>
          <input ref={fileRef} type="file" hidden accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
          {fileName && (
            <span className="small ink-2">
              {fileName} · {sheets?.length} tab{sheets?.length === 1 ? '' : 's'}
            </span>
          )}
          {busy && <span className="small muted">{busy}</span>}
        </div>
        {error && !sheets && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
      </Card>

      {sheets && (
        <>
          <Card title="1. What's in each tab" subtitle="Mynance guessed from tab names and column headers. Click a tab to check its columns." flush>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Tab</th>
                    <th>Contains</th>
                    <th className="num">Rows</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sheets.map((s, i) => {
                    const b = built[i];
                    return (
                      <tr key={i} className="clickable" onClick={() => setActive(i)} style={i === active ? { background: 'var(--accent-wash)' } : undefined}>
                        <td className="cell-main">
                          {s.name} {s.hidden && <span className="badge">hidden</span>}
                        </td>
                        <td>{KIND_OPTIONS.find((o) => o.value === cfgs[i].kind)?.label}</td>
                        <td className="num">{Math.max(0, s.rows.length - cfgs[i].headerRow - 1).toLocaleString()}</td>
                        <td>
                          {cfgs[i].kind === 'skip' ? (
                            <span className="muted small">skipped</span>
                          ) : b.missing.length ? (
                            <span className="badge warn">needs columns</span>
                          ) : (
                            <span className="badge good">
                              {b.records.length.toLocaleString()} ready{b.skipped.length ? ` · ${b.skipped.length} skipped` : ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={`2. Columns in “${sheets[active].name}”`}>
            <SheetMapper sheet={sheets[active]} cfg={cfgs[active]} setCfg={(c) => setCfg(active, c)} built={built[active]} />
          </Card>

          <Card title="3. Accounts & categories" subtitle="Names in the file that Mynance doesn't have yet">
            <Decisions unknowns={unknowns} decisions={decisions} setDecision={setDecision} config={data.config} />
          </Card>

          <Card title="4. Import">
            {totalRecords === 0 ? (
              <Empty>Nothing to import yet. Set at least one tab to a data type and match its columns.</Empty>
            ) : (
              <>
                <dl className="kv" style={{ maxWidth: 420 }}>
                  {counts.map(([k, n]) => (
                    <FragmentKV key={k} label={LABELS[k]} value={n.toLocaleString()} />
                  ))}
                  <dt>Dates</dt>
                  <dd>
                    {formatDate(dates[0])} – {formatDate(dates[dates.length - 1])}
                  </dd>
                </dl>
                <label className="check" style={{ marginTop: 12 }}>
                  <input type="checkbox" checked={skipDup} onChange={(e) => setSkipDup(e.target.checked)} /> Skip rows that are already in Mynance
                </label>
                {check && (
                  <div className="callout small" style={{ marginTop: 12 }}>
                    Ready: {Object.entries(check.added).filter(([, n]) => n).map(([k, n]) => `${n.toLocaleString()} new ${LABELS[k].toLowerCase()}`).join(', ') || 'nothing new'}
                    {Object.values(check.skipped).some(Boolean) && `; ${Object.values(check.skipped).reduce((s, n) => s + n, 0).toLocaleString()} already in Mynance will be skipped`}.
                  </div>
                )}
                {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
                <div className="form-actions" style={{ marginTop: 14 }}>
                  <button className="btn" onClick={runCheck} disabled={!!busy}>
                    Check first
                  </button>
                  <button className="btn primary" onClick={runImport} disabled={!!busy}>
                    Import {totalRecords.toLocaleString()} records
                  </button>
                  {busy && <span className="small muted">{busy}</span>}
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function FragmentKV({ label, value }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
