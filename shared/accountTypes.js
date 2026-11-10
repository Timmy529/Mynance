// Account types shared by the server (validation) and the client (grouping & metrics).
//
// group:
//   cash        - checking, savings, physical cash
//   brokerage   - taxable investment accounts
//   retirement  - tax-advantaged retirement accounts
//   home        - real estate value
//   asset       - any other asset (vehicle, collectibles, ...)
//   credit      - credit cards (liability)
//   mortgage    - home loans (liability, subtracted from home equity)
//   loan        - other loans (liability)
//
// investment: account tracks "total contributed" alongside its value.
// liability:  balance is an amount owed; it is subtracted from net worth.
// payment:    shown as a payment method for expenses by default.

export const ACCOUNT_TYPES = {
  checking: { label: 'Checking', group: 'cash', payment: true },
  savings: { label: 'Savings', group: 'cash', payment: false },
  cash: { label: 'Cash', group: 'cash', payment: true },
  brokerage: { label: 'Brokerage / Investment', group: 'brokerage', investment: true },
  roth_ira: { label: 'Roth IRA', group: 'retirement', investment: true },
  traditional_ira: { label: 'Traditional IRA', group: 'retirement', investment: true },
  '401k': { label: '401(k)', group: 'retirement', investment: true },
  roth_401k: { label: 'Roth 401(k)', group: 'retirement', investment: true },
  '403b': { label: '403(b)', group: 'retirement', investment: true },
  hsa: { label: 'HSA', group: 'retirement', investment: true },
  credit_card: { label: 'Credit Card', group: 'credit', liability: true, payment: true },
  home: { label: 'Home / Real Estate', group: 'home' },
  mortgage: { label: 'Mortgage', group: 'mortgage', liability: true },
  loan: { label: 'Loan', group: 'loan', liability: true },
  other_asset: { label: 'Other Asset', group: 'asset' },
};

export const ACCOUNT_TYPE_KEYS = Object.keys(ACCOUNT_TYPES);

export const ACCOUNT_GROUPS = {
  cash: 'Cash',
  brokerage: 'Brokerage',
  retirement: 'Retirement',
  home: 'Home',
  asset: 'Other Assets',
  credit: 'Credit Cards',
  mortgage: 'Mortgage',
  loan: 'Loans',
};

export function accountTypeInfo(type) {
  return ACCOUNT_TYPES[type] || { label: type, group: 'asset' };
}

export function isInvestmentType(type) {
  return !!accountTypeInfo(type).investment;
}

export function isLiabilityType(type) {
  return !!accountTypeInfo(type).liability;
}

export function isPaymentMethodAccount(account) {
  if (typeof account.isPaymentMethod === 'boolean') return account.isPaymentMethod;
  return !!accountTypeInfo(account.type).payment;
}
