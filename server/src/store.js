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

  // Check references (accounts, categories, payment methods) against config.
  async validateRefs(name, rec) {
    const errors = [];
    if (name === 'expenses') {
      const [accounts, pms, cats] = await Promise.all([
        this.readConfig('accounts'),
        this.readConfig('paymentMethods'),
        this.readConfig('categories'),
      ]);
      const methods = new Set([...accounts, ...pms].map((x) => lower(x.name)));
      if (rec.payment_method && !methods.has(lower(rec.payment_method))) {
        errors.push(`Unknown payment method "${rec.payment_method}"`);
      }
      const cat = cats.expense.find((c) => lower(c.name) === lower(rec.category));
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
      const accounts = await this.readConfig('accounts');
      const acc = accounts.find((a) => lower(a.name) === lower(rec.account));
      if (!acc) errors.push(`Unknown account "${rec.account}"`);
      else rec.account = acc.name;
    }
    if (name === 'activity') {
      const cats = await this.readConfig('categories');
      const cat = cats.activity.find((c) => lower(c.name) === lower(rec.category));
      if (!cat) errors.push(`Unknown activity category "${rec.category}"`);
      else rec.category = cat.name;
    }
    if (name === 'paychecks' && rec.net === null) {
      const deductions = [
        'federal_tax', 'state_tax', 'social_security', 'medicare', 'other_tax',
        'retirement_401k', 'roth_401k', 'hsa', 'medical', 'dental', 'vision', 'other_deductions',
      ].reduce((sum, k) => sum + (rec[k] || 0), 0);
      rec.net = Math.round(((rec.gross || 0) + (rec.bonus || 0) - deductions) * 100) / 100;
    }
    return errors;
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
