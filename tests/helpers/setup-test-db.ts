import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const migrationUrl = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!migrationUrl) {
  throw new Error('DATABASE_MIGRATION_URL or DATABASE_URL must be configured for PostgreSQL tests.');
}

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-only-used-in-tests-not-real';

const runtimeRole = process.env.DATABASE_RUNTIME_ROLE || 'app_runtime';
const runtimePassword = process.env.DATABASE_RUNTIME_PASSWORD || 'app_runtime';
const admin = postgres(migrationUrl, { max: 1, connect_timeout: Number(process.env.DATABASE_CONNECT_TIMEOUT || 10) });
const testDatabase = `syj_hcm_test_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;

const roleRows = await admin<{ rolname: string }[]>`
  SELECT rolname FROM pg_roles WHERE rolname = ${runtimeRole} LIMIT 1
`;
if (roleRows.length === 0) {
  const safeRole = runtimeRole.replaceAll('"', '""');
  const safePassword = runtimePassword.replaceAll("'", "''");
  await admin.unsafe(
    `CREATE ROLE "${safeRole}" LOGIN PASSWORD '${safePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
  );
}

await admin.unsafe(`CREATE DATABASE "${testDatabase.replaceAll('"', '""')}" TEMPLATE template0`);
await admin.end({ timeout: 5 });

const testMigrationUrl = new URL(migrationUrl);
testMigrationUrl.pathname = `/${testDatabase}`;
process.env.DATABASE_MIGRATION_URL = testMigrationUrl.toString();

const runtimeUrl = new URL(testMigrationUrl.toString());
runtimeUrl.username = runtimeRole;
runtimeUrl.password = runtimePassword;
process.env.DATABASE_URL = runtimeUrl.toString();

execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'scripts/migrate.ts'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

const cleanup = async () => {
  const cleanupClient = postgres(migrationUrl, { max: 1, connect_timeout: 10 });
  try {
    await cleanupClient.unsafe(`DROP DATABASE IF EXISTS "${testDatabase.replaceAll('"', '""')}" WITH (FORCE)`);
  } finally {
    await cleanupClient.end({ timeout: 5 });
  }
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await cleanup();
    process.exit(0);
  });
}
