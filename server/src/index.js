import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { Backups } from './backup.js';
import { createApp } from './app.js';
import { dropPrivileges } from './privileges.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const env = process.env;
const config = {
  port: Number(env.PORT || 8080),
  host: env.HOST || '0.0.0.0',
  dataDir: path.resolve(env.DATA_DIR || path.join(here, '../../data')),
  backupDir: env.BACKUP_DIR ? path.resolve(env.BACKUP_DIR) : undefined,
  backupRetention: Number(env.BACKUP_RETENTION ?? 30),
  backupIntervalHours: Number(env.BACKUP_INTERVAL_HOURS ?? 24),
  staticDir: path.resolve(env.STATIC_DIR || path.join(here, '../../client/dist')),
  auth: { username: env.MYNANCE_USERNAME || (env.MYNANCE_PASSWORD ? 'mynance' : ''), password: env.MYNANCE_PASSWORD || '' },
};

const dropped = await dropPrivileges([config.dataDir, config.backupDir]);
if (dropped) console.log(`Running as uid ${dropped.uid}, gid ${dropped.gid}`);

const store = new Store(config.dataDir);
await store.init();
const backups = new Backups(store, { dir: config.backupDir, retention: config.backupRetention });
const app = createApp({ store, backups, staticDir: config.staticDir, auth: config.auth });

const server = app.listen(config.port, config.host, () => {
  console.log(`Mynance listening on http://${config.host}:${config.port}`);
  console.log(`  data:    ${config.dataDir}`);
  console.log(`  backups: ${backups.dir} (keep ${config.backupRetention}, every ${config.backupIntervalHours}h)`);
  if (config.auth.password) console.log(`  auth:    basic auth enabled for user "${config.auth.username}"`);
});

backups.startSchedule(config.backupIntervalHours);

function shutdown() {
  backups.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
