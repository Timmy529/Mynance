import { ACCOUNT_TYPE_KEYS } from '../../shared/accountTypes.js';
import { DEFAULT_SETTINGS } from './defaults.js';

export const CONFIG_FILES = {
  accounts: 'accounts.json',
  categories: 'categories.json',
  paymentMethods: 'payment-methods.json',
  budgets: 'budgets.json',
  settings: 'settings.json',
};

export const CONFIG_NAMES = Object.keys(CONFIG_FILES);

const str = (v) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim());
const bool = (v) => v === true || v === 'true';
const lower = (s) => s.toLowerCase();

function checkUniqueNames(list, label, errors) {
  const seen = new Set();
  for (const item of list) {
    if (!item.name) errors.push(`${label}: every item needs a name`);
    else if (seen.has(lower(item.name))) errors.push(`${label}: duplicate name "${item.name}"`);
    seen.add(lower(item.name || ''));
  }
}

export function validateAccounts(value) {
  const errors = [];
  if (!Array.isArray(value)) return { errors: ['accounts must be a list'] };
  const out = value.map((a) => {
    const acc = {
      name: str(a?.name),
      type: str(a?.type),
    };
    if (a?.institution) acc.institution = str(a.institution);
    if (typeof a?.isPaymentMethod === 'boolean') acc.isPaymentMethod = a.isPaymentMethod;
    if (a?.archived) acc.archived = true;
    if (a?.notes) acc.notes = str(a.notes);
    if (!ACCOUNT_TYPE_KEYS.includes(acc.type)) errors.push(`Account "${acc.name}": unknown type "${acc.type}"`);
    return acc;
  });
  checkUniqueNames(out, 'Accounts', errors);
  return { value: out, errors };
}

export function validateCategories(value) {
  const errors = [];
  if (!value || typeof value !== 'object') return { errors: ['categories must be an object'] };
  const expense = (Array.isArray(value.expense) ? value.expense : []).map((c) => {
    const subs = (Array.isArray(c?.subcategories) ? c.subcategories : []).map(str).filter(Boolean);
    const seen = new Set();
    for (const s of subs) {
      if (seen.has(lower(s))) errors.push(`Category "${str(c?.name)}": duplicate subcategory "${s}"`);
      seen.add(lower(s));
    }
    const cat = { name: str(c?.name), subcategories: subs, excludeFromCore: bool(c?.excludeFromCore) };
    if (c?.archived) cat.archived = true;
    return cat;
  });
  const activity = (Array.isArray(value.activity) ? value.activity : []).map((c) => {
    const cat = { name: str(c?.name), countsAsIncome: bool(c?.countsAsIncome) };
    if (c?.archived) cat.archived = true;
    return cat;
  });
  checkUniqueNames(expense, 'Expense categories', errors);
  checkUniqueNames(activity, 'Activity categories', errors);
  return { value: { expense, activity }, errors };
}

export function validatePaymentMethods(value, accounts = []) {
  const errors = [];
  if (!Array.isArray(value)) return { errors: ['payment methods must be a list'] };
  const out = value.map((p) => {
    const pm = { name: str(p?.name) };
    if (p?.archived) pm.archived = true;
    return pm;
  });
  checkUniqueNames(out, 'Payment methods', errors);
  const accountNames = new Set(accounts.map((a) => lower(a.name)));
  for (const pm of out) {
    if (accountNames.has(lower(pm.name))) errors.push(`Payment method "${pm.name}" has the same name as an account`);
  }
  return { value: out, errors };
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function validateBudgets(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { errors: ['budgets must be an object keyed by year'] };
  const out = {};
  for (const [year, budget] of Object.entries(value)) {
    if (!/^\d{4}$/.test(year)) {
      errors.push(`Budget key "${year}" must be a 4-digit year`);
      continue;
    }
    const items = (Array.isArray(budget?.items) ? budget.items : []).map((it) => {
      const item = {
        category: str(it?.category),
        subcategory: str(it?.subcategory),
        kind: it?.kind === 'fixed' ? 'fixed' : 'variable',
        annual: Math.round(num(it?.annual) * 100) / 100,
      };
      let months = Array.isArray(it?.months) ? it.months.map(Number).filter((m) => m >= 1 && m <= 12) : [];
      months = [...new Set(months)].sort((a, b) => a - b);
      if (months.length > 0 && months.length < 12) item.months = months;
      if (it?.notes) item.notes = str(it.notes);
      if (!item.category) errors.push(`Budget ${year}: every line needs a category`);
      return item;
    });
    const seen = new Set();
    for (const it of items) {
      const k = lower(`${it.category}|${it.subcategory}`);
      if (seen.has(k)) errors.push(`Budget ${year}: "${it.category}${it.subcategory ? ' / ' + it.subcategory : ''}" is listed twice`);
      seen.add(k);
    }
    out[year] = { items };
    if (budget?.notes) out[year].notes = str(budget.notes);
  }
  return { value: out, errors };
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

// Deep-merge saved settings over defaults; numbers stay numbers, null stays null.
export function mergeSettings(saved, defaults = DEFAULT_SETTINGS) {
  const out = {};
  for (const [key, def] of Object.entries(defaults)) {
    const v = saved?.[key];
    if (isPlainObject(def) && Object.keys(def).length > 0) out[key] = mergeSettings(isPlainObject(v) ? v : {}, def);
    else if (v === undefined) out[key] = structuredClone(def);
    else if (typeof def === 'number' || (def === null && typeof v !== 'object')) {
      out[key] = v === null || v === '' ? (def === null ? null : def) : num(v, def);
    } else out[key] = v;
  }
  // Keep unknown keys so newer/older versions don't lose each other's settings.
  if (isPlainObject(saved)) {
    for (const [k, v] of Object.entries(saved)) if (!(k in out)) out[k] = v;
  }
  return out;
}

export function validateSettings(value) {
  if (!isPlainObject(value)) return { errors: ['settings must be an object'] };
  return { value: mergeSettings(value), errors: [] };
}

export const VALIDATORS = {
  accounts: validateAccounts,
  categories: validateCategories,
  paymentMethods: validatePaymentMethods,
  budgets: validateBudgets,
  settings: validateSettings,
};
