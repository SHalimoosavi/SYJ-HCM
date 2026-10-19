'use server';

import { revalidatePath } from 'next/cache';
import { requireRoleForAction } from '@/lib/auth';
import { db, setTenantContext } from '@/db/client';
import { auditLogs, jobPublications, organizationSettings } from '@/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { ensurePublication, getPublicationForInternal, normalizeSlug, validPublicSlug, slugifyTitle } from '@/lib/public-recruitment';
import { nanoid } from 'nanoid';

export type PublicationFormState = { error: string | null };
const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

export async function savePublicationAction(jobRequisitionId: string, _prev: PublicationFormState, fd: FormData): Promise<PublicationFormState> {
  const actor = await requireRoleForAction('admin', 'hr');
  try {
    const current = await getPublicationForInternal(actor.organizationId, jobRequisitionId);
    const publication = current[0]?.publication ?? await ensurePublication(actor.organizationId, actor.id, jobRequisitionId);
    if (!publication) return { error: 'Unable to prepare the publication.' };
    const title = text(fd, 'publicTitle'); const description = text(fd, 'publicDescription'); const location = text(fd, 'publicLocation') || null;
    const slug = normalizeSlug(text(fd, 'publicSlug') || slugifyTitle(title));
    const employmentType = text(fd, 'employmentType'); const workplaceType = text(fd, 'workplaceType'); const department = text(fd, 'publicDepartmentName') || null;
    const closesAtRaw = text(fd, 'closesAt');
    let closesAt: string | null = null;
    if (closesAtRaw) {
      const parsed = new Date(closesAtRaw);
      if (Number.isNaN(parsed.getTime())) return { error: 'Closing date is invalid.' };
      closesAt = parsed.toISOString();
    }
    const applicationEnabled = fd.get('applicationEnabled') === 'on';
    if (!title || title.length > 200 || !description || description.length > 50000) return { error: 'Public title and description are required and must be within the allowed limits.' };
    if (!validPublicSlug(slug)) return { error: 'Public URL slug is invalid.' };
    if (!['full_time', 'part_time', 'contract', 'temporary', 'internship'].includes(employmentType)) return { error: 'Invalid employment type.' };
    if (!['on_site', 'hybrid', 'remote'].includes(workplaceType)) return { error: 'Invalid workplace type.' };
    if (closesAt && new Date(closesAt).getTime() <= Date.now()) return { error: 'Closing date must be in the future.' };

    await db.transaction(async (tx) => {
      await setTenantContext(tx, actor.organizationId);
      const collision = await tx.select({ id: jobPublications.id }).from(jobPublications).where(and(eq(jobPublications.publicSlug, slug), sql`${jobPublications.id} <> ${publication.id}`)).limit(1);
      if (collision[0]) throw new Error('That public URL is already in use. Choose another slug.');
      await tx.update(jobPublications).set({
        publicSlug: slug, publicTitle: title, publicDescription: description, publicLocation: location,
        employmentType, workplaceType, publicDepartmentName: department, closesAt, applicationEnabled, updatedAt: new Date().toISOString(),
      }).where(and(eq(jobPublications.organizationId, actor.organizationId), eq(jobPublications.id, publication.id)));
      await tx.insert(auditLogs).values({ id: nanoid(), organizationId: actor.organizationId, actorUserId: actor.id, action: 'job_publication_updated', entityType: 'job_publication', entityId: publication.id });
    });
    revalidatePath(`/recruitment/jobs/${jobRequisitionId}`); revalidatePath(`/recruitment/jobs/${jobRequisitionId}/publication`); revalidatePath('/careers'); revalidatePath(`/careers/${slug}`);
    return { error: null };
  } catch (error) { return { error: error instanceof Error ? error.message : 'Unable to save the publication. Please review the public job details and try again.' }; }
}

