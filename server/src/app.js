import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import { HttpError } from './store.js';
import { COLLECTIONS, columnsOf, toRow } from './schema.js';
import { toTable } from './csv.js';
import { CONFIG_NAMES } from './configSchema.js';

const VERSION = '1.0.0';

function basicAuth(username, password) {
  const expected = Buffer.from(`${username}:${password}`);
  return (req, res, next) => {
    if (req.path === '/api/health') return next();
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const given = Buffer.from(encoded, 'base64');
      if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Mynance", charset="UTF-8"');
    res.status(401).send('Authentication required');
  };
}

function collectionOr404(name) {
  if (!COLLECTIONS[name]) throw new HttpError(404, `Unknown collection "${name}"`);
  return name;
}

export function createApp({ store, backups, staticDir, auth } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (auth?.username && auth?.password) app.use(basicAuth(auth.username, auth.password));

  const api = express.Router();
  api.use(express.json({ limit: '10mb' }));

  api.get('/health', (req, res) => res.json({ ok: true, version: VERSION }));

  api.get('/data', async (req, res) => {
    const data = await store.getAll();
    res.json({ ...data, meta: { version: VERSION, dataDir: store.dataDir, backupDir: backups?.dir } });
  });

  // ----- records -----
  api.post('/records/balances/batch', async (req, res) => {
    res.json({ records: await store.upsertBalances(req.body?.records) });
  });

  api.post('/records/:collection', async (req, res) => {
    const rec = await store.create(collectionOr404(req.params.collection), req.body);
    res.status(201).json(rec);
  });

  api.put('/records/:collection/:id', async (req, res) => {
    res.json(await store.update(collectionOr404(req.params.collection), req.params.id, req.body));
  });

  api.delete('/records/:collection/:id', async (req, res) => {
    res.json(await store.remove(collectionOr404(req.params.collection), req.params.id));
  });

  // ----- config -----
  api.put('/config/:name', async (req, res) => {
    if (!CONFIG_NAMES.includes(req.params.name)) throw new HttpError(404, `Unknown config "${req.params.name}"`);
    res.json(await store.saveConfig(req.params.name, req.body));
  });

  api.post('/rename', async (req, res) => {
    const result = await store.rename(req.body || {});
    const data = await store.getAll();
    res.json({ ...result, ...data });
  });

  // ----- export -----
  api.get('/export/:collection', async (req, res) => {
    const name = collectionOr404(req.params.collection.replace(/\.csv$/, ''));
    const records = await store.getCollection(name);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${COLLECTIONS[name].file}"`);
    res.send(toTable(columnsOf(name), records.map((r) => toRow(name, r))));
  });

  // ----- backups -----
  api.get('/backup', async (req, res) => {
    const { buffer } = await backups.buildZip();
    const d = new Date().toISOString().slice(0, 10);
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="mynance-backup-${d}.zip"`);
    res.send(buffer);
  });

  api.get('/backups', async (req, res) => {
    res.json({ dir: backups.dir, retention: backups.retention, backups: await backups.list() });
  });

  api.post('/backups', async (req, res) => {
    res.status(201).json(await backups.create('manual'));
  });

  api.get('/backups/:name', async (req, res) => {
    const file = backups.filePath(req.params.name);
    if (!fs.existsSync(file)) throw new HttpError(404, 'Backup not found');
    res.download(file, req.params.name);
  });

  api.post(
    '/restore',
    express.raw({ type: () => true, limit: '200mb' }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'Upload a backup .zip file');
      res.json(await backups.restore(req.body));
    },
  );

  api.use((req, res) => res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}` }));

  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Server error', details: err.details });
  });

  app.use('/api', api);

  if (staticDir && fs.existsSync(staticDir)) {
    app.use(
      express.static(staticDir, {
        index: 'index.html',
        setHeaders(res, file) {
          if (file.endsWith('index.html')) res.set('Cache-Control', 'no-cache');
          else if (file.includes(`${path.sep}assets${path.sep}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  } else {
    app.get('/', (req, res) =>
      res.type('text').send('Mynance API is running. Build the client (npm run build) to serve the web app.'),
    );
  }

  return app;
}
