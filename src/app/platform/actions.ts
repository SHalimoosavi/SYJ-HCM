'use server';

import { redirect } from 'next/navigation';
import { requirePlatformAdmin } from '@/lib/auth';
import { provisionOrganizationInTransaction, setOrganizationStatusInTransaction } from '@/lib/platform';

function fail(message: string): never { redirect(`/platform?error=${encodeURIComponent(message)}`); }

export async function provisionOrganizationAction(formData: FormData): Promise<void> {
  const actor = await requirePlatformAdmin();
  try {
    provisionOrganizationInTransaction(actor, {
      name: String(formData.get('name') ?? ''),
      slug: String(formData.get('slug') ?? ''),
      adminEmail: String(formData.get('adminEmail') ?? ''),
      adminPassword: String(formData.get('adminPassword') ?? '')
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Organization provisioning failed.');
  }
  redirect('/platform?saved=provisioned');
}

export async function setOrganizationStatusAction(formData: FormData): Promise<void> {
  const actor = await requirePlatformAdmin();
  try {
    const status = String(formData.get('status') ?? '');
    if (status !== 'active' && status !== 'suspended') throw new Error('Invalid organization lifecycle state.');
    setOrganizationStatusInTransaction(actor, String(formData.get('organizationId') ?? ''), status);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Organization lifecycle action failed.');
  }
  redirect('/platform?saved=lifecycle');
}