export async function publishJobAction(jobRequisitionId: string): Promise<PublicationFormState> {
  const actor = await requireRoleForAction('admin', 'hr');
  try {
    const row = (await getPublicationForInternal(actor.organizationId, jobRequisitionId))[0];
    if (!row) await ensurePublication(actor.organizationId, actor.id, jobRequisitionId);
    const current = (await getPublicationForInternal(actor.organizationId, jobRequisitionId))[0];
    if (!current) return { error: 'Publication not found.' };
    if (current.jobStatus !== 'open') return { error: 'Only open job requisitions can be published.' };
    if (!current.careersEnabled) return { error: 'Public careers is disabled for this organization.' };
    if (current.publication.status !== 'draft') return { error: 'Only draft publications can be published.' };
    if (!current.publication.publicTitle || !current.publication.publicDescription || !validPublicSlug(current.publication.publicSlug)) return { error: 'Complete the public job content before publishing.' };

    await db.transaction(async (tx) => {
      await setTenantContext(tx, actor.organizationId);
      const updated = await tx.update(jobPublications)
        .set({ status: 'published', publishedAt: sql`coalesce(${jobPublications.publishedAt}, now())`, updatedAt: new Date().toISOString() })
        .where(and(eq(jobPublications.organizationId, actor.organizationId), eq(jobPublications.id, current.publication.id), eq(jobPublications.status, 'draft')))
        .returning({ id: jobPublications.id });
      if (updated.length !== 1) throw new Error('Only draft publications can be published.');
      await tx.insert(auditLogs).values({ id: nanoid(), organizationId: actor.organizationId, actorUserId: actor.id, action: 'job_published', entityType: 'job_publication', entityId: current.publication.id });
    });
    revalidatePath('/careers'); revalidatePath(`/careers/${current.publication.publicSlug}`); revalidatePath(`/recruitment/jobs/${jobRequisitionId}`); revalidatePath(`/recruitment/jobs/${jobRequisitionId}/publication`);
    return { error: null };
  } catch (error) { return { error: error instanceof Error ? error.message : 'Unable to publish the job. Please review the publication and try again.' }; }
}

export async function changePublicationStatusAction(jobRequisitionId: string, status: 'draft' | 'closed' | 'archived'): Promise<PublicationFormState> {
  const actor = await requireRoleForAction('admin', 'hr');
  try {
    const current = (await getPublicationForInternal(actor.organizationId, jobRequisitionId))[0];
    if (!current) return { error: 'Publication not found.' };
    if (status === 'draft' && current.publication.status !== 'published') return { error: 'Only published jobs can be unpublished.' };
    if (status === 'closed' && current.publication.status !== 'published') return { error: 'Only published jobs can be closed.' };

    await db.transaction(async (tx) => {
      await setTenantContext(tx, actor.organizationId);
      const updated = await tx.update(jobPublications)
        .set({ status, updatedAt: new Date().toISOString() })
        .where(and(eq(jobPublications.organizationId, actor.organizationId), eq(jobPublications.id, current.publication.id)))
        .returning({ id: jobPublications.id });
      if (updated.length !== 1) throw new Error('Publication not found.');
      await tx.insert(auditLogs).values({ id: nanoid(), organizationId: actor.organizationId, actorUserId: actor.id, action: status === 'draft' ? 'job_unpublished' : status === 'closed' ? 'job_closed' : 'job_archived', entityType: 'job_publication', entityId: current.publication.id });
    });
    revalidatePath('/careers'); revalidatePath(`/careers/${current.publication.publicSlug}`); revalidatePath(`/recruitment/jobs/${jobRequisitionId}`); revalidatePath(`/recruitment/jobs/${jobRequisitionId}/publication`);
    return { error: null };
  } catch (error) { return { error: error instanceof Error ? error.message : 'Unable to change the publication status. Please try again.' }; }
}

export async function enablePublicCareersAction(enabled: boolean): Promise<PublicationFormState> {
  const actor = await requireRoleForAction('admin');
  try {
    await db.transaction(async (tx) => {
      await setTenantContext(tx, actor.organizationId);
      await tx.update(organizationSettings).set({ publicCareersEnabled: enabled, updatedAt: new Date().toISOString() }).where(eq(organizationSettings.organizationId, actor.organizationId));
      await tx.insert(auditLogs).values({ id: nanoid(), organizationId: actor.organizationId, actorUserId: actor.id, action: 'public_careers_setting_changed', entityType: 'organization_settings', entityId: actor.organizationId, metadata: JSON.stringify({ enabled }) });
    });
    revalidatePath('/recruitment'); revalidatePath('/recruitment/jobs'); revalidatePath('/careers'); return { error: null };
  } catch (error) { return { error: error instanceof Error ? error.message : 'Unable to update the public careers setting. Please try again.' }; }
}
