import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { closeDatabase, migrate, openDatabase } from './db.js';
import { logger } from './logger.js';

const config = loadConfig();
const database = openDatabase(config.databasePath);
migrate(database);

const app = createApp();
const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, 'SmileCare API listening');
});

function shutdown() {
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
