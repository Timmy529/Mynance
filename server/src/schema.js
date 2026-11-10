// Record collections. Each collection is one CSV file in <data>/records/.
// Column order here is the column order on disk.

const money = (key, opts = {}) => ({ key, type: 'money', ...opts });
const text = (key, opts = {}) => ({ key, type: 'text', ...opts });
const date = (key, opts = {}) => ({ key, type: 'date', ...opts });

export const COLLECTIONS = {
  expenses: {
    file: 'expenses.csv',
    label: 'Expense',
    fields: [
      date('date', { required: true }),
      money('amount', { required: true }),
      text('vendor', { required: true }),
      text('payment_method', { required: true }),
      text('category', { required: true }),
      text('subcategory'),
      text('notes'),
    ],
  },
  activity: {
    file: 'account-activity.csv',
    label: 'Account activity',
    fields: [
      date('date', { required: true }),
      money('amount', { required: true }),
      text('account', { required: true }),
      text('category', { required: true }),
      text('notes'),
    ],
  },
  balances: {
    file: 'balances.csv',
    label: 'Balance',
    fields: [
      date('date', { required: true }),
      text('account', { required: true }),
      money('balance', { required: true }),
      money('contributed'),
      text('notes'),
    ],
  },
  paychecks: {
    file: 'paychecks.csv',
    label: 'Paycheck',
    fields: [
      date('date', { required: true }),
      text('employer'),
      money('gross', { required: true }),
      money('bonus'),
      money('federal_tax'),
      money('state_tax'),
      money('social_security'),
      money('medicare'),
      money('other_tax'),
      money('retirement_401k'),
      money('roth_401k'),
      money('hsa'),
      money('medical'),
      money('dental'),
      money('vision'),
      money('other_deductions'),
      money('net'),
      money('employer_match'),
      text('notes'),
    ],
  },
  salary: {
    file: 'salary.csv',
    label: 'Salary',
    fields: [
      date('date', { required: true }),
      text('employer'),
      text('title'),
      money('salary', { required: true }),
      text('notes'),
    ],
  },
};

export const COLLECTION_NAMES = Object.keys(COLLECTIONS);

export function columnsOf(name) {
  return [...COLLECTIONS[name].fields.map((f) => f.key), 'id'];
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(s) {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function parseMoney(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
  let s = String(v).trim();
  if (s === '') return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true; // accounting style (12.34)
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return Math.round((negative ? -n : n) * 100) / 100;
}

// Convert a raw CSV row (all strings) into a typed record. Tolerant: never throws,
// so hand-edited files with mistakes still load (bad numbers become null).
export function fromRow(name, row) {
  const rec = {};
  for (const f of COLLECTIONS[name].fields) {
    const raw = row[f.key] ?? '';
    if (f.type === 'money') {
      const n = parseMoney(raw);
      rec[f.key] = Number.isNaN(n) ? null : n;
    } else {
      rec[f.key] = String(raw).trim();
    }
  }
  rec.id = String(row.id ?? '').trim();
  return rec;
}

export function toRow(name, rec) {
  const row = {};
  for (const f of COLLECTIONS[name].fields) {
    const v = rec[f.key];
    if (f.type === 'money') row[f.key] = v === null || v === undefined ? '' : Number(v).toFixed(2);
    else row[f.key] = v ?? '';
  }
  row.id = rec.id;
  return row;
}

// Validate and normalize API input. Returns { record, errors }.
export function normalizeInput(name, input) {
  const errors = [];
  const record = {};
  if (!input || typeof input !== 'object') {
    return { record, errors: ['Request body must be an object'] };
  }
  for (const f of COLLECTIONS[name].fields) {
    const raw = input[f.key];
    if (f.type === 'money') {
      const n = parseMoney(raw);
      if (Number.isNaN(n)) errors.push(`${f.key} must be a number`);
      else if (n === null && f.required) errors.push(`${f.key} is required`);
      record[f.key] = Number.isNaN(n) ? null : n;
    } else if (f.type === 'date') {
      const s = String(raw ?? '').trim();
      if (!s) {
        if (f.required) errors.push(`${f.key} is required`);
      } else if (!isValidDate(s)) errors.push(`${f.key} must be a date in YYYY-MM-DD format`);
      record[f.key] = s;
    } else {
      const s = String(raw ?? '').trim();
      if (f.required && !s) errors.push(`${f.key} is required`);
      if (s.length > 1000) errors.push(`${f.key} is too long`);
      record[f.key] = s;
    }
  }
  return { record, errors };
}
