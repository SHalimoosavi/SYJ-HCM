import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const migrationUrl = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!migrationUrl) {
  throw new Error('DATABASE_MIGRATION_URL or DATABASE_URL must be configured for PostgreSQL tests.');
}

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-only-used-in-tests-not-real';

const runtimeRole = process.env.DATABASE_RUNTIME_ROLE || 'app_runtime';
const runtimePassword = process.env.DATABASE_RUNTIME_PASSWORD || 'app_runtime';
const testDatabase = `syj_hcm_test_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

const psql = (args: string[]) => {
  execFileSync('psql', [migrationUrl, '-v', 'ON_ERROR_STOP=1', ...args], {
    stdio: 'inherit',
    env: process.env,
  });
};

const roleExists = execFileSync(
  'psql',
  [migrationUrl, '-Atqc', `SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(runtimeRole)} LIMIT 1`],
  {
    env: { ...process.env, PGAPPNAME: 'syj-hcm-test-bootstrap', PGTZ: 'UTC' },
    encoding: 'utf8',
  },
).trim();

if (!roleExists) {
  psql(['-c', `CREATE ROLE ${quoteIdentifier(runtimeRole)} LOGIN PASSWORD ${quoteLiteral(runtimePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`]);
}

psql(['-c', `CREATE DATABASE ${quoteIdentifier(testDatabase)} TEMPLATE template0`]);

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

const cleanup = () => {
  try {
    psql(['-c', `DROP DATABASE IF EXISTS ${quoteIdentifier(testDatabase)} WITH (FORCE)`]);
  } catch {
    // Cleanup must not mask the original test failure.
  }
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    cleanup();
    process.exit(0);
  });
}
