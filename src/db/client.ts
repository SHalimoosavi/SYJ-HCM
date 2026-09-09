import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import path from 'node:path';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// Why this file looks the way it does
// ---------------------------------------------------------------------------
// Drizzle ORM's dedicated `drizzle-orm/node-sqlite` driver (the one this file
// used to import) only ships on Drizzle's 1.0 beta/RC release line - it was
// never backported to the 0.4x stable branch we're pinned to (confirmed by
// inspecting 0.45.2's package exports: `./node-sqlite` is not one of them).
//
// Rather than move to an unstable RC for a production app, or add a native
// binary driver (better-sqlite3) we don't want, we use Drizzle's `sqlite-proxy`
// driver instead. It has been part of stable drizzle-orm since 0.29.x and
// just asks us to supply a callback that executes SQL however we like and
// returns rows as plain arrays. We implement that callback here using
// Node's built-in, synchronous `node:sqlite` module - still zero native
// binaries, still the same on-disk SQLite file, still the same schema.
//
// Everywhere else in the app, `db.select()/.insert()/.update()/.delete()`
// keep working exactly as before - this file is the only thing that changed.

const dbPath = process.env.DATABASE_PATH || './data/syj-hcm.db';
const resolvedPath = path.resolve(process.cwd(), dbPath);
fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

const sqlite = new DatabaseSync(resolvedPath);
sqlite.exec('PRAGMA journal_mode = WAL;');
sqlite.exec('PRAGMA foreign_keys = ON;');

type ProxyMethod = 'run' | 'all' | 'get' | 'values';

/**
 * node:sqlite's DatabaseSync.prepare().all()/.get() return plain objects
 * keyed by column name. Drizzle's proxy contract requires array-shaped rows
 * (one array of column values per row), so we convert here - this is the
 * same conversion Drizzle's own maintainers used when prototyping node:sqlite
 * support against the proxy driver before the dedicated driver existed.
 */
function toRowArray(row: unknown): unknown[] {
  if (row === null || row === undefined) return [];
  return Object.values(row as Record<string, unknown>);
}

export const db = drizzle(async (sql: string, params: unknown[], method: ProxyMethod) => {
  try {
    const stmt = sqlite.prepare(sql);

    switch (method) {
      case 'all':
      case 'values': {
        const rows = stmt.all(...(params as any[])) as unknown[];
        return { rows: rows.map(toRowArray) };
      }
      case 'get': {
        const row = stmt.get(...(params as any[]));
        return { rows: toRowArray(row) };
      }
      case 'run':
      default: {
        stmt.run(...(params as any[]));
        return { rows: [] };
      }
    }
  } catch (err) {
    console.error('node:sqlite proxy query failed:', { sql, params, method }, err);
    throw err;
  }
});

export type Db = typeof db;
