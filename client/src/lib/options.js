import { ACCOUNT_TYPES, ACCOUNT_GROUPS, accountTypeInfo, isPaymentMethodAccount } from '@shared/accountTypes.js';

const lower = (s) => String(s ?? '').toLowerCase();

// Payment methods for expenses: payment-enabled accounts + extra methods.
// `keep` keeps an archived/disabled value selectable when editing an old record.
export function paymentMethodOptions(config, keep) {
  const accounts = config.accounts.filter((a) => (isPaymentMethodAccount(a) && !a.archived) || lower(a.name) === lower(keep));
  const cards = accounts.filter((a) => a.type === 'credit_card');
  const banks = accounts.filter((a) => a.type !== 'credit_card');
  const other = config.paymentMethods.filter((p) => !p.archived || lower(p.name) === lower(keep));
  const groups = [];
  if (cards.length) groups.push({ group: 'Credit cards', options: cards.map((a) => ({ value: a.name, label: a.name })) });
  if (banks.length) groups.push({ group: 'Accounts', options: banks.map((a) => ({ value: a.name, label: a.name })) });
  if (other.length) groups.push({ group: 'Other', options: other.map((p) => ({ value: p.name, label: p.name })) });
  return groups;
}

export function allPaymentMethodNames(config) {
  return [...config.accounts.filter((a) => isPaymentMethodAccount(a)).map((a) => a.name), ...config.paymentMethods.map((p) => p.name)];
}

export function expenseCategoryOptions(config, keep) {
  return config.categories.expense
    .filter((c) => !c.archived || lower(c.name) === lower(keep))
    .map((c) => ({ value: c.name, label: c.name }));
}

export function findCategory(config, name) {
  return config.categories.expense.find((c) => lower(c.name) === lower(name));
}

export function subcategoryOptions(config, category) {
  const cat = findCategory(config, category);
  return (cat?.subcategories || []).map((s) => ({ value: s, label: s }));
}

export function activityCategoryOptions(config, keep) {
  return config.categories.activity.filter((c) => !c.archived || lower(c.name) === lower(keep)).map((c) => ({ value: c.name, label: c.name }));
}

// Accounts grouped by type group, for selects.
export function accountOptions(config, { keep, filter } = {}) {
  const groups = new Map();
  for (const a of config.accounts) {
    if (a.archived && lower(a.name) !== lower(keep)) continue;
    if (filter && !filter(a)) continue;
    const g = ACCOUNT_GROUPS[accountTypeInfo(a.type).group] || 'Other';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ value: a.name, label: a.name });
  }
  return [...groups.entries()].map(([group, options]) => ({ group, options }));
}

export const ACCOUNT_TYPE_OPTIONS = Object.entries(ACCOUNT_TYPES).map(([value, t]) => ({ value, label: t.label }));

export function accountByName(config, name) {
  return config.accounts.find((a) => lower(a.name) === lower(name));
}

// Stable category order (as configured) for consistent chart colors.
export function categoryOrder(config) {
  return config.categories.expense.map((c) => c.name);
}
