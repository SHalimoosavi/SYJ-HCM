import { db } from '../src/db/client';
import { platformAdministrators, platformAuditLogs, users } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) { console.error('Usage: npm run platform:grant-admin -- user@example.com'); process.exit(1); }

const rows = await db.select({ id: users.id, email: users.email, organizationId: users.organizationId, role: users.role, isActive: users.isActive }).from(users).where(eq(users.email, email)).limit(1);
const user = rows[0];
if (!user) { console.error('User account not found.'); process.exit(1); }
if (!user.isActive) { console.error('User account is inactive.'); process.exit(1); }

await db.transaction(async (tx) => {
  await tx.insert(platformAdministrators).values({ userId: user.id });
  await tx.insert(platformAuditLogs).values({
    id: nanoid(),
    actorUserId: user.id,
    action: 'platform_administrator_granted',
    entityType: 'user',
    entityId: user.id,
    metadata: JSON.stringify({ organizationId: user.organizationId, email: user.email, role: user.role, source: 'server_cli_bootstrap' }),
  });
});
console.log(`Platform administrator granted to ${user.email}.`);
