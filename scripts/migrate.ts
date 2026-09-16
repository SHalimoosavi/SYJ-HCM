import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const databaseUrl = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_MIGRATION_URL or DATABASE_URL must be configured.');

  const runtimeRole = process.env.DATABASE_RUNTIME_ROLE || 'app_runtime';
  const migrationsDir = path.resolve(process.cwd(), 'drizzle/postgres');
  const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
  if (files.length === 0) throw new Error(`No PostgreSQL migrations found in ${migrationsDir}.`);

  const db = postgres(databaseUrl, { max: 1, connect_timeout: Number(process.env.DATABASE_CONNECT_TIMEOUT || 10) });

  try {
    await db`SELECT set_config('app.runtime_role', ${runtimeRole}, false)`;
    await db`
      CREATE TABLE IF NOT EXISTS __migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    for (const file of files) {
      const migrationSql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await db.begin(async (tx) => {
        // Serialize migration runners and re-check the ledger AFTER
        // acquiring the transaction-scoped advisory lock. This prevents
        // concurrent runners from applying the same migration twice.
        await tx`SELECT pg_advisory_xact_lock(hashtext('syj-hcm-schema-migration'))`;

        const applied = await tx`SELECT 1 FROM __migrations WHERE name = ${file} LIMIT 1`;
        if (applied.length > 0) {
          console.log(`already applied: ${file}`);
          return;
        }

        console.log(`applying: ${file}`);
        await tx.unsafe(migrationSql);
        await tx`INSERT INTO __migrations (name) VALUES (${file})`;
      });
    }

    console.log(`Migrations complete. Applied/verified ${files.length} PostgreSQL migration files.`);
  } finally {
    await db.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
