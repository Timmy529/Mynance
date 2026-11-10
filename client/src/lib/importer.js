// Turns arbitrary spreadsheet tabs into Mynance records. Pure functions: the
// Import screen keeps the user's choices and calls these to build the payload.
import { ACCOUNT_TYPES, isPaymentMethodAccount } from '@shared/accountTypes.js';

const lower = (s) => String(s ?? '').trim().toLowerCase();
const norm = (s) => lower(s).replace(/[^a-z0-9]/g, '');
const round2 = (n) => Math.round(n * 100) / 100;

const f = (key, label, type, synonyms, required = false) => ({ key, label, type, synonyms, required });

export const KINDS = {
  expenses: {
    label: 'Expenses',
    collection: 'expenses',
    fields: [
      f('date', 'Date', 'date', ['date', 'transactiondate', 'posteddate', 'posted', 'day', 'when', 'purchasedate'], true),
      f('amount', 'Amount', 'money', ['amount', 'amt', 'cost', 'price', 'total', 'spent', 'expense', 'debit', 'charge'], true),
      f('vendor', 'Vendor', 'text', ['vendor', 'merchant', 'payee', 'store', 'description', 'name', 'where', 'place', 'business', 'paidto']),
      f('payment_method', 'Payment method', 'text', ['paymentmethod', 'payment', 'paidwith', 'method', 'card', 'account', 'source', 'paymenttype'], true),
      f('category', 'Category', 'text', ['category', 'cat', 'categories', 'group', 'budgetcategory'], true),
      f('subcategory', 'Subcategory', 'text', ['subcategory', 'subcat', 'sub', 'subtype', 'subgroup']),
      f('notes', 'Notes', 'text', ['notes', 'note', 'memo', 'comment', 'comments', 'details', 'description']),
    ],
  },
  activity: {
    label: 'Account activity',
    collection: 'activity',
    fields: [
      f('date', 'Date', 'date', ['date', 'transactiondate', 'posteddate', 'day'], true),
      f('amount', 'Amount (+ in, − out)', 'money', ['amount', 'amt', 'value', 'total', 'deposit', 'credit'], true),
      f('account', 'Account', 'text', ['account', 'accountname', 'acct', 'to', 'into'], true),
      f('category', 'Category', 'text', ['category', 'type', 'transactiontype', 'kind', 'activity'], true),
      f('notes', 'Notes', 'text', ['notes', 'note', 'memo', 'description', 'details', 'comment']),
    ],
  },
  balances: {
    label: 'Balances (one row per account per date)',
    collection: 'balances',
    fields: [
      f('date', 'Date', 'date', ['date', 'asof', 'day', 'month'], true),
      f('account', 'Account', 'text', ['account', 'accountname', 'acct', 'name'], true),
      f('balance', 'Balance', 'money', ['balance', 'value', 'amount', 'total', 'marketvalue'], true),
      f('contributed', 'Total contributed', 'money', ['contributed', 'contributions', 'totalcontributed', 'costbasis', 'basis', 'invested']),
      f('notes', 'Notes', 'text', ['notes', 'note', 'memo', 'comment']),
    ],
  },
  balancesWide: { label: 'Balances (one column per account)', collection: 'balances', fields: [] },
  paychecks: {
    label: 'Paychecks',
    collection: 'paychecks',
    fields: [
      f('date', 'Pay date', 'date', ['date', 'paydate', 'checkdate', 'payday', 'payperiod'], true),
      f('employer', 'Employer', 'text', ['employer', 'company']),
      f('gross', 'Gross pay', 'money', ['gross', 'grosspay', 'grossincome', 'grossearnings', 'earnings'], true),
      f('bonus', 'Bonus', 'money', ['bonus']),
      f('federal_tax', 'Federal tax', 'money', ['federal', 'federaltax', 'fedtax', 'federalincometax', 'fit', 'fed', 'federalwithholding']),
      f('state_tax', 'State tax', 'money', ['state', 'statetax', 'sit', 'stateincometax', 'statewithholding']),
      f('social_security', 'Social Security', 'money', ['socialsecurity', 'oasdi', 'ss', 'fica', 'socsec']),
      f('medicare', 'Medicare', 'money', ['medicare', 'medicaretax']),
      f('other_tax', 'Other / local tax', 'money', ['othertax', 'localtax', 'local', 'city', 'citytax', 'sdi']),
      f('retirement_401k', '401(k)', 'money', ['401k', '401kcontribution', 'pretax401k', 'traditional401k', 'retirement', '403b']),
      f('roth_401k', 'Roth 401(k)', 'money', ['roth401k', 'roth']),
      f('hsa', 'HSA', 'money', ['hsa', 'hsacontribution']),
      f('medical', 'Medical', 'money', ['medical', 'medicalinsurance', 'health', 'healthinsurance']),
      f('dental', 'Dental', 'money', ['dental', 'dentalinsurance']),
      f('vision', 'Vision', 'money', ['vision', 'visioninsurance']),
      f('other_deductions', 'Other deductions', 'money', ['otherdeductions', 'other', 'deductions']),
      f('net', 'Net pay', 'money', ['net', 'netpay', 'takehome', 'takehomepay', 'deposit']),
      f('employer_match', 'Employer match', 'money', ['match', 'employermatch', '401kmatch', 'companymatch']),
      f('notes', 'Notes', 'text', ['notes', 'note', 'memo', 'comment']),
    ],
  },
  salary: {
    label: 'Salary history',
    collection: 'salary',
    fields: [
      f('date', 'Effective date', 'date', ['date', 'effectivedate', 'effective', 'start', 'startdate'], true),
      f('employer', 'Employer', 'text', ['employer', 'company']),
      f('title', 'Title', 'text', ['title', 'position', 'role', 'jobtitle']),
      f('salary', 'Annual salary', 'money', ['salary', 'annualsalary', 'base', 'basesalary', 'basepay', 'pay', 'annual'], true),
      f('notes', 'Notes', 'text', ['notes', 'note', 'memo', 'comment', 'reason']),
    ],
  },
};

