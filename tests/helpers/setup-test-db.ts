import postgres from 'postgres';
import { randomUUID } from 'node:crypto';

const migrationUrl = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!migrationUrl) {
  throw new Error('DATABASE_MIGRATION_URL or DATABASE_URL must be configured for PostgreSQL tests.');
}

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-only-used-in-tests-not-real';

const admin = postgres(migrationUrl, { max: 1, connect_timeout: Number(process.env.DATABASE_CONNECT_TIMEOUT || 10) });
const parsed = new URL(migrationUrl);
const sourceDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
const testDatabase = `syj_hcm_test_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;

await admin`
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${process.env.DATABASE_RUNTIME_ROLE || 'app_runtime'}) THEN
      CREATE ROLE ${postgres.unsafe(JSON.stringify(process.env.DATABASE_RUNTIME_ROLE || 'app_runtime'))} LOGIN PASSWORD ${postgres.unsafe(JSON.stringify(process.env.DATABASE_RUNTIME_ROLE || 'app_runtime'))} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
  END
  $$
`;

await admin.unsafe(`CREATE DATABASE "${testDatabase.replaceAll('"', '""')}" TEMPLATE template0`);
await admin.end({ timeout: 5 });

const testMigrationUrl = new URL(migrationUrl);
testMigrationUrl.pathname = `/${testDatabase}`;
process.env.DATABASE_MIGRATION_URL = testMigrationUrl.toString();
process.env.DATABASE_URL = testMigrationUrl.toString().replace(
  decodeURIComponent(testMigrationUrl.username),
  encodeURIComponent(process.env.DATABASE_RUNTIME_ROLE || 'app_runtime'),
);

const { execFileSync } = await import('node:child_process');
execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'scripts/migrate.ts'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

const cleanup = async () => {
  const cleanupClient = postgres(migrationUrl, { max: 1, connect_timeout: 10 });
  try {
    await cleanupClient.unsafe(`DROP DATABASE IF EXISTS "${testDatabase.replaceAll('"', '""')}"`);
  } finally {
    await cleanupClient.end({ timeout: 5 });
  }
};

process.once('exit', () => {
  // Node's synchronous exit hook cannot await postgres.js cleanup. The test
  // database is intentionally unique per worker; normal test completion is
  // cleaned by the explicit SIGINT/SIGTERM handlers below.
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await cleanup();
    process.exit(0);
  });
}
