import postgres from 'postgres';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

function fail(message: string): never {
  console.error(`SYJ-HCM startup check failed: ${message}`);
  process.exit(1);
}

const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32 || secret === 'replace-with-a-long-random-string') {
  fail('SESSION_SECRET must be set to a unique random value of at least 32 characters.');
}
if (process.env.ALLOW_DEV_SEED === 'true') fail('ALLOW_DEV_SEED=true is not permitted when starting the production server.');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail('DATABASE_URL must be configured for PostgreSQL.');

const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL;
if (!migrationDatabaseUrl) fail('DATABASE_MIGRATION_URL must be configured for startup schema validation.');

const db = postgres(migrationDatabaseUrl, {
  max: 1,
  connect_timeout: Number(process.env.DATABASE_CONNECT_TIMEOUT || 10),
});
const migrationsDir = path.resolve(process.cwd(), 'drizzle/postgres');
const expectedMigrations = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();

try {
  const ledger = await db<{ name: string }[]>`SELECT name FROM __migrations ORDER BY name`;
  const applied = new Set(ledger.map((row) => row.name));
  const pending = expectedMigrations.filter((file) => !applied.has(file));
  if (pending.length > 0) fail(`Pending migrations: ${pending.join(', ')}. Run npm run db:migrate before npm start.`);

  const requiredTables = [
    'organizations','users','sessions','login_rate_limits','employees','departments','leave_types','leave_requests',
    'leave_balances','attendance_records','audit_logs','organization_settings','platform_administrators','platform_audit_logs',
    'job_requisitions','candidates','applications','application_history','recruitment_stages','interview_rounds','interviews',
    'interview_participants','interview_feedback','interview_feedback_corrections','interview_decisions','candidate_notes',
    'candidate_activities','candidate_documents','job_publications','public_application_rate_limits','offers','offer_history',
    'offer_response_rate_limits'
  ];
  const tableRows = await db<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY(${db.array(requiredTables)})
  `;
  const present = new Set(tableRows.map((row) => row.table_name));
  for (const table of requiredTables) if (!present.has(table)) fail(`Required database table is missing: ${table}. Run npm run db:migrate.`);

  const configuration = await db<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM organizations o
    LEFT JOIN organization_settings s ON s.organization_id = o.id
    WHERE s.organization_id IS NULL
  `;
  if (Number(configuration[0]?.count ?? 0) > 0) fail('Organization configuration is missing for one or more tenants. Run npm run db:migrate.');

  const candidateOfferColumn = await db`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='candidate_documents' AND column_name='offer_id' LIMIT 1
  `;
  if (candidateOfferColumn.length === 0) fail('Required database column is missing: candidate_documents.offer_id. Run npm run db:migrate.');

  const rlsRows = await db<{ relname: string }[]>`
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relrowsecurity = true
  `;
  const rls = new Set(rlsRows.map((row) => row.relname));
  for (const table of [...requiredTables.filter((t) => !['sessions','login_rate_limits','public_application_rate_limits'].includes(t)), 'job_publications']) {
    if (!rls.has(table)) fail(`RLS is not enabled on required tenant/public table: ${table}. Run npm run db:migrate.`);
  }
} catch (error) {
  if (error instanceof Error && error.message.startsWith('SYJ-HCM startup check failed:')) throw error;
  fail(`Unable to validate PostgreSQL startup state: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await db.end({ timeout: 5 });
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