export const KIND_OPTIONS = [{ value: 'skip', label: "Skip this tab" }, ...Object.entries(KINDS).map(([value, k]) => ({ value, label: k.label }))];

export function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// ---------- values ----------
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

function makeDate(y, m, d) {
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (m < 1 || m > 12 || d < 1) return null;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > dim || y < 1900 || y > 2200) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

const monthNum = (name) => MONTHS[lower(name).slice(0, 4)] || MONTHS[lower(name).slice(0, 3)];

// Accepts 2024-01-05, 1/5/2024, 1/5/24, 5.1.2024, Jan 5, 2024, 5 Jan 2024, 5-Jan-24,
// spreadsheet serial numbers, and any of these followed by a time.
export function parseDate(raw, order = 'MDY') {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  s = s.replace(/[T\s]+\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(am|pm|z|[+-]\d{2}:?\d{2})?$/i, '').trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return makeDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) return order === 'DMY' ? makeDate(+m[3], +m[2], +m[1]) : makeDate(+m[3], +m[1], +m[2]);
  m = /^(?:[a-z]+,?\s+)?([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2}|\d{4})$/i.exec(s);
  if (m && monthNum(m[1])) return makeDate(+m[3], monthNum(m[1]), +m[2]);
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})\.?[\s,-]+(\d{2}|\d{4})$/i.exec(s);
  if (m && monthNum(m[2])) return makeDate(+m[3], monthNum(m[2]), +m[1]);
  m = /^([a-z]{3,9})[\s-]+(\d{4})$/i.exec(s); // "Jan 2024" -> first of month
  if (m && monthNum(m[1])) return makeDate(+m[2], monthNum(m[1]), 1);
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
      return makeDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }
  return null;
}

// Decide month/day order from values like 13/1/2024 (DMY) or 1/13/2024 (MDY).
export function detectDateOrder(values) {
  let mdy = 0;
  let dmy = 0;
  for (const v of values) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(String(v).trim());
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
  }
  return dmy > mdy ? 'DMY' : 'MDY';
}

// "$1,234.56", "(12.34)", "-12.34", "12.34-", "USD 5", "1.234,56" -> number.
// Blank -> null, unreadable -> NaN.
export function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim().replace(/[−‒–—]/g, '-');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  if (/-$/.test(s)) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  s = s.replace(/[a-z$€£¥₹\s']/gi, '');
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  const n = Number(s);
  return round2(neg ? -n : n);
}

const looksNumeric = (v) => {
  const n = parseAmount(v);
  return n !== null && !Number.isNaN(n);
};
const looksDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) || (parseDate(v) !== null && !/^\d+(\.\d+)?$/.test(String(v)));

// ---------- guessing ----------
export function detectHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].filter((c) => String(c).trim() !== '');
    if (cells.length < 2) continue;
    const texty = cells.filter((c) => !looksNumeric(c) && !looksDate(c)).length;
    if (texty / cells.length >= 0.6) return i;
  }
  return 0;
}

