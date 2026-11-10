import { describe, it, expect } from 'vitest';
import { parseDate, detectDateOrder, parseAmount, detectHeaderRow, guessKind, guessMapping, guessWide, guessAccountType, autoConfig, buildSheet, findUnknowns, defaultDecisions, buildPayload } from './importer.js';

const config = {
  accounts: [{ name: 'Everyday Checking', type: 'checking' }, { name: 'Rewards Visa', type: 'credit_card' }],
  paymentMethods: [{ name: 'Cash' }],
  categories: {
    expense: [{ name: 'Groceries', subcategories: ['Groceries', 'Household Supplies'] }, { name: 'Dining', subcategories: ['Restaurants', 'General'] }],
    activity: [{ name: 'Transfer', countsAsIncome: false }],
  },
};

describe('values', () => {
  it('parses many date formats', () => {
    expect(parseDate('2024-01-05')).toBe('2024-01-05');
    expect(parseDate('1/5/2024')).toBe('2024-01-05');
    expect(parseDate('1/5/24')).toBe('2024-01-05');
    expect(parseDate('5/1/2024', 'DMY')).toBe('2024-01-05');
    expect(parseDate('Jan 5, 2024')).toBe('2024-01-05');
    expect(parseDate('Friday, January 5th, 2024')).toBe('2024-01-05');
    expect(parseDate('5-Jan-24')).toBe('2024-01-05');
    expect(parseDate('2024-01-05 13:45:00')).toBe('2024-01-05');
    expect(parseDate('1/5/2024 9:30 AM')).toBe('2024-01-05');
    expect(parseDate('45296')).toBe('2024-01-05');
    expect(parseDate('Jan 2024')).toBe('2024-01-01');
    expect(parseDate('2/30/2024')).toBeNull();
    expect(parseDate('Total')).toBeNull();
    expect(detectDateOrder(['1/5/2024', '13/5/2024'])).toBe('DMY');
    expect(detectDateOrder(['1/5/2024', '1/25/2024'])).toBe('MDY');
  });

  it('parses money in common spreadsheet formats', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56);
    expect(parseAmount('(12.50)')).toBe(-12.5);
    expect(parseAmount('-$5')).toBe(-5);
    expect(parseAmount('12.34-')).toBe(-12.34);
    expect(parseAmount('USD 7')).toBe(7);
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('12,50')).toBe(12.5);
    expect(parseAmount('1,500')).toBe(1500);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('n/a')).toBeNaN();
  });
});

describe('guessing', () => {
  it('finds the header row below a title', () => {
    expect(detectHeaderRow([['My Budget 2024'], [], ['Date', 'Amount', 'Where'], ['1/1/2024', '5', 'x']])).toBe(2);
  });

  it('guesses what a tab contains', () => {
    expect(guessKind('2024 Spending', ['Date', 'Amount'])).toBe('expenses');
    expect(guessKind('Sheet1', ['Date', 'Merchant', 'Amount'])).toBe('expenses');
    expect(guessKind('Paystubs', [])).toBe('paychecks');
    expect(guessKind('Net Worth', ['Date', 'Checking', 'Savings'])).toBe('balancesWide');
    expect(guessKind('Balances', ['Date', 'Account', 'Balance'])).toBe('balances');
    expect(guessKind('Notes', ['Idea'])).toBe('skip');
  });

  it('maps columns by header names', () => {
    const map = guessMapping('expenses', ['Transaction Date', 'Description', 'Category', 'Sub-Category', 'Card', 'Amount ($)', 'Memo']);
    expect(map).toEqual({ date: { col: 0 }, vendor: { col: 1 }, category: { col: 2 }, subcategory: { col: 3 }, payment_method: { col: 4 }, amount: { col: 5 }, notes: { col: 6 } });
    const pay = guessMapping('paychecks', ['Pay Date', 'Gross Pay', 'Federal', 'State', 'OASDI', 'Medicare', '401k', 'Medical', 'Dental', 'Vision', 'Net Pay']);
    expect(pay.social_security).toEqual({ col: 4 });
    expect(pay.net).toEqual({ col: 10 });
  });

  it('reads wide balance sheets with contributed columns', () => {
    const rows = [['Date', 'Checking', 'Fidelity 401k', 'Fidelity 401k contributed', 'Net Worth'], ['1/31/2024', '1,000', '20000', '15000', '21000']];
    const w = guessWide(rows[0], rows, 0);
    expect(w.dateCol).toBe(0);
    expect(w.accounts.map((a) => a.name)).toEqual(['Checking', 'Fidelity 401k']);
    expect(w.accounts[1].contributedCol).toBe(3);
  });

  it('guesses account types', () => {
    expect(guessAccountType('Chase Sapphire Visa')).toBe('credit_card');
    expect(guessAccountType('Vanguard Roth IRA')).toBe('roth_ira');
    expect(guessAccountType('Work 401(k)')).toBe('401k');
    expect(guessAccountType('Ally Savings')).toBe('savings');
    expect(guessAccountType('House')).toBe('home');
    expect(guessAccountType('Home Mortgage')).toBe('mortgage');
  });
});

