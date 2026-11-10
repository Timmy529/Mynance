import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { readSpreadsheet } from '../src/spreadsheet.js';
import { Store } from '../src/store.js';
import { Backups } from '../src/backup.js';
import { createApp } from '../src/app.js';

// Minimal workbook shaped like a Google Sheets export: shared strings, a custom
// date number format, a formula with a cached value, an inline string, a bool.
function buildXlsx() {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0"?><Types/>'));
  zip.addFile(
    'xl/workbook.xml',
    Buffer.from(
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        '<sheet name="Expenses 2024" sheetId="1" r:id="rId1"/><sheet name="Balances &amp; Net Worth" sheetId="2" r:id="rId2"/>' +
        '</sheets></workbook>',
    ),
  );
  zip.addFile(
    'xl/_rels/workbook.xml.rels',
    Buffer.from(
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    ),
  );
  zip.addFile(
    'xl/sharedStrings.xml',
    Buffer.from(
      '<sst><si><t>Date</t></si><si><t>Amount</t></si><si><t>Merchant</t></si><si><r><t>Cate</t></r><r><t>gory</t></r></si>' +
        '<si><t>Coffee &amp; Co</t></si><si><t>Dining</t></si><si><t>Checking</t></si><si><t>401k</t></si></sst>',
    ),
  );
  zip.addFile(
    'xl/styles.xml',
    Buffer.from(
      '<styleSheet><numFmts count="2"><numFmt numFmtId="164" formatCode="m/d/yyyy"/><numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.00"/></numFmts>' +
        '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="165"/></cellXfs></styleSheet>',
    ),
  );
  zip.addFile(
    'xl/worksheets/sheet1.xml',
    Buffer.from(
      '<worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>' +
        '<row r="2"><c r="A2" s="1"><v>45306</v></c><c r="B2" s="2"><v>4.5</v></c><c r="C2" t="s"><v>4</v></c><c r="D2" t="s"><v>5</v></c></row>' +
        '<row r="4"><c r="A4" s="1"><v>45307</v></c><c r="B4"><f>B2*2</f><v>9</v></c><c r="C4" t="inlineStr"><is><t>Bagel Shop</t></is></c><c r="E4" t="b"><v>1</v></c></row>' +
        '</sheetData></worksheet>',
    ),
  );
  zip.addFile(
    'xl/worksheets/sheet2.xml',
    Buffer.from(
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>6</v></c><c r="C1" t="s"><v>7</v></c></row>' +
        '<row r="2"><c r="A2" s="1"><v>45322</v></c><c r="B2"><v>1500.25</v></c><c r="C2"><v>20000</v></c></row></sheetData></worksheet>',
    ),
  );
  return zip.toBuffer();
}

test('reads xlsx tabs, dates, shared/inline strings and formula values', () => {
  const sheets = readSpreadsheet(buildXlsx(), 'finances.xlsx');
  assert.deepEqual(
    sheets.map((s) => s.name),
    ['Expenses 2024', 'Balances & Net Worth'],
  );
  assert.deepEqual(sheets[0].rows, [
    ['Date', 'Amount', 'Merchant', 'Category', ''],
    ['2024-01-15', '4.5', 'Coffee & Co', 'Dining', ''],
    ['', '', '', '', ''],
    ['2024-01-16', '9', 'Bagel Shop', '', 'TRUE'],
  ]);
  assert.deepEqual(sheets[1].rows[1], ['2024-01-31', '1500.25', '20000']);
});

test('reads csv, tsv and semicolon files', () => {
  assert.deepEqual(readSpreadsheet(Buffer.from('Date,Amount\n1/2/2024,"1,234.50"\n'), 'x.csv')[0].rows, [
    ['Date', 'Amount'],
    ['1/2/2024', '1,234.50'],
  ]);
  assert.deepEqual(readSpreadsheet(Buffer.from('Date\tNote\n2024-01-02\ta, b\n'), 'x.tsv')[0].rows[1], ['2024-01-02', 'a, b']);
  assert.deepEqual(readSpreadsheet(Buffer.from('Date;Amount\n2024-01-02;12,50\n'), 'x.csv')[0].rows[1], ['2024-01-02', '12,50']);
  assert.throws(() => readSpreadsheet(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), 'old.xls'), /xls/);
});

let dir;
let server;
let base;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mynance-import-'));
  const store = new Store(dir);
  await store.init();
  const app = createApp({ store, backups: new Backups(store, { retention: 5 }) });
  await new Promise((r) => {
    server = app.listen(0, '127.0.0.1', r);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server?.close();
  await fs.rm(dir, { recursive: true, force: true });
});