export function guessKind(name, headers) {
  const n = lower(name);
  const h = headers.map(norm);
  const has = (...keys) => keys.some((k) => h.includes(k));
  if (/paycheck|payroll|pay ?stub|paystub/.test(n) || (has('gross', 'grosspay') && has('net', 'netpay', 'takehome'))) return 'paychecks';
  if (/salary|raise|compensation/.test(n) || (has('salary', 'annualsalary') && !has('amount'))) return 'salary';
  if (/balance|net ?worth|accounts?\b|assets/.test(n)) return has('account', 'accountname') && has('balance', 'value', 'amount') ? 'balances' : 'balancesWide';
  if (/activity|transfer|deposit|contribution/.test(n)) return 'activity';
  if (/expens|spend|purchase|transaction|budget|ledger|register/.test(n) || has('vendor', 'merchant', 'payee')) return 'expenses';
  if (has('account') && has('balance')) return 'balances';
  if (has('date', 'transactiondate', 'posteddate') && has('amount', 'debit') && has('category', 'description', 'account', 'card')) return 'expenses';
  return 'skip';
}

export function guessMapping(kind, headers) {
  const fields = KINDS[kind]?.fields || [];
  const normed = headers.map(norm);
  const used = new Set();
  const map = {};
  const take = (field, test) => {
    const i = normed.findIndex((h, idx) => h && !used.has(idx) && test(h));
    if (i >= 0) {
      used.add(i);
      map[field.key] = { col: i };
      return true;
    }
    return false;
  };
  // Exact header matches first (for every field), then partial matches.
  for (const fl of fields) take(fl, (h) => fl.synonyms.includes(h));
  for (const fl of fields) if (!map[fl.key]) take(fl, (h) => fl.synonyms.some((s) => s.length >= 4 && (h.includes(s) || s.includes(h) && h.length >= 4)));
  return map;
}

// Wide balance sheets: a date column plus one column per account. A column named
// like "<account> contributed" / "<account> cost basis" feeds that account's
// contributed total.
export function guessWide(headers, rows, headerRow) {
  const body = rows.slice(headerRow + 1, headerRow + 200);
  const dateCol = Math.max(0, headers.findIndex((h) => /date|as ?of|month|day/i.test(h)));
  const numericCols = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => i !== dateCol && h.trim() && !/total|net ?worth|sum|change|%|percent|notes?/i.test(h))
    .filter(({ i }) => {
      const vals = body.map((r) => r[i]).filter((v) => String(v ?? '').trim() !== '');
      return vals.length > 0 && vals.filter(looksNumeric).length / vals.length >= 0.8;
    });
  const contribRe = /^(.*?)[\s:-]*(contributed|contributions?|cost ?basis|basis|invested)$/i;
  const contribFor = new Map();
  for (const { h, i } of numericCols) {
    const m = contribRe.exec(h.trim());
    if (m && m[1].trim()) contribFor.set(lower(m[1]), i);
  }
  const accounts = numericCols
    .filter(({ h }) => !contribRe.test(h.trim()))
    .map(({ h, i }) => ({ col: i, name: h.trim(), include: true, contributedCol: contribFor.get(lower(h)) ?? null }));
  return { dateCol, accounts };
}

export function guessAccountType(name) {
  const n = lower(name);
  if (/mortgage|heloc/.test(n)) return 'mortgage';
  if (/loan|lease|student/.test(n)) return 'loan';
  if (/visa|master ?card|amex|american express|discover|credit|card|sapphire|freedom/.test(n)) return 'credit_card';
  if (/roth.*401|401.*roth/.test(n)) return 'roth_401k';
  if (/roth/.test(n)) return 'roth_ira';
  if (/401 ?k|401\(k\)/.test(n)) return '401k';
  if (/403/.test(n)) return '403b';
  if (/\bhsa\b|health savings/.test(n)) return 'hsa';
  if (/\bira\b/.test(n)) return 'traditional_ira';
  if (/brokerage|invest|stock|etf|index|fidelity|vanguard|schwab|crypto|robinhood|etrade|e\*trade/.test(n)) return 'brokerage';
  if (/saving|money market|\bcd\b|emergency/.test(n)) return 'savings';
  if (/home|house|property|condo|real estate/.test(n)) return 'home';
  if (/cash|wallet/.test(n)) return 'cash';
  if (/checking|bank|debit/.test(n)) return 'checking';
  if (/car|vehicle|truck|boat/.test(n)) return 'other_asset';
  return 'checking';
}

