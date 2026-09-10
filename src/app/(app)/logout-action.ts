'use server';

import { destroySession } from '@/lib/session';
import { getCurrentUser } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { redirect } from 'next/navigation';

export async function logoutAction(): Promise<void> {
  const user = await getCurrentUser();
  if (user) {
    await recordAudit({ organizationId: user.organizationId, actorUserId: user.id, action: 'logout', entityType: 'user', entityId: user.id });
  }
  await destroySession();
  redirect('/login');
}
