import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function fail(message: string): never {
  console.error(`SYJ-HCM startup check failed: ${message}`);
  process.exit(1);
}

const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32 || secret === 'replace-with-a-long-random-string') {
  fail('SESSION_SECRET must be set to a unique random value of at least 32 characters.');
}

if (process.env.ALLOW_DEV_SEED === 'true') {
  fail('ALLOW_DEV_SEED=true is not permitted when starting the production server.');
}

const dbPath = process.env.DATABASE_PATH || './data/syj-hcm.db';
const resolvedPath = path.resolve(process.cwd(), dbPath);
if (!fs.existsSync(resolvedPath)) {
  fail(`Database file does not exist at ${resolvedPath}. Run npm run db:migrate before npm start.`);
}

const migrationsDir = path.resolve(process.cwd(), 'drizzle');
const expectedMigrations = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

const db = new DatabaseSync(resolvedPath);
try {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  const migrationTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__migrations'")
    .get();
  if (!migrationTable) {
    fail('Migration ledger is missing. Run npm run db:migrate before npm start.');
  }

  const appliedRows = db.prepare('SELECT name FROM __migrations').all() as { name: string }[];
  const applied = new Set(appliedRows.map((row) => row.name));
  const pending = expectedMigrations.filter((file) => !applied.has(file));
  if (pending.length > 0) {
    fail(`Pending migrations: ${pending.join(', ')}. Run npm run db:migrate before npm start.`);
  }

  const requiredTables = ['organizations', 'users', 'sessions', 'login_rate_limits', 'employees', 'departments', 'leave_types', 'leave_requests', 'leave_balances', 'attendance_records', 'audit_logs'];
  for (const table of requiredTables) {
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(table);
    if (!exists) fail(`Required database table is missing: ${table}. Run npm run db:migrate.`);
  }
} finally {
  db.close();
}

const nextBin = path.resolve(process.cwd(), 'node_modules/next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, 'start'], { stdio: 'inherit', env: process.env });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
child.on('error', (error) => {
  console.error('Unable to start Next.js:', error);
  process.exit(1);
});