// Default choices for one tab.
export function autoConfig(sheet) {
  const headerRow = detectHeaderRow(sheet.rows);
  const headers = sheet.rows[headerRow] || [];
  const kind = guessKind(sheet.name, headers);
  return configFor(sheet, kind, headerRow);
}

export function configFor(sheet, kind, headerRow) {
  const headers = sheet.rows[headerRow] || [];
  const cfg = { kind, headerRow, map: {}, dateOrder: 'auto', flipSign: false, wide: null };
  if (kind === 'balancesWide') cfg.wide = guessWide(headers, sheet.rows, headerRow);
  else if (KINDS[kind]) cfg.map = guessMapping(kind, headers);
  if (kind === 'expenses' && cfg.map.amount) {
    // Bank-style exports list spending as negative numbers: flip them.
    const vals = sheet.rows.slice(headerRow + 1, headerRow + 300).map((r) => parseAmount(r[cfg.map.amount.col])).filter((n) => n !== null && !Number.isNaN(n));
    cfg.flipSign = vals.length > 0 && vals.filter((n) => n < 0).length / vals.length > 0.6;
  }
  return cfg;
}

// ---------- building records ----------
function cell(row, spec) {
  if (!spec) return '';
  if (spec.value !== undefined) return spec.value;
  return row[spec.col] ?? '';
}

function resolveOrder(sheet, cfg, dateSpec) {
  if (cfg.dateOrder && cfg.dateOrder !== 'auto') return cfg.dateOrder;
  if (!dateSpec || dateSpec.col === undefined) return 'MDY';
  return detectDateOrder(sheet.rows.slice(cfg.headerRow + 1).map((r) => r[dateSpec.col]));
}

// Returns { collection, records, skipped: [{ row, reason }], missing: [field labels] }.
export function buildSheet(sheet, cfg) {
  const out = { collection: KINDS[cfg.kind]?.collection || null, records: [], skipped: [], missing: [] };
  if (!KINDS[cfg.kind]) return out;
  const rows = sheet.rows;
  const at = (i) => `${sheet.name} row ${i + 1}`;

  if (cfg.kind === 'balancesWide') {
    const w = cfg.wide;
    if (!w || w.dateCol === null || w.dateCol === undefined) {
      out.missing.push('Date column');
      return out;
    }
    const accounts = w.accounts.filter((a) => a.include && a.name.trim());
    if (!accounts.length) out.missing.push('at least one account column');
    if (out.missing.length) return out;
    const order = resolveOrder(sheet, cfg, { col: w.dateCol });
    for (let i = cfg.headerRow + 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.every((c) => String(c).trim() === '')) continue;
      const date = parseDate(row[w.dateCol], order);
      if (!date) {
        out.skipped.push({ row: i + 1, reason: `unreadable date "${row[w.dateCol] ?? ''}"` });
        continue;
      }
      for (const a of accounts) {
        const bal = parseAmount(row[a.col]);
        if (bal === null) continue;
        if (Number.isNaN(bal)) {
          out.skipped.push({ row: i + 1, reason: `${a.name}: unreadable amount "${row[a.col]}"` });
          continue;
        }
        const contributed = a.contributedCol !== null && a.contributedCol !== undefined ? parseAmount(row[a.contributedCol]) : null;
        out.records.push({ _source: at(i), date, account: a.name.trim(), balance: bal, contributed: Number.isNaN(contributed) ? null : contributed });
      }
    }
    return out;
  }

  const fields = KINDS[cfg.kind].fields;
  for (const fl of fields) {
    const spec = cfg.map[fl.key];
    const mapped = spec && (spec.col !== undefined || String(spec.value ?? '').trim() !== '');
    // Text fields that have sensible fallbacks don't block the import.
    const fallback = (cfg.kind === 'expenses' && fl.key === 'category') || (cfg.kind === 'activity' && fl.key === 'category');
    if (fl.required && !mapped && !fallback) out.missing.push(fl.label);
  }
  if (out.missing.length) return out;
  const order = resolveOrder(sheet, cfg, cfg.map.date);

  for (let i = cfg.headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((c) => String(c).trim() === '')) continue;
    const rec = { _source: at(i) };
    let problem = null;
    for (const fl of fields) {
      const raw = String(cell(row, cfg.map[fl.key])).trim();
      if (fl.type === 'date') {
        const d = parseDate(raw, order);
        if (!d) problem = problem || `unreadable date "${raw}"`;
        rec[fl.key] = d;
      } else if (fl.type === 'money') {
        const n = parseAmount(raw);
        if (Number.isNaN(n)) {
          if (fl.required) problem = problem || `unreadable ${fl.label.toLowerCase()} "${raw}"`;
          rec[fl.key] = null;
        } else {
          if (n === null && fl.required) problem = problem || `missing ${fl.label.toLowerCase()}`;
          rec[fl.key] = n;
        }
      } else rec[fl.key] = raw;
    }
    if (problem) {
      out.skipped.push({ row: i + 1, reason: problem });
      continue;
    }
    if (cfg.kind === 'expenses') {
      if (cfg.flipSign) rec.amount = -rec.amount;
      rec.vendor = rec.vendor || rec.notes || 'Unknown';
      rec.category = rec.category || 'Uncategorized';
      if (!rec.payment_method) {
        out.skipped.push({ row: i + 1, reason: 'missing payment method' });
        continue;
      }
    }
    if (cfg.kind === 'activity') {
      if (cfg.flipSign) rec.amount = -rec.amount;
      rec.category = rec.category || 'Other';
      if (!rec.account) {
        out.skipped.push({ row: i + 1, reason: 'missing account' });
        continue;
      }
    }
    if (cfg.kind === 'balances' && !rec.account) {
      out.skipped.push({ row: i + 1, reason: 'missing account' });
      continue;
    }
    out.records.push(rec);
  }
  return out;
}