describe('building records', () => {
  const sheet = {
    name: 'Spending',
    rows: [
      ['Date', 'Merchant', 'Amount', 'Category', 'Card'],
      ['1/5/2024', 'Costco', '$120.50', 'Groceries', 'Rewards Visa'],
      ['1/6/2024', 'Taco Stand', '14', 'Food Out', 'Amex Gold'],
      ['', '', '', '', ''],
      ['not a date', 'X', '5', 'Dining', 'Cash'],
      ['1/7/2024', 'Mystery', 'abc', 'Dining', 'Cash'],
      ['1/8/2024', '', '9', '', 'cash'],
    ],
  };

  it('builds expenses and reports skipped rows', () => {
    const cfg = autoConfig(sheet);
    expect(cfg.kind).toBe('expenses');
    const b = buildSheet(sheet, cfg);
    expect(b.missing).toEqual([]);
    expect(b.records).toHaveLength(3);
    expect(b.records[0]).toMatchObject({ date: '2024-01-05', vendor: 'Costco', amount: 120.5, payment_method: 'Rewards Visa', _source: 'Spending row 2' });
    expect(b.records[2]).toMatchObject({ vendor: 'Unknown', category: 'Uncategorized' });
    expect(b.skipped.map((s) => s.row)).toEqual([5, 6]);
  });

  it('flips negative bank-style amounts', () => {
    const neg = { name: 'Bank', rows: [['Date', 'Description', 'Amount', 'Account'], ['2024-01-01', 'A', '-10', 'Checking'], ['2024-01-02', 'B', '-20', 'Checking']] };
    const cfg = autoConfig(neg);
    expect(cfg.flipSign).toBe(true);
    expect(buildSheet(neg, cfg).records.map((r) => r.amount)).toEqual([10, 20]);
  });

  it('reports unmapped required columns', () => {
    const b = buildSheet({ name: 'x', rows: [['Date', 'Amount']] }, { kind: 'expenses', headerRow: 0, map: { date: { col: 0 }, amount: { col: 1 } } });
    expect(b.missing).toEqual(['Payment method']);
  });

  it('uses a fixed value for every row', () => {
    const s = { name: 'Visa export', rows: [['Date', 'Desc', 'Amt'], ['2024-01-01', 'A', '3']] };
    const cfg = { kind: 'expenses', headerRow: 0, map: { date: { col: 0 }, vendor: { col: 1 }, amount: { col: 2 }, payment_method: { value: 'Rewards Visa' } } };
    expect(buildSheet(s, cfg).records[0].payment_method).toBe('Rewards Visa');
  });

  it('turns unknown names into creations or mappings', () => {
    const b = buildSheet(sheet, autoConfig(sheet));
    const balances = [{ date: '2024-01-31', account: 'Amex Gold', balance: 300 }, { date: '2024-01-31', account: 'Brokerage', balance: 5000 }];
    const records = { expenses: b.records, balances };
    const unknowns = findUnknowns(records, config);
    expect(unknowns.accounts.map((a) => a.name)).toEqual(['Amex Gold', 'Brokerage']);
    expect(unknowns.accounts[0].usedForPayments).toBe(true);
    expect(unknowns.paymentMethods).toEqual([]);
    expect(unknowns.categories.map((c) => c.name).sort()).toEqual(['Food Out', 'Uncategorized']);

    const decisions = defaultDecisions(unknowns);
    expect(decisions.accounts['amex gold']).toEqual({ action: 'create', type: 'credit_card' });
    expect(decisions.accounts.brokerage.type).toBe('brokerage');
    decisions.categories['food out'] = { action: 'map', to: 'Dining' };

    const { create, records: out } = buildPayload(records, decisions, config);
    expect(create.accounts).toEqual([{ name: 'Amex Gold', type: 'credit_card' }, { name: 'Brokerage', type: 'brokerage' }]);
    expect(out.expenses[1]).toMatchObject({ category: 'Dining', subcategory: 'General', payment_method: 'Amex Gold' });
    expect(out.expenses[0]).toMatchObject({ category: 'Groceries', subcategory: 'General' });
    expect(out.expenses[2]).toMatchObject({ payment_method: 'Cash', category: 'Uncategorized', subcategory: 'General' });
    expect(create.expenseCategories).toEqual([
      { name: 'Groceries', subcategories: ['General'] },
      { name: 'Uncategorized', subcategories: ['General'] },
    ]);
  });
});
