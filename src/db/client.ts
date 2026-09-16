import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as drizzleSql, type SQL } from 'drizzle-orm';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be configured for PostgreSQL.');
}

/** Raw postgres.js tagged-template client. Use this for faithful raw SQL paths. */
export const sql = postgres(databaseUrl, {
  max: Number(process.env.DATABASE_POOL_MAX || 10),
  idle_timeout: Number(process.env.DATABASE_IDLE_TIMEOUT || 20),
  connect_timeout: Number(process.env.DATABASE_CONNECT_TIMEOUT || 10)
});

/** Drizzle PostgreSQL instance backed by the same postgres.js pool. */
export const db = drizzle(sql);

export type Db = typeof db;
export type DbTransaction = Pick<Db, 'insert'> & { execute: (query: SQL) => Promise<unknown> };

/**
 * Set the tenant context for the lifetime of the current PostgreSQL
 * transaction. The value is never persisted on the pooled connection.
 */
export async function setTenantContext(tx: { execute: (query: SQL) => Promise<unknown> }, organizationId: string): Promise<void> {
  if (!organizationId) throw new Error('Authenticated user is missing organization context.');
  await tx.execute(drizzleSql`select set_config('app.current_org_id', ${organizationId}, true)`);
}


/**
 * Temporary compile-time compatibility surface for Prompt B. It contains no
 * SQLite implementation and deliberately fails if an unmigrated legacy path
 * attempts to execute. Remove these exports once the remaining application
 * raw SQL call sites are migrated to PostgreSQL.
 */
type LegacyStatement = { run: (...args: unknown[]) => { changes: number }; get: (...args: unknown[]) => any; all: (...args: unknown[]) => any[] };
export const sqlite = {
  prepare(_query: string): LegacyStatement { throw new Error('SQLite runtime access has been removed; migrate this call site to PostgreSQL.'); },
  exec(_query: string): void { throw new Error('SQLite runtime access has been removed; migrate this call site to PostgreSQL.'); }
};

export function withSqliteTransactionSync<T>(_callback: () => T): T {
  throw new Error('SQLite synchronous transactions have been removed; migrate this call site to db.transaction(async ...).');
}

export async function closeDatabase(): Promise<void> {
  await sql.end({ timeout: 5 });
}