// ---------- names that don't exist yet ----------
function bump(map, name, extra) {
  const k = lower(name);
  if (!map.has(k)) map.set(k, { name: String(name).trim(), count: 0, ...extra });
  map.get(k).count++;
  return map.get(k);
}

// Collect accounts, payment methods and categories used by the records that
// aren't configured yet.
export function findUnknowns(records, config) {
  const accounts = new Set(config.accounts.map((a) => lower(a.name)));
  const methods = new Set([...config.accounts, ...config.paymentMethods].map((x) => lower(x.name)));
  const expenseCats = new Set(config.categories.expense.map((c) => lower(c.name)));
  const activityCats = new Set(config.categories.activity.map((c) => lower(c.name)));
  const unknown = { accounts: new Map(), paymentMethods: new Map(), categories: new Map(), activityCategories: new Map() };
  for (const r of records.activity || []) {
    if (!accounts.has(lower(r.account))) bump(unknown.accounts, r.account);
    if (!activityCats.has(lower(r.category))) bump(unknown.activityCategories, r.category);
  }
  for (const r of records.balances || []) if (!accounts.has(lower(r.account))) bump(unknown.accounts, r.account);
  for (const r of records.expenses || []) {
    if (!methods.has(lower(r.payment_method))) {
      if (unknown.accounts.has(lower(r.payment_method))) unknown.accounts.get(lower(r.payment_method)).usedForPayments = true;
      else bump(unknown.paymentMethods, r.payment_method);
    }
    if (!expenseCats.has(lower(r.category))) bump(unknown.categories, r.category);
  }
  const list = (m) => [...m.values()].sort((a, b) => b.count - a.count);
  return { accounts: list(unknown.accounts), paymentMethods: list(unknown.paymentMethods), categories: list(unknown.categories), activityCategories: list(unknown.activityCategories) };
}

const PAYMENT_HINT = /visa|master ?card|amex|discover|credit|card|checking|debit|bank/i;
export const NOT_CORE_HINT = /tithe|charit|donat|vehicle|\bauto\b|\bcar\b/i;
export const INCOME_HINT = /income|interest|freelance|side|gig|bonus|rental|dividend/i;

// Default decision for each unknown name.
export function defaultDecisions(unknowns, previous = {}) {
  const d = { accounts: {}, paymentMethods: {}, categories: {}, activityCategories: {} };
  for (const a of unknowns.accounts) d.accounts[lower(a.name)] = previous.accounts?.[lower(a.name)] || { action: 'create', type: guessAccountType(a.name) };
  for (const p of unknowns.paymentMethods) {
    d.paymentMethods[lower(p.name)] =
      previous.paymentMethods?.[lower(p.name)] || (PAYMENT_HINT.test(p.name) ? { action: 'account', type: guessAccountType(p.name) } : { action: 'method' });
  }
  for (const c of unknowns.categories) d.categories[lower(c.name)] = previous.categories?.[lower(c.name)] || { action: 'create' };
  for (const c of unknowns.activityCategories) {
    d.activityCategories[lower(c.name)] = previous.activityCategories?.[lower(c.name)] || { action: 'create', income: INCOME_HINT.test(c.name) };
  }
  return d;
}

