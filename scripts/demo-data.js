#!/usr/bin/env node
// Generates a realistic, fictional demo data set so you can explore Mynance.
//
//   node scripts/demo-data.js ./demo-data          # write into ./demo-data
//   node scripts/demo-data.js ./demo-data --force  # overwrite existing files
//
// Every name and number here is made up.
import fs from 'node:fs';
import path from 'node:path';
import { toTable } from '../server/src/csv.js';
import { columnsOf, toRow } from '../server/src/schema.js';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS, DATA_README } from '../server/src/defaults.js';

const target = path.resolve(process.argv[2] || './demo-data');
const force = process.argv.includes('--force');
if (fs.existsSync(path.join(target, 'records', 'expenses.csv')) && !force) {
  const existing = fs.readFileSync(path.join(target, 'records', 'expenses.csv'), 'utf8').trim().split('\n').length;
  if (existing > 1) {
    console.error(`${target} already has data. Pass --force to overwrite it.`);
    process.exit(1);
  }
}

// ---------- deterministic randomness ----------
let seed = 20240101;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const between = (a, b) => a + rand() * (b - a);
const pick = (list) => list[Math.floor(rand() * list.length)];
const round2 = (n) => Math.round(n * 100) / 100;
const normal = () => {
  const u = rand() || 1e-9;
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// ---------- dates ----------
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const D = (s) => new Date(`${s}T00:00:00Z`);
const addDays = (s, n) => {
  const d = D(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const START = `${now.getFullYear() - 2}-01-01`;
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const months = [];
for (let y = Number(START.slice(0, 4)); ; y++) {
  let done = false;
  for (let m = 1; m <= 12; m++) {
    const key = `${y}-${pad(m)}`;
    if (`${key}-01` > TODAY) {
      done = true;
      break;
    }
    months.push({ y, m, key });
  }
  if (done) break;
}
const day = (y, m, d) => `${y}-${pad(m)}-${pad(Math.min(d, dim(y, m)))}`;
const yearsIn = (s) => (D(s) - D(START)) / (365.25 * 86400000);
const infl = (s) => 1.03 ** yearsIn(s);

// ---------- accounts ----------
const A = {
  checking: 'Everyday Checking',
  savings: 'High-Yield Savings',
  visa: 'Rewards Visa',
  cashback: 'Cash Back Card',
  brokerage: 'Brokerage',
  roth: 'Roth IRA',
  k401: '401(k)',
  home: 'Primary Home',
  mortgage: 'Mortgage',
};
const accounts = [
  { name: A.checking, type: 'checking', institution: 'Hometown Bank' },
  { name: A.savings, type: 'savings', institution: 'Online Bank' },
  { name: A.visa, type: 'credit_card', institution: 'Card Issuer A' },
  { name: A.cashback, type: 'credit_card', institution: 'Card Issuer B' },
  { name: A.brokerage, type: 'brokerage', institution: 'Broker Co' },
  { name: A.roth, type: 'roth_ira', institution: 'Broker Co' },
  { name: A.k401, type: '401k', institution: 'Plan Provider' },
  { name: A.home, type: 'home' },
  { name: A.mortgage, type: 'mortgage', institution: 'Mortgage Lender' },
];

const expenses = [];
const activity = [];
const paychecks = [];
const salary = [];
// account -> list of { date, delta } for cash/credit balances
const flows = new Map(Object.values(A).map((n) => [n, []]));
const flow = (account, date, delta) => flows.get(account).push({ date, delta });

const spend = (date, amount, vendor, method, category, subcategory, notes = '') => {
  if (date > TODAY) return;
  amount = round2(amount);
  expenses.push({ date, amount, vendor, payment_method: method, category, subcategory, notes });
  if (method === A.checking) flow(A.checking, date, -amount);
  else if (method === A.visa || method === A.cashback) flow(method, date, amount); // amount owed goes up
};
const act = (date, amount, account, category, notes = '') => {
  if (date > TODAY) return;
  amount = round2(amount);
  activity.push({ date, amount, account, category, notes });
};

// ---------- salary & paychecks ----------
const salaryHistory = [
  { date: START, salary: 126000, title: 'Senior Analyst', notes: 'Starting salary' },
  { date: `${Number(START.slice(0, 4)) + 1}-03-01`, salary: 133000, title: 'Senior Analyst', notes: 'Annual review' },
  { date: `${Number(START.slice(0, 4)) + 2}-03-01`, salary: 143000, title: 'Lead Analyst', notes: 'Promotion' },
].filter((s) => s.date <= TODAY);
for (const s of salaryHistory) salary.push({ ...s, employer: 'Acme Corp' });
const salaryOn = (date) => [...salaryHistory].reverse().find((s) => s.date <= date).salary;

const contributions = { [A.k401]: [], [A.roth]: [], [A.brokerage]: [] };
for (let pay = addDays(START, 4); pay <= TODAY; pay = addDays(pay, 14)) {
  const gross = round2(salaryOn(pay) / 26);
  const isBonus = pay.slice(5, 7) === '03' && Number(pay.slice(8, 10)) <= 14;
  const bonus = isBonus ? round2(salaryOn(pay) * 0.08) : null;
  const taxable = gross + (bonus || 0);
  const p = {
    date: pay,
    employer: 'Acme Corp',
    gross,
    bonus,
    federal_tax: round2(taxable * (isBonus ? 0.17 : 0.13)),
    state_tax: round2(taxable * 0.045),
    social_security: round2(taxable * 0.062),
    medicare: round2(taxable * 0.0145),
    other_tax: null,
    retirement_401k: round2(taxable * 0.08),
    roth_401k: null,
    hsa: 50,
    medical: 96.5,
    dental: 11.25,
    vision: 3.8,
    other_deductions: null,
    employer_match: round2(taxable * 0.04),
    notes: isBonus ? 'Includes annual bonus' : '',
  };
  const deductions = ['federal_tax', 'state_tax', 'social_security', 'medicare', 'retirement_401k', 'hsa', 'medical', 'dental', 'vision'].reduce((s, k) => s + (p[k] || 0), 0);
  p.net = round2(taxable - deductions);
  paychecks.push(p);
  act(pay, p.net, A.checking, 'Paycheck Deposit', 'Acme Corp');
  flow(A.checking, pay, p.net);
  contributions[A.k401].push({ date: pay, amount: p.retirement_401k + p.employer_match });
}

// ---------- monthly life ----------
const grocers = ['FreshMart', 'Green Grocer', 'Warehouse Club', 'Corner Market'];
const restaurants = ['Corner Cafe', 'Taco Stand', 'Pizza Place', 'Thai Kitchen', 'Burger Joint', 'Sushi Bar', 'Coffee House'];
const shops = ['Online Store', 'Department Store', 'Hardware Store', 'Book Shop', 'Electronics Outlet'];

for (const { y, m, key } of months) {
  const f = infl(`${key}-15`);
  // Fixed bills
  spend(day(y, m, 1), 2385, 'Mortgage Lender', A.checking, 'Housing', 'Mortgage / Rent', 'P&I + escrow');
  if (m === 4 || m === 10) spend(day(y, m, 10), 2750 * f, 'County Treasurer', A.checking, 'Housing', 'Property Tax');
  spend(day(y, m, 3), (m >= 6 && m <= 9 ? 165 : 95) * between(0.9, 1.1) * f, 'City Power', A.visa, 'Utilities', 'Electric');
  spend(day(y, m, 5), (m <= 3 || m >= 11 ? 105 : 38) * between(0.85, 1.15) * f, 'Gas Utility', A.visa, 'Utilities', 'Gas');
  spend(day(y, m, 8), 62 * between(0.9, 1.1) * f, 'Water Dept', A.checking, 'Utilities', 'Water / Sewer');
  spend(day(y, m, 12), 75, 'FiberNet', A.visa, 'Utilities', 'Internet');
  spend(day(y, m, 14), 88, 'Mobile Carrier', A.visa, 'Utilities', 'Phone');
  spend(day(y, m, 9), 15.99, 'StreamFlix', A.cashback, 'Entertainment', 'Streaming');
  spend(day(y, m, 21), 11.99, 'MusicBox', A.cashback, 'Entertainment', 'Streaming');
  spend(day(y, m, 2), 42, 'City Gym', A.cashback, 'Personal Care', 'Fitness');
  spend(day(y, m, 18), 38, 'Life Insurance Co', A.checking, 'Insurance', 'Life');
  if (m === 1 || m === 7) spend(day(y, m, 6), 690 * f, 'Auto Insurance Co', A.visa, 'Vehicle', 'Insurance');
  if (m === 3) spend(day(y, m, 15), 1480 * f, 'Home Insurance Co', A.checking, 'Insurance', 'Home');
  if (m === 5) spend(day(y, m, 20), 210, 'DMV', A.visa, 'Vehicle', 'Registration');
  if (m === 2) spend(day(y, m, 11), 129, 'Cloud Storage Co', A.cashback, 'Subscriptions', 'Software');

  // Variable spending
  const trips = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < trips; i++) spend(day(y, m, 1 + Math.floor(rand() * 28)), between(85, 175) * f, pick(grocers), A.cashback, 'Groceries', 'Groceries');
  for (let i = 0; i < 6 + Math.floor(rand() * 5); i++) {
    const v = pick(restaurants);
    spend(day(y, m, 1 + Math.floor(rand() * 28)), (v === 'Coffee House' ? between(5, 14) : between(18, 72)) * f, v, pick([A.visa, A.cashback]), 'Dining', v === 'Coffee House' ? 'Coffee' : rand() < 0.3 ? 'Takeout' : 'Restaurants');
  }
  for (let i = 0; i < 3 + Math.floor(rand() * 2); i++) spend(day(y, m, 1 + Math.floor(rand() * 28)), between(38, 62) * f, 'Fuel Stop', A.visa, 'Vehicle', 'Fuel');
  for (let i = 0; i < 2 + Math.floor(rand() * 3); i++) spend(day(y, m, 1 + Math.floor(rand() * 28)), between(20, 160) * f, pick(shops), pick([A.visa, A.cashback]), 'Shopping', pick(['Clothing', 'Home Goods', 'Electronics', 'Other']));
  if (rand() < 0.5) spend(day(y, m, 1 + Math.floor(rand() * 28)), between(25, 180), 'Family Clinic', A.visa, 'Healthcare', pick(['Doctor', 'Pharmacy']));
  if (rand() < 0.3) spend(day(y, m, 1 + Math.floor(rand() * 28)), between(120, 650) * f, 'Auto Service Center', A.visa, 'Vehicle', 'Maintenance');
  if (rand() < 0.4) spend(day(y, m, 1 + Math.floor(rand() * 28)), between(40, 160), 'Event Tickets', A.cashback, 'Entertainment', 'Events');
  if (rand() < 0.5) spend(day(y, m, 1 + Math.floor(rand() * 28)), between(25, 60), 'Hair Studio', 'Cash', 'Personal Care', 'Haircut');
  if (rand() < 0.35) spend(day(y, m, 1 + Math.floor(rand() * 28)), between(60, 420) * f, 'Home Improvement Store', A.visa, 'Housing', 'Maintenance');
  if (m === 12) for (let i = 0; i < 5; i++) spend(day(y, m, 1 + Math.floor(rand() * 20)), between(30, 140), pick(shops), A.cashback, 'Gifts', 'Holidays');
  if (rand() < 0.25) spend(day(y, m, 1 + Math.floor(rand() * 28)), between(30, 90), pick(shops), A.cashback, 'Gifts', 'Birthdays');
  if (m === 7) {
    spend(day(y, m, 5), 620 * f, 'Airline', A.visa, 'Travel', 'Flights', 'Summer trip');
    spend(day(y, m, 12), 1150 * f, 'Beach Resort', A.visa, 'Travel', 'Lodging', 'Summer trip');
    spend(day(y, m, 14), 340 * f, 'Tour Company', A.visa, 'Travel', 'Activities', 'Summer trip');
  }

  // Giving: tithe ~10% of take-home, plus occasional charity
  const net = paychecks.filter((p) => p.date.startsWith(key)).reduce((s, p) => s + p.net, 0);
  if (net) spend(day(y, m, 2), round2(net * 0.1), 'Community Church', A.checking, 'Tithe', 'Church');
  if (rand() < 0.3) spend(day(y, m, 20), between(50, 250), pick(['Food Bank', 'Animal Shelter', 'Relief Fund']), A.checking, 'Charity', 'Donations');

  // Monthly transfers & contributions
  const d15 = day(y, m, 15);
  act(d15, 400, A.brokerage, 'Contribution', 'Automatic investment');
  act(d15, -400, A.checking, 'Transfer', 'To brokerage');
  flow(A.checking, d15, -400);
  contributions[A.brokerage].push({ date: d15, amount: 400 });
  const roth = 7000 / 12;
  act(day(y, m, 16), round2(roth), A.roth, 'Contribution');
  act(day(y, m, 16), -round2(roth), A.checking, 'Transfer', 'To Roth IRA');
  flow(A.checking, day(y, m, 16), -round2(roth));
  contributions[A.roth].push({ date: day(y, m, 16), amount: round2(roth) });
  act(day(y, m, 20), 300, A.savings, 'Deposit', 'Monthly savings');
  act(day(y, m, 20), -300, A.checking, 'Transfer', 'To savings');
  flow(A.checking, day(y, m, 20), -300);
  flow(A.savings, day(y, m, 20), 300);
  if (rand() < 0.2) act(day(y, m, 24), round2(between(300, 900)), A.checking, 'Other Income', 'Freelance project');
}
for (const a of activity.filter((x) => x.category === 'Other Income')) flow(A.checking, a.date, a.amount);

// Credit cards: pay last month's statement in full on the 25th.
for (const card of [A.visa, A.cashback]) {
  for (const { y, m } of months) {
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
    const due = day(y, m, 25);
    if (due > TODAY) continue;
    const charged = expenses.filter((e) => e.payment_method === card && e.date.startsWith(prev)).reduce((s, e) => s + e.amount, 0);
    if (!charged) continue;
    act(due, round2(charged), card, 'Credit Card Payment', 'Statement balance');
    act(due, -round2(charged), A.checking, 'Credit Card Payment', card);
    flow(card, due, -round2(charged));
    flow(A.checking, due, -round2(charged));
  }
}

// ---------- balances ----------
// Snapshot dates: every month end, then weekly for the last ~8 weeks, plus today.
const snapDates = new Set(months.map(({ y, m }) => day(y, m, 31)).filter((d) => d <= TODAY));
for (let d = addDays(TODAY, -56); d <= TODAY; d = addDays(d, 7)) snapDates.add(d);
snapDates.add(TODAY);
const snaps = [...snapDates].sort();

const balances = [];
const runningAt = (account, start, date) => start + flows.get(account).filter((f) => f.date <= date).reduce((s, f) => s + f.delta, 0);

// Investment accounts: simulate daily-ish with monthly returns between snapshots.
const invStart = {
  [A.brokerage]: { value: 21500, contributed: 17000 },
  [A.roth]: { value: 38200, contributed: 29000 },
  [A.k401]: { value: 84500, contributed: 61000 },
};
const monthlyReturn = {};
for (const { key } of months) monthlyReturn[key] = 0.0075 + 0.035 * normal();
const invState = Object.fromEntries(Object.entries(invStart).map(([k, v]) => [k, { ...v, date: START }]));
let homeValue = 465000;
let mortgage = 352000;
let lastHomeMonth = null;
let savingsInterestTotal = 0;
for (const date of snaps) {
  for (const [acct, st] of Object.entries(invState)) {
    // Apply returns pro-rated per day since last snapshot, and contributions in between.
    let d = st.date;
    while (d < date) {
      const next = addDays(d, 1);
      st.value *= 1 + monthlyReturn[next.slice(0, 7)] / 30.4;
      for (const c of contributions[acct]) {
        if (c.date === next) {
          st.value += c.amount;
          st.contributed += c.amount;
        }
      }
      d = next;
    }
    st.date = date;
    balances.push({ date, account: acct, balance: round2(st.value), contributed: round2(st.contributed), notes: '' });
  }
  // Savings interest (~4% APY), credited monthly
  const mk = date.slice(0, 7);
  balances.push({ date, account: A.savings, balance: round2(runningAt(A.savings, 18000, date) + savingsInterestTotal), contributed: null, notes: '' });
  if (date.endsWith(String(dim(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)))))) {
    const interest = round2((runningAt(A.savings, 18000, date) + savingsInterestTotal) * (0.04 / 12));
    savingsInterestTotal += interest;
    act(date, interest, A.savings, 'Interest');
  }
  balances.push({ date, account: A.checking, balance: round2(runningAt(A.checking, 7200, date)), contributed: null, notes: '' });
  for (const card of [A.visa, A.cashback]) balances.push({ date, account: card, balance: round2(Math.max(0, runningAt(card, 0, date))), contributed: null, notes: '' });
  if (mk !== lastHomeMonth) {
    homeValue *= 1 + 0.0028 + 0.004 * normal();
    mortgage -= 690 + (mortgage < 340000 ? 25 : 0);
    lastHomeMonth = mk;
  }
  balances.push({ date, account: A.home, balance: Math.round(homeValue / 100) * 100, contributed: null, notes: '' });
  balances.push({ date, account: A.mortgage, balance: round2(mortgage), contributed: null, notes: '' });
}

