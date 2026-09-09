import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = process.env.DATABASE_PATH || './data/syj-hcm.db';
const resolvedPath = path.resolve(process.cwd(), dbPath);
fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

const migrationsDir = path.resolve(process.cwd(), 'drizzle');
const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const db = new DatabaseSync(resolvedPath);
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS __migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (current_timestamp)
  );
`);

const appliedRows = db.prepare('SELECT name FROM __migrations').all() as { name: string }[];
const applied = new Set(appliedRows.map((r) => r.name));

for (const file of files) {
  if (applied.has(file)) {
    console.log(`skip (already applied): ${file}`);
    continue;
  }
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
  console.log(`applying: ${file}`);
  db.exec(sql);
  db.prepare('INSERT INTO __migrations (name) VALUES (?)').run(file);
}

db.close();
console.log('Migrations complete.');