// Apply the decisions: rename mapped names, and list what has to be created.
// Returns the request body for POST /api/import.
export function buildPayload(records, decisions, config) {
  const canon = (list) => new Map(list.map((x) => [lower(x.name), x.name]));
  const accounts = canon(config.accounts);
  const methods = canon([...config.accounts, ...config.paymentMethods]);
  const expenseCats = new Map(config.categories.expense.map((c) => [lower(c.name), c]));
  const activityCats = canon(config.categories.activity);

  const create = { accounts: [], paymentMethods: [], expenseCategories: [], activityCategories: [] };
  const newAccounts = new Map();
  const addAccount = (name, type, payment) => {
    const k = lower(name);
    if (!newAccounts.has(k)) {
      const acc = { name: name.trim(), type };
      newAccounts.set(k, acc);
      create.accounts.push(acc);
    }
    if (payment && !isPaymentMethodAccount(newAccounts.get(k))) newAccounts.get(k).isPaymentMethod = true;
  };

  const accountName = (name, payment = false) => {
    const k = lower(name);
    if (accounts.has(k)) return accounts.get(k);
    const dec = decisions.accounts[k];
    if (dec?.action === 'map') return dec.to;
    addAccount(name, dec?.type || guessAccountType(name), payment);
    return name.trim();
  };
  const methodName = (name) => {
    const k = lower(name);
    if (methods.has(k)) return methods.get(k);
    if (decisions.accounts[k]) return accountName(name, true);
    const dec = decisions.paymentMethods[k] || { action: 'method' };
    if (dec.action === 'map') return dec.to;
    if (dec.action === 'account') {
      addAccount(name, dec.type || guessAccountType(name), true);
      return name.trim();
    }
    if (!create.paymentMethods.some((p) => lower(p.name) === k)) create.paymentMethods.push({ name: name.trim() });
    return name.trim();
  };

  const catSubs = new Map(); // lower category -> { name, subs:Set, isNew }
  const categoryName = (name) => {
    const k = lower(name);
    if (expenseCats.has(k)) return expenseCats.get(k).name;
    const dec = decisions.categories[k];
    if (dec?.action === 'map') return dec.to;
    return name.trim();
  };
  const activityName = (name) => {
    const k = lower(name);
    if (activityCats.has(k)) return activityCats.get(k);
    const dec = decisions.activityCategories[k];
    if (dec?.action === 'map') return dec.to;
    if (!create.activityCategories.some((c) => lower(c.name) === k)) create.activityCategories.push({ name: name.trim(), countsAsIncome: !!dec?.income });
    return name.trim();
  };

  const out = {};
  for (const [collection, list] of Object.entries(records)) {
    out[collection] = list.map((r0) => {
      const r = { ...r0 };
      if (collection === 'expenses') {
        r.payment_method = methodName(r.payment_method);
        r.category = categoryName(r.category);
        const existing = expenseCats.get(lower(r.category));
        const subs = existing?.subcategories || [];
        const match = subs.find((s) => lower(s) === lower(r.subcategory));
        if (match) r.subcategory = match;
        else r.subcategory = r.subcategory || (subs.some((s) => lower(s) === 'general') ? subs.find((s) => lower(s) === 'general') : 'General');
        const key = lower(r.category);
        if (!catSubs.has(key)) catSubs.set(key, { name: r.category, subs: new Set(), isNew: !existing });
        if (!subs.some((s) => lower(s) === lower(r.subcategory))) catSubs.get(key).subs.add(r.subcategory);
      }
      if (collection === 'activity') {
        r.account = accountName(r.account);
        r.category = activityName(r.category);
      }
      if (collection === 'balances') r.account = accountName(r.account);
      return r;
    });
  }
  for (const c of catSubs.values()) {
    if (c.isNew || c.subs.size) {
      create.expenseCategories.push({ name: c.name, subcategories: [...c.subs], ...(c.isNew && NOT_CORE_HINT.test(c.name) ? { excludeFromCore: true } : {}) });
    }
  }
  return { create, records: out };
}

export const ACCOUNT_TYPE_LIST = Object.entries(ACCOUNT_TYPES).map(([value, t]) => ({ value, label: t.label }));