// ---------- budgets ----------
const thisYear = Number(TODAY.slice(0, 4));
const budgetFor = (y) => {
  const f = 1.03 ** (y - Number(START.slice(0, 4)));
  return {
    items: [
      { category: 'Housing', subcategory: 'Mortgage / Rent', kind: 'fixed', annual: 2385 * 12 },
      { category: 'Housing', subcategory: 'Property Tax', kind: 'fixed', annual: Math.round(5500 * f), months: [4, 10] },
      { category: 'Housing', subcategory: 'Maintenance', kind: 'variable', annual: Math.round(1000 * f) },
      { category: 'Utilities', subcategory: '', kind: 'variable', annual: Math.round(4300 * f) },
      { category: 'Groceries', subcategory: '', kind: 'variable', annual: Math.round(7400 * f) },
      { category: 'Dining', subcategory: '', kind: 'variable', annual: Math.round(3600 * f) },
      { category: 'Vehicle', subcategory: 'Insurance', kind: 'fixed', annual: Math.round(1380 * f), months: [1, 7] },
      { category: 'Vehicle', subcategory: 'Fuel', kind: 'variable', annual: Math.round(2200 * f) },
      { category: 'Vehicle', subcategory: 'Maintenance', kind: 'variable', annual: Math.round(900 * f) },
      { category: 'Insurance', subcategory: 'Home', kind: 'fixed', annual: Math.round(1480 * f), months: [3] },
      { category: 'Insurance', subcategory: 'Life', kind: 'fixed', annual: 456 },
      { category: 'Healthcare', subcategory: '', kind: 'variable', annual: 700 },
      { category: 'Shopping', subcategory: '', kind: 'variable', annual: Math.round(3200 * f) },
      { category: 'Entertainment', subcategory: '', kind: 'variable', annual: 900 },
      { category: 'Travel', subcategory: '', kind: 'variable', annual: Math.round(2200 * f), months: [7] },
      { category: 'Personal Care', subcategory: '', kind: 'fixed', annual: 504 + 240 },
      { category: 'Gifts', subcategory: '', kind: 'variable', annual: 700 },
      { category: 'Subscriptions', subcategory: '', kind: 'fixed', annual: 129, months: [2] },
      { category: 'Tithe', subcategory: '', kind: 'fixed', annual: Math.round(7600 * f) },
      { category: 'Charity', subcategory: '', kind: 'variable', annual: 500 },
    ],
  };
};
const budgets = { [thisYear - 1]: budgetFor(thisYear - 1), [thisYear]: budgetFor(thisYear) };

