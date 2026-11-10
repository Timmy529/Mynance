// Reads uploaded spreadsheets into plain tables: [{ name, rows: string[][] }].
//  - .xlsx (e.g. Google Drive's "Download" of a Google Sheet): every tab, cached
//    formula results, dates converted to YYYY-MM-DD
//  - .csv / .tsv / semicolon-separated text
// No third-party xlsx library: an .xlsx file is a zip of XML parts, and we only
// need cell values.
import AdmZip from 'adm-zip';
import { parseCSV } from './csv.js';
import { HttpError } from './store.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
}

// Concatenate every <t> run inside a string item (handles rich text).
function textOf(xml) {
  let s = '';
  for (const m of xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) s += m[1] ? decode(m[1]) : '';
  return s;
}

function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref)?.[0] || 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Built-in Excel number formats that are dates.
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function isDateFormatCode(code) {
  const stripped = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dy]/i.test(stripped);
}

function dateStyles(stylesXml) {
  if (!stylesXml) return [];
  const custom = new Map();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) {
    const a = attrs(m[0]);
    custom.set(Number(a.numFmtId), a.formatCode || '');
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] || '';
  return [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = Number(attrs(m[0]).numFmtId || 0);
    return BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormatCode(custom.get(id)));
  });
}

function serialToISO(serial) {
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial + 1e-7) * 86400000;
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function trimTable(rows) {
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  let width = 0;
  for (const r of rows) {
    let w = r.length;
    while (w > 0 && r[w - 1] === '') w--;
    width = Math.max(width, w);
  }
  return rows.map((r) => {
    const out = r.slice(0, width);
    while (out.length < width) out.push('');
    return out;
  });
}

export function readXlsx(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new HttpError(400, 'That file could not be opened as an .xlsx workbook');
  }
  const read = (name) => {
    const e = zip.getEntry(name);
    return e ? e.getData().toString('utf8') : null;
  };
  const workbook = read('xl/workbook.xml');
  if (!workbook) throw new HttpError(400, 'That file is not an Excel (.xlsx) workbook');

  const rels = new Map();
  for (const m of (read('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attrs(m[0]);
    rels.set(a.Id, a.Target);
  }
  const shared = [];
  for (const m of (read('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(m[1] ? textOf(m[1]) : '');
  const isDateStyle = dateStyles(read('xl/styles.xml'));

  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const a = attrs(m[0]);
    const rid = a['r:id'] || Object.entries(a).find(([k]) => k.endsWith(':id'))?.[1];
    let target = rels.get(rid) || '';
    target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = read(target);
    if (!xml) continue;
    const rows = [];
    let lastRow = -1;
    for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
      const ra = attrs(rowMatch[1] || rowMatch[3] || '');
      const r = ra.r ? Number(ra.r) - 1 : lastRow + 1;
      lastRow = r;
      const cells = [];
      let lastCol = -1;
      for (const c of (rowMatch[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ca = attrs(c[1]);
        const col = ca.r ? colIndex(ca.r) : lastCol + 1;
        lastCol = col;
        const body = c[2] || '';
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value = '';
        if (ca.t === 's') value = v !== undefined ? shared[Number(v)] ?? '' : '';
        else if (ca.t === 'inlineStr') value = textOf(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] || '');
        else if (ca.t === 'b') value = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
        else if (ca.t === 'e') value = '';
        else if (ca.t === 'str') value = v !== undefined ? decode(v) : '';
        else if (v !== undefined) {
          const n = Number(v);
          value = isDateStyle[Number(ca.s || 0)] && Number.isFinite(n) && n > 0 ? serialToISO(n) : decode(v);
        }
        cells[col] = value.trim();
      }
      const row = Array.from({ length: cells.length }, (_, i) => cells[i] ?? '');
      rows[r] = row;
    }
    const filled = Array.from({ length: rows.length }, (_, i) => rows[i] || []);
    sheets.push({ name: a.name || `Sheet ${sheets.length + 1}`, hidden: a.state === 'hidden' || a.state === 'veryHidden', rows: trimTable(filled) });
  }
  return sheets;
}

export function readDelimited(text, name = 'Sheet 1') {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const counts = { ',': 0, '\t': 0, ';': 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  const [best, seen] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const delim = seen > 0 ? best : ',';
  // parseCSV handles commas; convert other delimiters outside quotes first.
  if (delim !== ',') {
    let out = '';
    inQ = false;
    for (const ch of text) {
      if (ch === '"') inQ = !inQ;
      if (!inQ && ch === delim) out += '\u0000';
      else if (!inQ && ch === ',') out += '\u0001';
      else out += ch;
    }
    const rows = parseCSV(out.replace(/\u0000/g, ',')).map((r) => r.map((c) => c.replace(/\u0001/g, ',').trim()));
    return [{ name, hidden: false, rows: trimTable(rows) }];
  }
  return [{ name, hidden: false, rows: trimTable(parseCSV(text).map((r) => r.map((c) => c.trim()))) }];
}

export function readSpreadsheet(buffer, filename = '') {
  if (!buffer || !buffer.length) throw new HttpError(400, 'The file is empty');
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (isZip) return readXlsx(buffer);
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf) {
    throw new HttpError(400, 'Old .xls files are not supported. Save or download it as .xlsx or .csv instead.');
  }
  const base = filename.replace(/\.[^.]+$/, '') || 'Sheet 1';
  return readDelimited(buffer.toString('utf8'), base);
}