const post = async (url, body) => {
  const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
};

const payload = () => ({
  create: {
    accounts: [
      { name: 'Checking', type: 'checking' },
      { name: 'Sapphire', type: 'credit_card' },
      { name: '401k', type: '401k' },
    ],
    paymentMethods: [{ name: 'Venmo' }],
    expenseCategories: [
      { name: 'Coffee', subcategories: ['General'] },
      { name: 'Dining', subcategories: ['Brunch'] },
    ],
    activityCategories: [{ name: 'Side Gig', countsAsIncome: true }],
  },
  records: {
    expenses: [
      { date: '2024-01-15', amount: 4.5, vendor: 'Cafe', payment_method: 'sapphire', category: 'coffee', subcategory: 'General' },
      { date: '2024-01-15', amount: 4.5, vendor: 'Cafe', payment_method: 'Sapphire', category: 'Coffee', subcategory: 'General' },
      { date: '2024-01-16', amount: 30, vendor: 'Diner', payment_method: 'Venmo', category: 'Dining', subcategory: 'Brunch' },
    ],
    activity: [{ date: '2024-01-20', amount: 250, account: 'Checking', category: 'Side Gig' }],
    balances: [
      { date: '2024-01-31', account: 'Checking', balance: 1000 },
      { date: '2024-01-31', account: 'Checking', balance: 1500.25 },
      { date: '2024-01-31', account: '401k', balance: 20000, contributed: 15000 },
    ],
    paychecks: [{ date: '2024-01-12', gross: 3000, federal_tax: 300 }],
    salary: [{ date: '2024-01-01', employer: 'Acme', salary: 78000 }],
  },
});

test('parse endpoint returns sheets', async () => {
  const res = await fetch(`${base}/import/parse?filename=finances.xlsx`, { method: 'POST', body: buildXlsx() });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.sheets.length, 2);
});

test('dry run reports without writing', async () => {
  const r = await post('/import', { ...payload(), dryRun: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.added, { expenses: 3, activity: 1, balances: 2, paychecks: 1, salary: 1 });
  assert.equal(r.data.created.accounts, 3);
  const csv = await fs.readFile(path.join(dir, 'records/expenses.csv'), 'utf8');
  assert.equal(csv.trim().split('\n').length, 1);
});

test('import creates config, writes records, backs up, and skips duplicates on re-import', async () => {
  let r = await post('/import', payload());
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.backup, /before-import/);
  assert.equal(r.data.skipped.balances, 1); // same account+day inside the import: last wins

  const data = await (await fetch(`${base}/data`)).json();
  assert.equal(data.records.expenses.length, 3);
  assert.equal(data.records.expenses[0].payment_method, 'Sapphire');
  assert.equal(data.records.expenses[0].category, 'Coffee');
  assert.equal(data.records.balances.find((b) => b.account === 'Checking').balance, 1500.25);
  assert.equal(data.records.paychecks[0].net, 2700);
  assert.ok(data.config.categories.expense.find((c) => c.name === 'Dining').subcategories.includes('Brunch'));
  assert.ok(data.config.paymentMethods.some((p) => p.name === 'Venmo'));
  assert.ok(data.config.categories.activity.find((c) => c.name === 'Side Gig').countsAsIncome);

  r = await post('/import', payload());
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.added, { expenses: 0, activity: 0, balances: 0, paychecks: 0, salary: 0 });
  assert.equal(r.data.skipped.expenses, 3);

  // Re-importing with a different category mapping still recognizes the rows.
  const remapped = payload();
  for (const e of remapped.records.expenses) e.category = 'Dining';
  for (const e of remapped.records.expenses) e.subcategory = 'Brunch';
  r = await post('/import', { ...remapped, dryRun: true });
  assert.equal(r.data.added.expenses, 0);
});

test('an invalid row rejects the whole import', async () => {
  const before = await (await fetch(`${base}/data`)).json();
  const bad = payload();
  bad.records.expenses.push({ _source: 'Sheet1 row 9', date: '2024-02-30', amount: 1, vendor: 'X', payment_method: 'Venmo', category: 'Coffee', subcategory: 'General' });
  bad.records.salary = [{ date: '2025-01-01', employer: 'Acme', salary: 80000 }];
  const r = await post('/import', bad);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Sheet1 row 9/);
  const afterData = await (await fetch(`${base}/data`)).json();
  assert.equal(afterData.records.salary.length, before.records.salary.length);
});