// ---------- write ----------
const settings = structuredClone(DEFAULT_SETTINGS);
settings.retirement.birthYear = thisYear - 36;
settings.retirement.otherIncome = 26000;
settings.dashboard.excludedCategories = [];

fs.mkdirSync(path.join(target, 'config'), { recursive: true });
fs.mkdirSync(path.join(target, 'records'), { recursive: true });
const writeJSON = (f, v) => fs.writeFileSync(path.join(target, 'config', f), JSON.stringify(v, null, 2) + '\n');
writeJSON('accounts.json', accounts);
writeJSON('categories.json', DEFAULT_CATEGORIES);
writeJSON('payment-methods.json', [{ name: 'Cash' }]);
writeJSON('budgets.json', budgets);
writeJSON('settings.json', settings);
fs.writeFileSync(path.join(target, 'README.md'), DATA_README);

let n = 0;
const id = () => (++n).toString(16).padStart(10, '0');
const write = (name, file, rows) => {
  const sorted = rows.filter((r) => r.date <= TODAY).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  fs.writeFileSync(path.join(target, 'records', file), toTable(columnsOf(name), sorted.map((r) => toRow(name, { ...r, id: id() }))));
  return sorted.length;
};
const counts = {
  expenses: write('expenses', 'expenses.csv', expenses),
  activity: write('activity', 'account-activity.csv', activity),
  balances: write('balances', 'balances.csv', balances),
  paychecks: write('paychecks', 'paychecks.csv', paychecks),
  salary: write('salary', 'salary.csv', salary),
};
console.log(`Demo data written to ${target}`);
console.log(Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`).join('\n'));
