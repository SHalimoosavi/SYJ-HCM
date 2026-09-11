'use server';

import { redirect } from 'next/navigation';
import { requireRoleForAction } from '@/lib/auth';
import {
  linkEmployeeToMemberInTransaction,
  setMemberRoleInTransaction,
  setMemberStatusInTransaction,
  updateOrganizationInTransaction
} from '@/lib/organization-management';

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
