// Minimal RFC 4180 CSV reader/writer. No dependencies so the on-disk format is
// fully under our control: comma separated, double-quote escaping, "\n" line endings.

export function parseCSV(text) {
  if (!text) return [];
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM (Excel exports)
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
    } else if (c === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (c === '\r') {
      i++;
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully blank lines (common when files are hand-edited).
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

function escapeField(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s) || s !== s.trim()) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function toCSV(rows) {
  return rows.map((r) => r.map(escapeField).join(',')).join('\n') + '\n';
}

// Parse CSV text into objects keyed by header name. Header names are matched
// case-insensitively and with spaces converted to underscores, so a hand-edited
// header like "Payment Method" still maps to payment_method.
export function parseTable(text) {
  const rows = parseCSV(text);
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const records = rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx] !== undefined ? r[idx] : '';
    });
    return obj;
  });
  return { headers, records };
}

export function toTable(columns, records) {
  return toCSV([columns, ...records.map((rec) => columns.map((c) => rec[c]))]);
}
