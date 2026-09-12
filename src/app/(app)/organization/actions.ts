'use server';

import { redirect } from 'next/navigation';
import { requireRoleForAction } from '@/lib/auth';
import {
  linkEmployeeToMemberInTransaction,
  setMemberRoleInTransaction,
  setMemberStatusInTransaction,
  updateOrganizationInTransaction
} from '@/lib/organization-management';
import { updateOrganizationConfigurationInTransaction } from '@/lib/platform';
import { enablePublicCareersAction } from '@/app/(app)/recruitment/publishing-actions';

function errorRedirect(message: string): never {
  redirect(`/organization?error=${encodeURIComponent(message)}`);
}

export async function updateOrganizationAction(formData: FormData): Promise<void> {
  const actor = await requireRoleForAction('admin');
  try {
    updateOrganizationInTransaction(actor, {
      name: String(formData.get('name') ?? ''),
      slug: String(formData.get('slug') ?? '')
    });
  } catch (error) {
    errorRedirect(error instanceof Error ? error.message : 'Organization update failed.');
  }
  redirect('/organization?saved=1');
}

export async function setMemberStatusAction(formData: FormData): Promise<void> {
  const actor = await requireRoleForAction('admin');
  const targetUserId = String(formData.get('userId') ?? '');
  const isActive = String(formData.get('isActive') ?? '') === 'true';
  try {
    setMemberStatusInTransaction(actor, targetUserId, isActive);
  } catch (error) {
    errorRedirect(error instanceof Error ? error.message : 'Member status update failed.');
  }
  redirect('/organization/members?saved=1');
}

export async function setMemberRoleAction(formData: FormData): Promise<void> {
  const actor = await requireRoleForAction('admin');
  const targetUserId = String(formData.get('userId') ?? '');
  const role = String(formData.get('role') ?? '') as 'admin' | 'hr' | 'employee';
  try {
    setMemberRoleInTransaction(actor, targetUserId, role);
  } catch (error) {
    redirect(`/organization/members?error=${encodeURIComponent(error instanceof Error ? error.message : 'Role update failed.')}`);
  }
  redirect('/organization/members?saved=1');
}

export async function linkEmployeeAction(formData: FormData): Promise<void> {
  const actor = await requireRoleForAction('admin');
  const targetUserId = String(formData.get('userId') ?? '');
  const rawEmployeeId = String(formData.get('employeeId') ?? '');
  try {
    linkEmployeeToMemberInTransaction(actor, targetUserId, rawEmployeeId || null);
  } catch (error) {
    redirect(`/organization/members?error=${encodeURIComponent(error instanceof Error ? error.message : 'Employee link update failed.')}`);
  }
  redirect('/organization/members?saved=1');
}

export async function updatePublicCareersAction(formData: FormData): Promise<void> {
  const result = await enablePublicCareersAction(String(formData.get('publicCareersEnabled') ?? '') === 'true');
  if (result.error) errorRedirect(result.error);
  redirect('/organization?saved=careers');
}

export async function updateOrganizationConfigurationAction(formData: FormData): Promise<void> {
  const actor = await requireRoleForAction('admin');
  try {
    updateOrganizationConfigurationInTransaction(actor, {
      timezone: String(formData.get('timezone') ?? ''),
      locale: String(formData.get('locale') ?? ''),
      dateFormat: String(formData.get('dateFormat') ?? ''),
      weekStartDay: Number(formData.get('weekStartDay') ?? -1)
    });
  } catch (error) {
    errorRedirect(error instanceof Error ? error.message : 'Organization configuration update failed.');
  }
  redirect('/organization?saved=config');
}
