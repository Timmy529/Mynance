import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { HttpError } from './store.js';
import { parseTable } from './csv.js';
import { CONFIG_FILES, VALIDATORS } from './configSchema.js';
import { COLLECTIONS } from './schema.js';

const NAME_RE = /^mynance-\d{8}-\d{6}(-[a-z0-9-]+)?\.zip$/;

const CONFIG_BY_FILE = Object.fromEntries(Object.entries(CONFIG_FILES).map(([k, v]) => [v, k]));
const RECORD_FILES = new Set(Object.values(COLLECTIONS).map((c) => c.file));

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function hashFiles(files) {
  const h = crypto.createHash('sha256');
  for (const key of Object.keys(files).sort()) {
    h.update(key);
    h.update('\0');
    h.update(files[key]);
    h.update('\0');
  }
  return h.digest('hex');
}

export class Backups {
  constructor(store, { dir, retention = 30 } = {}) {
    this.store = store;
    this.dir = path.resolve(dir || path.join(store.dataDir, 'backups'));
    this.retention = retention;
    this.timer = null;
  }

  async buildZip() {
    const files = await this.store.dataFiles();
    const zip = new AdmZip();
    for (const [rel, content] of Object.entries(files)) zip.addFile(rel, content);
    const hash = hashFiles(files);
    zip.addZipComment(`mynance:${hash}`);
    return { buffer: zip.toBuffer(), hash };
  }

  async list() {
    let names = [];
    try {
      names = (await fs.readdir(this.dir)).filter((n) => NAME_RE.test(n));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    const out = [];
    for (const name of names) {
      const stat = await fs.stat(path.join(this.dir, name));
      out.push({ name, size: stat.size, created: stat.mtime.toISOString() });
    }
    return out.sort((a, b) => (a.name < b.name ? 1 : -1));
  }

  filePath(name) {
    if (!NAME_RE.test(name)) throw new HttpError(400, 'Invalid backup name');
    return path.join(this.dir, name);
  }

  // Create a snapshot. Automatic snapshots are skipped when nothing changed since the last one.
  async create(reason = 'manual', { skipIfUnchanged = false } = {}) {
    await fs.mkdir(this.dir, { recursive: true });
    const { buffer, hash } = await this.buildZip();
    if (skipIfUnchanged) {
      const [latest] = await this.list();
      if (latest) {
        try {
          const comment = new AdmZip(path.join(this.dir, latest.name)).getZipComment();
          if (comment === `mynance:${hash}`) return null;
        } catch {
          // unreadable previous backup: take a fresh one
        }
      }
    }
    const name = `mynance-${stamp()}-${reason}.zip`;
    const file = path.join(this.dir, name);
    await fs.writeFile(file, buffer);
    await this.prune();
    const stat = await fs.stat(file);
    return { name, size: stat.size, created: stat.mtime.toISOString() };
  }

  async prune() {
    if (!this.retention || this.retention < 1) return;
    const all = await this.list();
    for (const old of all.slice(this.retention)) {
      await fs.rm(path.join(this.dir, old.name), { force: true });
    }
  }

  // Validate a backup zip and return { files } ready to write. Accepts zips made by
  // the app or a zip of the data folder (files may be nested one folder deep).
  parseRestore(buffer) {
    let zip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      throw new HttpError(400, 'That file is not a valid zip archive');
    }
    const files = {};
    const errors = [];
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const name = entry.entryName.replace(/\\/g, '/');
      if (name.includes('__MACOSX')) continue;
      const m = /(?:^|\/)(config|records)\/([^/]+)$/.exec(name);
      if (!m) continue;
      const [, dir, file] = m;
      const content = entry.getData();
      const text = content.toString('utf8');
      if (dir === 'config' && CONFIG_BY_FILE[file]) {
        try {
          const parsed = JSON.parse(text);
          const { errors: errs } = VALIDATORS[CONFIG_BY_FILE[file]](parsed, []);
          if (errs?.length && CONFIG_BY_FILE[file] !== 'paymentMethods') errors.push(`${file}: ${errs[0]}`);
        } catch (err) {
          errors.push(`${file}: ${err.message}`);
        }
        files[`config/${file}`] = content;
      } else if (dir === 'records' && RECORD_FILES.has(file)) {
        const { headers } = parseTable(text);
        if (!headers.includes('date')) errors.push(`${file}: missing a "date" column`);
        files[`records/${file}`] = content;
      }
    }
    if (errors.length) throw new HttpError(400, `Backup is not valid: ${errors[0]}`, errors);
    if (Object.keys(files).length === 0) {
      throw new HttpError(400, 'No Mynance data found in that zip (expected config/*.json and records/*.csv)');
    }
    return files;
  }

  async restore(buffer) {
    const files = this.parseRestore(buffer);
    const safety = await this.create('before-restore');
    await this.store.replaceFiles(files);
    return { restored: Object.keys(files).sort(), safetyBackup: safety?.name };
  }

  startSchedule(hours = 24) {
    if (!hours || hours <= 0) return;
    const tick = async () => {
      try {
        const [latest] = await this.list();
        const age = latest ? Date.now() - new Date(latest.created).getTime() : Infinity;
        if (age >= hours * 3600 * 1000) {
          const made = await this.create('auto', { skipIfUnchanged: true });
          if (made) console.log(`[backup] created ${made.name}`);
        }
      } catch (err) {
        console.error('[backup] failed:', err.message);
      }
    };
    tick();
    this.timer = setInterval(tick, 60 * 60 * 1000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}
