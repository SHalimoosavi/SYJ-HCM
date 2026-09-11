import { db, sqlite, withSqliteTransactionSync } from '../src/db/client';
import { users } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) { console.error('Usage: npm run platform:grant-admin -- user@example.com'); process.exit(1); }

const rows = await db.select({ id: users.id, email: users.email, organizationId: users.organizationId, role: users.role, isActive: users.isActive }).from(users).where(eq(users.email, email)).limit(1);
const user = rows[0];
if (!user) { console.error('User account not found.'); process.exit(1); }
if (!user.isActive) { console.error('User account is inactive.'); process.exit(1); }

withSqliteTransactionSync(() => {
  sqlite.prepare('INSERT INTO platform_administrators (user_id) VALUES (?)').run(user.id);
  sqlite.prepare(`INSERT INTO platform_audit_logs (id, actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?, ?)`).run(
    nanoid(), user.id, 'platform_administrator_granted', 'user', user.id,
    JSON.stringify({ organizationId: user.organizationId, email: user.email, role: user.role, source: 'server_cli_bootstrap' })
  );
});
console.log(`Platform administrator granted to ${user.email}.`);
