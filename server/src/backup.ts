import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const source = path.resolve(process.env.DATABASE_PATH || './data/smilecare.db');
if (!fs.existsSync(source)) {
  console.error(`Database not found: ${source}`);
  process.exit(1);
}

const directory = path.resolve('./data/backups');
fs.mkdirSync(directory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = path.join(directory, `smilecare-${stamp}.db`);
const database = new Database(source, { readonly: true, fileMustExist: true });
await database.backup(destination);
database.close();
console.log(destination);
