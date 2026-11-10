import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseTable, toTable } from './csv.js';
import { COLLECTIONS, COLLECTION_NAMES, columnsOf, fromRow, toRow, normalizeInput } from './schema.js';
import { CONFIG_FILES, CONFIG_NAMES, VALIDATORS, mergeSettings } from './configSchema.js';
import { DEFAULT_CATEGORIES, DEFAULT_PAYMENT_METHODS, DEFAULT_SETTINGS, DATA_README } from './defaults.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const lower = (s) => String(s ?? '').toLowerCase();
const newId = () => crypto.randomBytes(5).toString('hex');

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// Write via temp file + rename so a crash never leaves a half-written file.
async function atomicWrite(file, content) {
  const tmp = `${file}.${process.pid}.${newId()}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
}

function sortByDate(records) {
  return records
    .map((r, i) => [r, i])
    .sort((a, b) => (a[0].date < b[0].date ? -1 : a[0].date > b[0].date ? 1 : a[1] - b[1]))
    .map(([r]) => r);
}

const PAYCHECK_DEDUCTIONS = [
  'federal_tax', 'state_tax', 'social_security', 'medicare', 'other_tax',
  'retirement_401k', 'roth_401k', 'hsa', 'medical', 'dental', 'vision', 'other_deductions',
];

// Lookups (lower-case name -> canonical) for validating references in records.
export function refContext(accounts, paymentMethods, categories) {
  const byName = (list) => new Map(list.map((x) => [lower(x.name), x]));
  return {
    accounts: byName(accounts),
    methods: new Map([...accounts, ...paymentMethods].map((x) => [lower(x.name), x.name])),
    expense: byName(categories.expense),
    activity: byName(categories.activity),
  };
}

// Validate references and canonicalize names in place. Returns a list of errors.
export function checkRefs(name, rec, ctx) {
  const errors = [];
  if (name === 'expenses') {
    const method = ctx.methods.get(lower(rec.payment_method));
    if (rec.payment_method && !method) errors.push(`Unknown payment method "${rec.payment_method}"`);
    else if (method) rec.payment_method = method;
    const cat = ctx.expense.get(lower(rec.category));
    if (rec.category && !cat) errors.push(`Unknown category "${rec.category}"`);
    if (cat) {
      rec.category = cat.name;
      if (cat.subcategories.length > 0) {
        const sub = cat.subcategories.find((s) => lower(s) === lower(rec.subcategory));
        if (!rec.subcategory) errors.push(`subcategory is required for ${cat.name}`);
        else if (!sub) errors.push(`Unknown subcategory "${rec.subcategory}" for ${cat.name}`);
        else rec.subcategory = sub;
      }
    }
  }
  if (name === 'activity' || name === 'balances') {
    const acc = ctx.accounts.get(lower(rec.account));
    if (!acc) errors.push(`Unknown account "${rec.account}"`);
    else rec.account = acc.name;
  }
  if (name === 'activity') {
    const cat = ctx.activity.get(lower(rec.category));
    if (!cat) errors.push(`Unknown activity category "${rec.category}"`);
    else rec.category = cat.name;
  }
  if (name === 'paychecks' && rec.net === null) {
    const deductions = PAYCHECK_DEDUCTIONS.reduce((sum, k) => sum + (rec[k] || 0), 0);
    rec.net = Math.round(((rec.gross || 0) + (rec.bonus || 0) - deductions) * 100) / 100;
  }
  return errors;
}

const money2 = (n) => (n === null || n === undefined ? '' : Number(n).toFixed(2));

// Keys that identify "the same" record when importing the same data twice. They
// leave out names the importer lets you re-map (category, payment method), so
// mapping differently on a second import can't create duplicates.
export const DEDUPE_KEYS = {
  expenses: (r) => `${r.date}|${money2(r.amount)}|${lower(r.vendor)}`,
  activity: (r) => `${r.date}|${money2(r.amount)}|${lower(r.account)}`,
  balances: (r) => `${r.date}|${lower(r.account)}`,
  paychecks: (r) => `${r.date}|${money2(r.gross)}|${money2(r.net)}`,
  salary: (r) => `${r.date}|${lower(r.employer)}|${money2(r.salary)}`,
};

export class Store {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir);
    this.configDir = path.join(this.dataDir, 'config');
    this.recordsDir = path.join(this.dataDir, 'records');
    this.cache = new Map(); // file -> { mtimeMs, size, value }
    this.queue = Promise.resolve();
  }

  // Serialize every operation: one writer at a time, and reads never see half-applied changes.
  lock(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  configPath(name) {
    return path.join(this.configDir, CONFIG_FILES[name]);
  }

  recordsPath(name) {
    return path.join(this.recordsDir, COLLECTIONS[name].file);
  }

  async init() {
    await fs.mkdir(this.configDir, { recursive: true });
    await fs.mkdir(this.recordsDir, { recursive: true });
    const defaults = {
      accounts: [],
      categories: DEFAULT_CATEGORIES,
      paymentMethods: DEFAULT_PAYMENT_METHODS,
      budgets: {},
      settings: DEFAULT_SETTINGS,
    };
    for (const name of CONFIG_NAMES) {
      if (!(await exists(this.configPath(name)))) {
        await atomicWrite(this.configPath(name), JSON.stringify(defaults[name], null, 2) + '\n');
      }
    }
    for (const name of COLLECTION_NAMES) {
      if (!(await exists(this.recordsPath(name)))) {
        await atomicWrite(this.recordsPath(name), toTable(columnsOf(name), []));
      }
    }
    const readme = path.join(this.dataDir, 'README.md');
    if (!(await exists(readme))) await atomicWrite(readme, DATA_README);
  }

  clearCache() {
    this.cache.clear();
  }

  // Read a file, re-parsing only when it changed on disk (so hand edits are picked up).
  async cachedRead(file, parse) {
    let stat;
    try {
      stat = await fs.stat(file);
    } catch (err) {
      if (err.code === 'ENOENT') return parse(null);
      throw err;
    }
    const hit = this.cache.get(file);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.value;
    const text = await fs.readFile(file, 'utf8');
    const value = parse(text);
    this.cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value });
    return value;
  }

  async rememberWrite(file, value) {
    const stat = await fs.stat(file);
    this.cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value });
  }

  // ---------- config ----------

  async readConfigRaw(name) {
    const file = this.configPath(name);
    return this.cachedRead(file, (text) => {
      if (text === null) return null;
      try {
        return JSON.parse(text);
      } catch (err) {
        throw new HttpError(500, `${CONFIG_FILES[name]} is not valid JSON: ${err.message}`);
      }
    });
  }

  async readConfig(name) {
    const raw = await this.readConfigRaw(name);
    if (name === 'settings') return mergeSettings(raw || {});
    if (raw === null) return name === 'categories' ? { expense: [], activity: [] } : name === 'budgets' ? {} : [];
    if (name === 'categories') return { expense: raw.expense || [], activity: raw.activity || [] };
    return raw;
  }

  async readAllConfig() {
    const out = {};
    for (const name of CONFIG_NAMES) out[name] = await this.readConfig(name);
    return out;
  }

  async writeConfig(name, value) {
    const file = this.configPath(name);
    await atomicWrite(file, JSON.stringify(value, null, 2) + '\n');
    await this.rememberWrite(file, value);
  }

  async validateConfig(name, value) {
    const accounts = name === 'paymentMethods' ? await this.readConfig('accounts') : undefined;
    const { value: clean, errors } = VALIDATORS[name](value, accounts);
    if (name === 'accounts' && !errors.length) {
      const pms = await this.readConfig('paymentMethods');
      const names = new Set(clean.map((a) => lower(a.name)));
      for (const pm of pms) {
        if (names.has(lower(pm.name))) errors.push(`Account "${pm.name}" has the same name as a payment method`);
      }
    }
    if (errors.length) throw new HttpError(400, errors[0], errors);
    return clean;
  }

  saveConfig(name, value) {
    return this.lock(async () => {
      if (!CONFIG_NAMES.includes(name)) throw new HttpError(404, `Unknown config "${name}"`);
      const clean = await this.validateConfig(name, value);
      await this.writeConfig(name, clean);
      return name === 'settings' ? mergeSettings(clean) : clean;
    });
  }

  // ---------- records ----------

  async readRecords(name) {
    const file = this.recordsPath(name);
    const records = await this.cachedRead(file, (text) => {
      if (text === null) return [];
      return parseTable(text).records.map((row) => fromRow(name, row));
    });
    // Rows added by hand may be missing ids (or have duplicates); fix and persist.
    const seen = new Set();
    let fixed = false;
    for (const r of records) {
      if (!r.id || seen.has(r.id)) {
        r.id = newId();
        fixed = true;
      }
      seen.add(r.id);
    }
    if (fixed) await this.writeRecords(name, records);
    return records;
  }

  async writeRecords(name, records) {
    const sorted = sortByDate(records);
    const file = this.recordsPath(name);
    await atomicWrite(file, toTable(columnsOf(name), sorted.map((r) => toRow(name, r))));
    await this.rememberWrite(file, sorted);
    return sorted;
  }

  getAll() {
    return this.lock(async () => {
      const config = await this.readAllConfig();
      const records = {};
      for (const name of COLLECTION_NAMES) records[name] = await this.readRecords(name);
      return { config, records };
    });
  }

  getCollection(name) {
    return this.lock(() => {
      if (!COLLECTIONS[name]) throw new HttpError(404, `Unknown collection "${name}"`);
      return this.readRecords(name);
    });
  }

  async refContext() {
    const [accounts, paymentMethods, categories] = await Promise.all([
      this.readConfig('accounts'),
      this.readConfig('paymentMethods'),
      this.readConfig('categories'),
    ]);
    return refContext(accounts, paymentMethods, categories);
  }

  async validateRefs(name, rec) {
    return checkRefs(name, rec, await this.refContext());
  }

  async prepare(name, input) {
    if (!COLLECTIONS[name]) throw new HttpError(404, `Unknown collection "${name}"`);
    const { record, errors } = normalizeInput(name, input);
    if (!errors.length) errors.push(...(await this.validateRefs(name, record)));
    if (errors.length) throw new HttpError(400, errors[0], errors);
    return record;
  }

  create(name, input) {
    return this.lock(async () => {
      const record = await this.prepare(name, input);
      const records = await this.readRecords(name);
      if (name === 'balances') {
        const dup = records.find((r) => r.date === record.date && lower(r.account) === lower(record.account));
        if (dup) throw new HttpError(409, `${record.account} already has a balance on ${record.date}`);
      }
      record.id = newId();
      await this.writeRecords(name, [...records, record]);
      return record;
    });
  }

  update(name, id, input) {
    return this.lock(async () => {
      const record = await this.prepare(name, input);
      const records = await this.readRecords(name);
      const idx = records.findIndex((r) => r.id === id);
      if (idx === -1) throw new HttpError(404, `${COLLECTIONS[name].label} ${id} not found`);
      if (name === 'balances') {
        const dup = records.find(
          (r) => r.id !== id && r.date === record.date && lower(r.account) === lower(record.account),
        );
        if (dup) throw new HttpError(409, `${record.account} already has a balance on ${record.date}`);
      }
      record.id = id;
      const next = records.slice();
      next[idx] = record;
      await this.writeRecords(name, next);
      return record;
    });
  }

  remove(name, id) {
    return this.lock(async () => {
      if (!COLLECTIONS[name]) throw new HttpError(404, `Unknown collection "${name}"`);
      const records = await this.readRecords(name);
      const next = records.filter((r) => r.id !== id);
      if (next.length === records.length) throw new HttpError(404, `${COLLECTIONS[name].label} ${id} not found`);
      await this.writeRecords(name, next);
      return { id };
    });
  }

  // Record many balances at once (the "update balances" screen). One row per
  // account per date: an existing row for the same date is replaced.
  upsertBalances(entries) {
    return this.lock(async () => {
      if (!Array.isArray(entries) || entries.length === 0) throw new HttpError(400, 'No balances provided');
      const prepared = [];
      for (const e of entries) prepared.push(await this.prepare('balances', e));
      const keys = new Set();
      for (const p of prepared) {
        const k = `${p.date}|${lower(p.account)}`;
        if (keys.has(k)) throw new HttpError(400, `${p.account} is listed twice for ${p.date}`);
        keys.add(k);
      }
      const records = (await this.readRecords('balances')).slice();
      const saved = [];
      for (const p of prepared) {
        const idx = records.findIndex((r) => r.date === p.date && lower(r.account) === lower(p.account));
        if (idx >= 0) {
          p.id = records[idx].id;
          records[idx] = p;
        } else {
          p.id = newId();
          records.push(p);
        }
        saved.push(p);
      }
      await this.writeRecords('balances', records);
      return saved;
    });
  }

  // Rename an account, payment method, category or subcategory everywhere it is used.
  rename({ kind, from, to, parent }) {
    return this.lock(async () => {
      from = String(from ?? '').trim();
      to = String(to ?? '').trim();
      if (!from || !to) throw new HttpError(400, 'Both the current and new name are required');
      const same = (a, b) => lower(a) === lower(b);
      const updates = {}; // collection -> mapper
      let configChanges = [];

      if (kind === 'account') {
        const accounts = await this.readConfig('accounts');
        const acc = accounts.find((a) => same(a.name, from));
        if (!acc) throw new HttpError(404, `Account "${from}" not found`);
        const pms = await this.readConfig('paymentMethods');
        if (accounts.some((a) => a !== acc && same(a.name, to)) || pms.some((p) => same(p.name, to))) {
          throw new HttpError(409, `"${to}" is already in use`);
        }
        configChanges.push(['accounts', accounts.map((a) => (a === acc ? { ...a, name: to } : a))]);
        updates.activity = (r) => (same(r.account, from) ? { ...r, account: to } : r);
        updates.balances = (r) => (same(r.account, from) ? { ...r, account: to } : r);
        updates.expenses = (r) => (same(r.payment_method, from) ? { ...r, payment_method: to } : r);
      } else if (kind === 'paymentMethod') {
        const pms = await this.readConfig('paymentMethods');
        const pm = pms.find((p) => same(p.name, from));
        if (!pm) throw new HttpError(404, `Payment method "${from}" not found`);
        const accounts = await this.readConfig('accounts');
        if (pms.some((p) => p !== pm && same(p.name, to)) || accounts.some((a) => same(a.name, to))) {
          throw new HttpError(409, `"${to}" is already in use`);
        }
        configChanges.push(['paymentMethods', pms.map((p) => (p === pm ? { ...p, name: to } : p))]);
        updates.expenses = (r) => (same(r.payment_method, from) ? { ...r, payment_method: to } : r);
      } else if (kind === 'expenseCategory' || kind === 'subcategory') {
        const cats = await this.readConfig('categories');
        const budgets = await this.readConfig('budgets');
        if (kind === 'expenseCategory') {
          const cat = cats.expense.find((c) => same(c.name, from));
          if (!cat) throw new HttpError(404, `Category "${from}" not found`);
          if (cats.expense.some((c) => c !== cat && same(c.name, to))) throw new HttpError(409, `"${to}" is already in use`);
          configChanges.push(['categories', { ...cats, expense: cats.expense.map((c) => (c === cat ? { ...c, name: to } : c)) }]);
          updates.expenses = (r) => (same(r.category, from) ? { ...r, category: to } : r);
          const nextBudgets = {};
          for (const [y, b] of Object.entries(budgets)) {
            nextBudgets[y] = { ...b, items: b.items.map((it) => (same(it.category, from) ? { ...it, category: to } : it)) };
          }
          configChanges.push(['budgets', nextBudgets]);
        } else {
          const cat = cats.expense.find((c) => same(c.name, parent));
          if (!cat) throw new HttpError(404, `Category "${parent}" not found`);
          if (!cat.subcategories.some((s) => same(s, from))) throw new HttpError(404, `Subcategory "${from}" not found`);
          if (cat.subcategories.some((s) => !same(s, from) && same(s, to))) throw new HttpError(409, `"${to}" is already in use`);
          configChanges.push([
            'categories',
            {
              ...cats,
              expense: cats.expense.map((c) =>
                c === cat ? { ...c, subcategories: c.subcategories.map((s) => (same(s, from) ? to : s)) } : c,
              ),
            },
          ]);
          updates.expenses = (r) =>
            same(r.category, cat.name) && same(r.subcategory, from) ? { ...r, subcategory: to } : r;
          const nextBudgets = {};
          for (const [y, b] of Object.entries(budgets)) {
            nextBudgets[y] = {
              ...b,
              items: b.items.map((it) =>
                same(it.category, cat.name) && same(it.subcategory, from) ? { ...it, subcategory: to } : it,
              ),
            };
          }
          configChanges.push(['budgets', nextBudgets]);
        }
      } else if (kind === 'activityCategory') {
        const cats = await this.readConfig('categories');
        const cat = cats.activity.find((c) => same(c.name, from));
        if (!cat) throw new HttpError(404, `Activity category "${from}" not found`);
        if (cats.activity.some((c) => c !== cat && same(c.name, to))) throw new HttpError(409, `"${to}" is already in use`);
        configChanges.push(['categories', { ...cats, activity: cats.activity.map((c) => (c === cat ? { ...c, name: to } : c)) }]);
        updates.activity = (r) => (same(r.category, from) ? { ...r, category: to } : r);
      } else {
        throw new HttpError(400, `Unknown rename kind "${kind}"`);
      }

      // Settings may reference expense category names (dashboard exclusions, budget adjustments).
      if (kind === 'expenseCategory') {
        const settings = await this.readConfig('settings');
        const ex = settings.dashboard.excludedCategories.map((c) => (same(c, from) ? to : c));
        const adj = {};
        for (const [k, v] of Object.entries(settings.budget.categoryAdjustments || {})) adj[same(k, from) ? to : k] = v;
        configChanges.push([
          'settings',
          { ...settings, dashboard: { ...settings.dashboard, excludedCategories: ex }, budget: { ...settings.budget, categoryAdjustments: adj } },
        ]);
      }

      let changed = 0;
      for (const [name, mapper] of Object.entries(updates)) {
        const records = await this.readRecords(name);
        let n = 0;
        const next = records.map((r) => {
          const m = mapper(r);
          if (m !== r) n++;
          return m;
        });
        if (n) {
          await this.writeRecords(name, next);
          changed += n;
        }
      }
      for (const [name, value] of configChanges) await this.writeConfig(name, value);
      return { changed };
    });
  }

  // Bulk import from a spreadsheet. `create` adds accounts, payment methods and
  // categories the records need; `records` maps collection -> list of rows.
  // Everything is validated before anything is written, so a bad import changes
  // nothing. Rows matching existing records are skipped when skipDuplicates is set
  // (counted as a multiset, so two identical coffees on the same day both import
  // the first time and both skip the second time). dryRun reports without writing.
  importData({ create = {}, records = {}, skipDuplicates = true, dryRun = false } = {}) {
    return this.lock(async () => {
      const same = (a, b) => lower(a) === lower(b);
      const config = await this.readAllConfig();

      const accounts = config.accounts.slice();
      for (const a of create.accounts || []) {
        if (!accounts.some((x) => same(x.name, a.name))) accounts.push(a);
      }
      const paymentMethods = config.paymentMethods.slice();
      for (const p of create.paymentMethods || []) {
        if (!paymentMethods.some((x) => same(x.name, p.name)) && !accounts.some((x) => same(x.name, p.name))) {
          paymentMethods.push({ name: p.name });
        }
      }
      const expense = config.categories.expense.map((c) => ({ ...c, subcategories: [...c.subcategories] }));
      for (const c of create.expenseCategories || []) {
        let cat = expense.find((x) => same(x.name, c.name));
        if (!cat) {
          cat = { name: c.name, subcategories: [], excludeFromCore: !!c.excludeFromCore };
          expense.push(cat);
        }
        for (const s of c.subcategories || []) if (s && !cat.subcategories.some((x) => same(x, s))) cat.subcategories.push(s);
      }
      const activity = config.categories.activity.slice();
      for (const c of create.activityCategories || []) {
        if (!activity.some((x) => same(x.name, c.name))) activity.push({ name: c.name, countsAsIncome: !!c.countsAsIncome });
      }

      const vAccounts = VALIDATORS.accounts(accounts);
      const vMethods = vAccounts.errors.length ? { errors: [] } : VALIDATORS.paymentMethods(paymentMethods, vAccounts.value);
      const vCats = VALIDATORS.categories({ expense, activity });
      const configErrors = [...vAccounts.errors, ...vMethods.errors, ...vCats.errors];
      if (configErrors.length) throw new HttpError(400, `Nothing was imported: ${configErrors[0]}`, configErrors);

      const ctx = refContext(vAccounts.value, vMethods.value, vCats.value);
      const prepared = {};
      const errors = [];
      for (const [name, list] of Object.entries(records)) {
        if (!COLLECTIONS[name]) throw new HttpError(400, `Unknown collection "${name}"`);
        if (!Array.isArray(list)) throw new HttpError(400, `${name} must be a list`);
        prepared[name] = [];
        list.forEach((input, i) => {
          const { record, errors: errs } = normalizeInput(name, input);
          if (!errs.length) errs.push(...checkRefs(name, record, ctx));
          if (errs.length) {
            if (errors.length < 25) errors.push(`${COLLECTIONS[name].label} ${input?._source || `#${i + 1}`}: ${errs[0]}`);
            return;
          }
          prepared[name].push(record);
        });
      }
      if (errors.length) throw new HttpError(400, `Nothing was imported: ${errors[0]}`, errors);

      const added = {};
      const skipped = {};
      const writes = [];
      for (const [name, list] of Object.entries(prepared)) {
        const existing = await this.readRecords(name);
        const key = DEDUPE_KEYS[name];
        const next = existing.slice();
        let add = 0;
        let skip = 0;
        if (name === 'balances') {
          // One balance per account per day: the last row in the import wins.
          const latest = new Map();
          for (const r of list) latest.set(key(r), r);
          skip += list.length - latest.size;
          const at = new Map(existing.map((r, i) => [key(r), i]));
          for (const [k, r] of latest) {
            if (at.has(k)) {
              if (skipDuplicates) {
                skip++;
                continue;
              }
              r.id = next[at.get(k)].id;
              next[at.get(k)] = r;
            } else {
              r.id = newId();
              next.push(r);
            }
            add++;
          }
        } else {
          const counts = new Map();
          if (skipDuplicates) for (const r of existing) counts.set(key(r), (counts.get(key(r)) || 0) + 1);
          for (const r of list) {
            const k = key(r);
            if (counts.get(k) > 0) {
              counts.set(k, counts.get(k) - 1);
              skip++;
              continue;
            }
            r.id = newId();
            next.push(r);
            add++;
          }
        }
        added[name] = add;
        skipped[name] = skip;
        if (add) writes.push([name, next]);
      }

      const created = {
        accounts: vAccounts.value.length - config.accounts.length,
        paymentMethods: vMethods.value.length - config.paymentMethods.length,
        expenseCategories: vCats.value.expense.length - config.categories.expense.length,
        activityCategories: vCats.value.activity.length - config.categories.activity.length,
      };
      if (!dryRun) {
        if (created.accounts) await this.writeConfig('accounts', vAccounts.value);
        if (created.paymentMethods) await this.writeConfig('paymentMethods', vMethods.value);
        if (JSON.stringify(vCats.value) !== JSON.stringify(config.categories)) await this.writeConfig('categories', vCats.value);
        for (const [name, next] of writes) await this.writeRecords(name, next);
      }
      return { dryRun, added, skipped, created };
    });
  }

  // Raw file contents of everything worth backing up, keyed by relative path.
  dataFiles() {
    return this.lock(async () => {
      const files = {};
      for (const name of CONFIG_NAMES) {
        const p = this.configPath(name);
        if (await exists(p)) files[`config/${CONFIG_FILES[name]}`] = await fs.readFile(p);
      }
      for (const name of COLLECTION_NAMES) {
        const p = this.recordsPath(name);
        if (await exists(p)) files[`records/${COLLECTIONS[name].file}`] = await fs.readFile(p);
      }
      const readme = path.join(this.dataDir, 'README.md');
      if (await exists(readme)) files['README.md'] = await fs.readFile(readme);
      return files;
    });
  }

  // Replace data files (used by restore). Caller validates contents first.
  replaceFiles(files) {
    return this.lock(async () => {
      for (const [rel, content] of Object.entries(files)) {
        await atomicWrite(path.join(this.dataDir, rel), content);
      }
      this.clearCache();
    });
  }
}
