import { describe, it, expect } from 'vitest';
import { addMonths, monthRange, daysBetween, monthEnd, addDays } from './dates.js';
import { buildBalanceIndex, valueAsOf, snapshot, monthlySnapshots, monthlyInvestmentReturns, annualizeReturns } from './balances.js';
import { paycheckTotals, monthlyCashflow, averages, expenseBreakdown, currentSalary, salaryHistory, nextPaycheckDate } from './spending.js';
import { itemMonthAmount, budgetByMonth, budgetVsActual, burnDown, projectSpending } from './budget.js';
import { projectNetWorth, retirementPlan, projectInvestments } from './projections.js';

const categories = {
  expense: [
    { name: 'Groceries', subcategories: ['Food'] },
    { name: 'Tithe', subcategories: ['Church'], excludeFromCore: true },
    { name: 'Vehicle', subcategories: ['Fuel'], excludeFromCore: true },
  ],
  activity: [
    { name: 'Contribution', countsAsIncome: false },
    { name: 'Other Income', countsAsIncome: true },
  ],
};

describe('dates', () => {
  it('handles month math and ranges', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-03-31', -1)).toBe('2024-02-29');
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30);
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('balances', () => {
  const accounts = [
    { name: 'Checking', type: 'checking' },
    { name: 'Visa', type: 'credit_card' },
    { name: 'Brokerage', type: 'brokerage' },
    { name: '401k', type: '401k' },
    { name: 'House', type: 'home' },
    { name: 'Mortgage', type: 'mortgage' },
  ];
  const balances = [
    { date: '2026-01-31', account: 'Checking', balance: 5000 },
    { date: '2026-01-31', account: 'Visa', balance: 1200 },
    { date: '2026-01-31', account: 'Brokerage', balance: 10000, contributed: 8000 },
    { date: '2026-01-31', account: '401k', balance: 20000, contributed: 15000 },
    { date: '2026-01-31', account: 'House', balance: 400000 },
    { date: '2026-01-31', account: 'Mortgage', balance: 300000 },
    { date: '2026-02-28', account: 'Brokerage', balance: 11200, contributed: 9000 },
    { date: '2026-02-28', account: '401k', balance: 20400, contributed: null },
  ];
  const index = buildBalanceIndex(balances);

  it('carries balances and contributions forward', () => {
    expect(valueAsOf(index, 'brokerage', '2026-02-15').balance).toBe(10000);
    expect(valueAsOf(index, 'Brokerage', '2026-03-15').contributed).toBe(9000);
    expect(valueAsOf(index, '401k', '2026-02-28').contributed).toBe(15000);
    expect(valueAsOf(index, 'Checking', '2025-12-31')).toBeNull();
  });

  it('computes net worth with liabilities and home equity', () => {
    const t = snapshot(accounts, index, '2026-01-31').totals;
    expect(t.cash).toBe(5000);
    expect(t.investments).toBe(30000);
    expect(t.homeEquity).toBe(100000);
    expect(t.liabilities).toBe(301200);
    expect(t.netWorth).toBe(5000 + 30000 + 400000 - 301200);
  });

  it('computes monthly returns net of contributions', () => {
    const r = monthlyInvestmentReturns(accounts, index, [], '2026-02', '2026-02', '2026-02-28');
    expect(r).toHaveLength(1);
    // start 30000, end 31600, flows 1000 (brokerage) + 0 (401k) => gain 600
    expect(r[0].flows).toBe(1000);
    expect(r[0].gain).toBe(600);
    expect(r[0].return).toBeCloseTo(600 / 30500, 6);
    expect(annualizeReturns([{ return: 0.01 }, { return: 0.01 }])).toBeCloseTo(1.01 ** 12 - 1, 6);
  });

  it('builds a monthly series', () => {
    const s = monthlySnapshots(accounts, index, '2026-01', '2026-03', '2026-03-10');
    expect(s.map((x) => x.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-10']);
    expect(s[1].investments).toBe(31600);
  });
});

describe('income & spending', () => {
  const expenses = [
    { date: '2026-01-05', amount: 100, category: 'Groceries', payment_method: 'Visa', vendor: 'A' },
    { date: '2026-01-06', amount: 50, category: 'Tithe', payment_method: 'Checking', vendor: 'Church' },
    { date: '2026-02-10', amount: 200, category: 'Groceries', payment_method: 'Visa', vendor: 'B' },
    { date: '2026-02-11', amount: 40, category: 'Vehicle', payment_method: 'Cash', vendor: 'Gas' },
  ];
  const paychecks = [
    { date: '2026-01-15', gross: 4000, bonus: null, federal_tax: 500, state_tax: 200, retirement_401k: 400, medical: 100, net: 2800 },
    { date: '2026-02-15', gross: 4000, federal_tax: 500, state_tax: 200, retirement_401k: 400, medical: 100, net: null },
  ];
  const activity = [
    { date: '2026-02-20', amount: 300, account: 'Checking', category: 'Other Income' },
    { date: '2026-02-21', amount: 500, account: 'Brokerage', category: 'Contribution' },
  ];
  const data = { expenses, paychecks, activity, categories };

  it('breaks down paychecks', () => {
    const t = paycheckTotals(paychecks[1]);
    expect(t.gross).toBe(4000);
    expect(t.taxes).toBe(700);
    expect(t.retirement).toBe(400);
    expect(t.net).toBe(2800);
  });

  it('computes monthly cashflow and savings rate', () => {
    const [jan, feb] = monthlyCashflow(data, '2026-01', '2026-02');
    expect(jan.expenses).toBe(150);
    expect(jan.core).toBe(100);
    expect(jan.income).toBe(2800);
    expect(feb.income).toBe(3100);
    expect(jan.saved).toBe(2800 + 400 - 150);
    expect(jan.savingsRate).toBeCloseTo((3200 - 150) / 3200, 6);
  });

  it('averages over the covered window only', () => {
    const a = averages(data, '2025-03-01', '2026-02-28', { exclude: ['Groceries'] });
    // expenses start 2026-01-05 => 55 days
    expect(a.spendDays).toBe(55);
    expect(a.spending.total).toBe(390);
    expect(a.spending.core).toBe(300);
    expect(a.spending.custom).toBe(90);
    expect(a.spending.dailyAll).toBeCloseTo(390 / 55, 6);
    expect(a.income.total).toBe(5900);
  });

  it('groups expenses by period and dimension', () => {
    const b = expenseBreakdown(expenses, { start: '2026-01-01', end: '2026-02-28', by: 'category' });
    expect(b.rows).toHaveLength(2);
    expect(b.rows[0].Groceries).toBe(100);
    expect(b.totals[0]).toEqual({ name: 'Groceries', total: 300 });
    const y = expenseBreakdown(expenses, { start: '2026-01-01', end: '2026-12-31', period: 'year', exclude: ['tithe'] });
    expect(y.rows).toEqual([{ period: '2026', total: 340, Total: 340 }]);
  });

  it('tracks salary and raises', () => {
    const salary = [
      { date: '2024-01-01', employer: 'Acme', salary: 90000 },
      { date: '2025-01-01', employer: 'Acme', salary: 99000 },
      { date: '2025-06-01', employer: 'Side', salary: 10000 },
      { date: '2026-01-01', employer: 'Side', salary: 0 },
    ];
    expect(currentSalary(salary, '2025-07-01').total).toBe(109000);
    expect(currentSalary(salary, '2026-02-01').total).toBe(99000);
    expect(salaryHistory(salary)[1].change).toBeCloseTo(0.1, 6);
  });

  it('predicts the next paycheck date', () => {
    expect(nextPaycheckDate([{ date: '2026-01-02' }, { date: '2026-01-16' }], '2026-01-20')).toBe('2026-01-30');
    expect(nextPaycheckDate([{ date: '2026-01-31' }, { date: '2026-02-28' }], '2026-03-01')).toBe('2026-03-28');
  });
});

describe('budget', () => {
  const items = [
    { category: 'Groceries', kind: 'variable', annual: 1200 },
    { category: 'Insurance', kind: 'fixed', annual: 600, months: [3, 9] },
  ];
  const expenses = [
    { date: '2026-03-02', amount: 90, category: 'Groceries' },
    { date: '2026-03-05', amount: 300, category: 'Insurance' },
    { date: '2026-03-20', amount: 30, category: 'Dining' },
  ];

  it('splits annual amounts into months', () => {
    expect(itemMonthAmount(items[0], 5)).toBe(100);
    expect(itemMonthAmount(items[1], 3)).toBe(300);
    expect(itemMonthAmount(items[1], 4)).toBe(0);
    const m = budgetByMonth(items);
    expect(m[2]).toEqual({ month: 3, fixed: 300, variable: 100, total: 400 });
    expect(m.reduce((s, x) => s + x.total, 0)).toBe(1800);
  });

  it('compares budget to actual with pace', () => {
    const r = budgetVsActual(items, expenses, { year: 2026, month: 3, today: '2026-03-16' });
    const g = r.rows.find((x) => x.category === 'Groceries');
    expect(g.budget).toBe(100);
    expect(g.actual).toBe(90);
    expect(g.expected).toBeCloseTo(100 * (16 / 31), 6);
    const ins = r.rows.find((x) => x.category === 'Insurance');
    expect(ins.expected).toBe(300);
    const dining = r.rows.find((x) => x.category === 'Dining');
    expect(dining.budget).toBe(0);
    expect(r.totals.actual).toBe(420);
    const y = budgetVsActual(items, expenses, { year: 2026, today: '2026-03-16' });
    expect(y.rows.find((x) => x.category === 'Insurance').expected).toBe(300);
  });

  it('builds burn-down series', () => {
    const b = burnDown(items, expenses, { year: 2026, month: 3, today: '2026-03-16' });
    expect(b.budget).toBe(400);
    expect(b.points[5].remaining).toBe(400 - 390);
    expect(b.points[31].remaining).toBeNull();
    expect(b.points[31].planned).toBeCloseTo(0, 6);
  });

  it('projects next year from history with adjustments', () => {
    const exp = [
      { date: '2025-01-10', amount: 1000, category: 'Groceries' },
      { date: '2025-12-10', amount: 1000, category: 'Groceries' },
      { date: '2025-06-10', amount: 500, category: 'Travel' },
    ];
    const p = projectSpending(exp, { basis: 'calendar', year: 2025, today: '2026-02-01', adjustment: 10, categoryAdjustments: { travel: -20 } });
    expect(p.rows.find((r) => r.category === 'Groceries').projected).toBeCloseTo(2000 * 1.1 * p.factor, 6);
    expect(p.rows.find((r) => r.category === 'Travel').adjustment).toBe(-20);
  });
});

describe('projections', () => {
  it('projects net worth', () => {
    const start = { investments: 100000, cash: 10000, home: 300000, mortgage: 200000, asset: 0, credit: 1000, loan: 0 };
    const p = projectNetWorth(start, { startMonth: '2026-01', months: 12, expectedReturn: 0, homeAppreciation: 0, monthlyInvestment: 1000, mortgagePaydown: 500 });
    expect(p).toHaveLength(12);
    expect(p[11].month).toBe('2027-01');
    expect(p[11].netWorth).toBe(100000 + 12000 + 10000 + 300000 - 194000 - 1000);
  });

  it('projects investments under scenarios', () => {
    const r = projectInvestments({ value: 1000, contributed: 1000, years: 1, rate: 12, monthlyContribution: 0, startYear: 2026 });
    expect(r.rows[1].expected).toBeCloseTo(1120, 6);
    expect(r.rows[1].low).toBeLessThan(r.rows[1].expected);
  });

  it('simulates retirement drawdown', () => {
    const plan = retirementPlan({
      currentAge: 60, retirementAge: 60, endAge: 70, startBalance: 100000, annualContribution: 0,
      annualSpending: 25000, returnBefore: 0, returnAfter: 0, inflation: 0, otherIncome: 0, otherIncomeStartAge: 67, startYear: 2026,
    });
    expect(plan.depletionAge).toBe(64); // ages 60-63 fully funded
    expect(plan.maxSpending).toBeCloseTo(100000 / 11, 0);
    const rich = retirementPlan({
      currentAge: 40, retirementAge: 60, endAge: 95, startBalance: 1e6, annualContribution: 20000,
      annualSpending: 40000, returnBefore: 7, returnAfter: 5, inflation: 3, otherIncome: 20000, otherIncomeStartAge: 67, startYear: 2026,
    });
    expect(rich.depletionAge).toBeNull();
    expect(rich.atRetirement).toBeGreaterThan(1e6);
  });
});
