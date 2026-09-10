import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import path from 'node:path';
import fs from 'node:fs';

const dbPath = process.env.DATABASE_PATH || './data/syj-hcm.db';
const resolvedPath = path.resolve(process.cwd(), dbPath);
fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

export const sqlite = new DatabaseSync(resolvedPath);
sqlite.exec('PRAGMA journal_mode = WAL;');
sqlite.exec('PRAGMA foreign_keys = ON;');
sqlite.exec('PRAGMA busy_timeout = 5000;');

type ProxyMethod = 'run' | 'all' | 'get' | 'values';

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

/**
 * Executes a short, fully synchronous SQLite transaction. The callback must
 * not await or perform network work. Keeping the callback synchronous means
 * another request cannot accidentally interleave its statements into this
 * transaction on the single DatabaseSync connection.
 */
export function withSqliteTransactionSync<T>(callback: () => T): T {
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    sqlite.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      sqlite.exec('ROLLBACK');
    } catch {
      // Preserve the original application error if rollback itself fails.
    }
    throw error;
  }
}

export type Db = typeof db;
