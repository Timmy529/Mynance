import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseCSV, toCSV, parseTable } from '../src/csv.js';
import { Store } from '../src/store.js';
import { Backups } from '../src/backup.js';
import { createApp } from '../src/app.js';

let dir;
let server;
let base;
let store;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mynance-test-'));
  store = new Store(dir);
  await store.init();
  const backups = new Backups(store, { retention: 3 });
  const app = createApp({ store, backups });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server?.close();
  await fs.rm(dir, { recursive: true, force: true });
});

async function api(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

test('csv round-trips quotes, commas and newlines', () => {
  const rows = [
    ['date', 'notes'],
    ['2026-01-01', 'He said "hi", then left'],
    ['2026-01-02', 'line1\nline2'],
    ['2026-01-03', ' padded '],
  ];
  assert.deepEqual(parseCSV(toCSV(rows)), rows);
  const { headers, records } = parseTable('﻿Date,Payment Method\r\n2026-01-01,Visa\r\n\r\n');
  assert.deepEqual(headers, ['date', 'payment_method']);
  assert.deepEqual(records, [{ date: '2026-01-01', payment_method: 'Visa' }]);
});

test('init creates readable default files', async () => {
  const cats = JSON.parse(await fs.readFile(path.join(dir, 'config/categories.json'), 'utf8'));
  assert.ok(cats.expense.some((c) => c.name === 'Tithe' && c.excludeFromCore));
  const csv = await fs.readFile(path.join(dir, 'records/expenses.csv'), 'utf8');
  assert.equal(csv, 'date,amount,vendor,payment_method,category,subcategory,notes,id\n');
  const { data } = await api('GET', '/data');
  assert.equal(data.config.settings.projection.expectedReturn, 7);
});

test('accounts, expenses and validation', async () => {
  let r = await api('PUT', '/config/accounts', [
    { name: 'Checking', type: 'checking' },
    { name: 'Visa', type: 'credit_card' },
    { name: 'Brokerage', type: 'brokerage' },
  ]);
  assert.equal(r.status, 200);

  r = await api('PUT', '/config/accounts', [{ name: 'X', type: 'nope' }]);
  assert.equal(r.status, 400);

  r = await api('POST', '/records/expenses', {
    date: '2026-03-04', amount: '$1,234.5', vendor: 'Costco', payment_method: 'visa',
    category: 'groceries', subcategory: 'groceries', notes: 'bulk, "big" run',
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.amount, 1234.5);
  assert.equal(r.data.payment_method, 'visa'); // stored as given, matched case-insensitively
  assert.equal(r.data.category, 'Groceries'); // canonicalized
  const id = r.data.id;

  r = await api('POST', '/records/expenses', { date: '2026-02-30', amount: 'abc', vendor: '', payment_method: 'Nope', category: 'Groceries' });
  assert.equal(r.status, 400);
  assert.ok(r.data.details.length >= 3);

  r = await api('POST', '/records/expenses', { date: '2026-03-01', amount: 5, vendor: 'X', payment_method: 'Cash', category: 'Groceries' });
  assert.equal(r.status, 400, 'subcategory required when the category has subcategories');

  r = await api('PUT', `/records/expenses/${id}`, {
    date: '2026-03-05', amount: 100, vendor: 'Costco', payment_method: 'Visa', category: 'Groceries', subcategory: 'Groceries',
  });
  assert.equal(r.status, 200);
  const csv = await fs.readFile(path.join(dir, 'records/expenses.csv'), 'utf8');
  assert.match(csv, /2026-03-05,100.00,Costco,Visa,Groceries,Groceries,,/);
});

test('activity requires known account and category', async () => {
  let r = await api('POST', '/records/activity', { date: '2026-03-01', amount: -50, account: 'Checking', category: 'Transfer' });
  assert.equal(r.status, 201);
  r = await api('POST', '/records/activity', { date: '2026-03-01', amount: 50, account: 'Nope', category: 'Transfer' });
  assert.equal(r.status, 400);
});

test('balances batch upserts one row per account per day', async () => {
  let r = await api('POST', '/records/balances/batch', {
    records: [
      { date: '2026-03-01', account: 'Checking', balance: 1000 },
      { date: '2026-03-01', account: 'Brokerage', balance: 5000, contributed: 4000 },
    ],
  });
  assert.equal(r.status, 200);
  r = await api('POST', '/records/balances/batch', {
    records: [{ date: '2026-03-01', account: 'Checking', balance: 1100 }],
  });
  const { data } = await api('GET', '/data');
  const checking = data.records.balances.filter((b) => b.account === 'Checking');
  assert.equal(checking.length, 1);
  assert.equal(checking[0].balance, 1100);
  r = await api('POST', '/records/balances', { date: '2026-03-01', account: 'Checking', balance: 1 });
  assert.equal(r.status, 409);
});

test('paycheck net is computed when blank', async () => {
  const r = await api('POST', '/records/paychecks', {
    date: '2026-03-13', employer: 'Acme', gross: 4000, federal_tax: 500, state_tax: 200,
    social_security: 248, medicare: 58, retirement_401k: 400, medical: 100,
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.net, 2494);
});

test('rename cascades into records and budgets', async () => {
  await api('PUT', '/config/budgets', { 2026: { items: [{ category: 'Groceries', subcategory: '', kind: 'variable', annual: 6000 }] } });
  let r = await api('POST', '/rename', { kind: 'account', from: 'Visa', to: 'Sapphire' });
  assert.equal(r.status, 200);
  assert.ok(r.data.records.expenses.every((e) => e.payment_method !== 'Visa'));
  r = await api('POST', '/rename', { kind: 'expenseCategory', from: 'Groceries', to: 'Food' });
  assert.equal(r.status, 200);
  assert.equal(r.data.records.expenses[0].category, 'Food');
  assert.equal(r.data.config.budgets['2026'].items[0].category, 'Food');
  r = await api('POST', '/rename', { kind: 'subcategory', parent: 'Food', from: 'Groceries', to: 'Supermarket' });
  assert.equal(r.data.records.expenses[0].subcategory, 'Supermarket');
  r = await api('POST', '/rename', { kind: 'account', from: 'Checking', to: 'Cash' });
  assert.equal(r.status, 409, 'cannot collide with a payment method');
});

test('hand-edited csv rows get ids and are picked up', async () => {
  const file = path.join(dir, 'records/salary.csv');
  await fs.writeFile(file, 'date,employer,title,salary,notes,id\n2025-01-01,Acme,Engineer,"$90,000",,\n');
  const { data } = await api('GET', '/data');
  assert.equal(data.records.salary.length, 1);
  assert.equal(data.records.salary[0].salary, 90000);
  assert.ok(data.records.salary[0].id);
  const csv = await fs.readFile(file, 'utf8');
  assert.match(csv, /2025-01-01,Acme,Engineer,90000.00,,[0-9a-f]{10}/);
});

test('backup, list, restore', async () => {
  let r = await api('POST', '/backups');
  assert.equal(r.status, 201);
  const zipRes = await fetch(`${base}/backup`);
  const zip = Buffer.from(await zipRes.arrayBuffer());
  assert.equal(zipRes.headers.get('content-type'), 'application/zip');

  // Change data, then restore the zip and confirm the change is undone.
  await api('POST', '/records/salary', { date: '2026-01-01', salary: 100000 });
  let data = (await api('GET', '/data')).data;
  assert.equal(data.records.salary.length, 2);

  const res = await fetch(`${base}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: zip });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(body.restored.includes('records/salary.csv'));
  data = (await api('GET', '/data')).data;
  assert.equal(data.records.salary.length, 1);

  r = await api('GET', '/backups');
  assert.ok(r.data.backups.length >= 2);
  assert.ok(r.data.backups.some((b) => b.name.includes('before-restore')));

  const bad = await fetch(`${base}/restore`, { method: 'POST', body: Buffer.from('not a zip') });
  assert.equal(bad.status, 400);
  r = await api('GET', '/backups/..%2F..%2Fetc%2Fpasswd');
  assert.equal(r.status, 400);
});

test('export returns csv', async () => {
  const res = await fetch(`${base}/export/expenses.csv`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /^date,amount,vendor/);
});
