import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '..', 'nakie.db');

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

// SQLite is used only for local settings storage.
// All video data lives in Supabase.
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );
`);

export default db;
