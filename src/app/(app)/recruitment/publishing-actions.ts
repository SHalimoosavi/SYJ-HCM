'use server';

import { revalidatePath } from 'next/cache';
import { requireRoleForAction } from '@/lib/auth';
import { sqlite, withSqliteTransactionSync } from '@/db/client';
import { recordAuditSync } from '@/lib/audit';
import { ensurePublication, getPublicationForInternal, normalizeSlug, validPublicSlug, slugifyTitle } from '@/lib/public-recruitment';
import { nanoid } from 'nanoid';

export type PublicationFormState = { error: string | null };
const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

export async function savePublicationAction(jobRequisitionId: string, _prev: PublicationFormState, fd: FormData): Promise<PublicationFormState> {
  const actor = await requireRoleForAction('admin','hr');
  try {
    const current = await getPublicationForInternal(actor.organizationId, jobRequisitionId);
    const publication = current[0]?.publication ?? await ensurePublication(actor.organizationId, actor.id, jobRequisitionId);
    if (!publication) return { error:'Unable to prepare the publication.' };
    const title = text(fd,'publicTitle'); const description = text(fd,'publicDescription'); const location = text(fd,'publicLocation') || null;
    const slug = normalizeSlug(text(fd,'publicSlug') || slugifyTitle(title));
    const employmentType = text(fd,'employmentType'); const workplaceType = text(fd,'workplaceType'); const department = text(fd,'publicDepartmentName') || null;
    const closesAtRaw = text(fd,'closesAt'); const closesAt = closesAtRaw ? new Date(closesAtRaw).toISOString() : null;
    const applicationEnabled = fd.get('applicationEnabled') === 'on';
    if (!title || title.length > 200 || !description || description.length > 50000) return {error:'Public title and description are required and must be within the allowed limits.'};
    if (!validPublicSlug(slug)) return {error:'Public URL slug is invalid.'};
    if (!['full_time','part_time','contract','temporary','internship'].includes(employmentType)) return {error:'Invalid employment type.'};
    if (!['on_site','hybrid','remote'].includes(workplaceType)) return {error:'Invalid workplace type.'};
    if (closesAt && new Date(closesAt).getTime() <= Date.now()) return {error:'Closing date must be in the future.'};
    const collision = sqlite.prepare('SELECT id,organization_id FROM job_publications WHERE public_slug=? AND id<>? LIMIT 1').get(slug,publication.id) as {id:string;organization_id:string}|undefined;
    if (collision) return {error:'That public URL is already in use. Choose another slug.'};
    withSqliteTransactionSync(() => {
      sqlite.prepare(`UPDATE job_publications SET public_slug=?,public_title=?,public_description=?,public_location=?,employment_type=?,workplace_type=?,public_department_name=?,closes_at=?,application_enabled=?,updated_at=current_timestamp WHERE organization_id=? AND id=?`).run(slug,title,description,location,employmentType,workplaceType,department,closesAt,applicationEnabled?1:0,actor.organizationId,publication.id);
      recordAuditSync({organizationId:actor.organizationId,actorUserId:actor.id,action:'job_publication_updated',entityType:'job_publication',entityId:publication.id});
    });
    revalidatePath(`/recruitment/jobs/${jobRequisitionId}`); revalidatePath(`/recruitment/jobs/${jobRequisitionId}/publication`); revalidatePath('/careers'); revalidatePath(`/careers/${slug}`);
    return {error:null};
  } catch { return {error:'Unable to save the publication. Please review the public job details and try again.'}; }
}

export async function publishJobAction(jobRequisitionId: string): Promise<PublicationFormState> {
  const actor = await requireRoleForAction('admin','hr');
  try {
    const row = (await getPublicationForInternal(actor.organizationId,jobRequisitionId))[0];
    if (!row) { await ensurePublication(actor.organizationId,actor.id,jobRequisitionId); }
    const current = (await getPublicationForInternal(actor.organizationId,jobRequisitionId))[0];
    if (!current) return {error:'Publication not found.'};
    if (current.jobStatus !== 'open') return {error:'Only open job requisitions can be published.'};
    if (!current.careersEnabled) return {error:'Public careers is disabled for this organization.'};
    if (current.publication.status !== 'draft') return {error:'Only draft publications can be published.'};
    if (!current.publication.publicTitle || !current.publication.publicDescription || !validPublicSlug(current.publication.publicSlug)) return {error:'Complete the public job content before publishing.'};
    withSqliteTransactionSync(() => {
      sqlite.prepare(`UPDATE job_publications SET status='published',published_at=COALESCE(published_at,current_timestamp),updated_at=current_timestamp WHERE organization_id=? AND id=? AND status='draft'`).run(actor.organizationId,current.publication.id);
      recordAuditSync({organizationId:actor.organizationId,actorUserId:actor.id,action:'job_published',entityType:'job_publication',entityId:current.publication.id});
    });
    revalidatePath('/careers'); revalidatePath(`/careers/${current.publication.publicSlug}`); revalidatePath(`/recruitment/jobs/${jobRequisitionId}`); revalidatePath(`/recruitment/jobs/${jobRequisitionId}/publication`);
    return {error:null};
  } catch { return {error:'Unable to publish the job. Please review the publication and try again.'}; }
}

export async function changePublicationStatusAction(jobRequisitionId: string, status: 'draft'|'closed'|'archived'): Promise<PublicationFormState> {
  const actor = await requireRoleForAction('admin','hr');
  try {
    const current=(await getPublicationForInternal(actor.organizationId,jobRequisitionId))[0]; if(!current) return {error:'Publication not found.'};
    if(status==='draft' && current.publication.status!=='published') return {error:'Only published jobs can be unpublished.'};
    if(status==='closed' && current.publication.status!=='published') return {error:'Only published jobs can be closed.'};
    withSqliteTransactionSync(()=>{
      sqlite.prepare(`UPDATE job_publications SET status=?,updated_at=current_timestamp WHERE organization_id=? AND id=?`).run(status,actor.organizationId,current.publication.id);
      recordAuditSync({organizationId:actor.organizationId,actorUserId:actor.id,action:status==='draft'?'job_unpublished':status==='closed'?'job_closed':'job_archived',entityType:'job_publication',entityId:current.publication.id});
    });
    revalidatePath('/careers'); revalidatePath(`/careers/${current.publication.publicSlug}`); revalidatePath(`/recruitment/jobs/${jobRequisitionId}`); revalidatePath(`/recruitment/jobs/${jobRequisitionId}/publication`);
    return {error:null};
  } catch { return {error:'Unable to change the publication status. Please try again.'}; }
}

export async function enablePublicCareersAction(enabled: boolean): Promise<PublicationFormState> {
  const actor=await requireRoleForAction('admin');
  try { withSqliteTransactionSync(()=>{sqlite.prepare('UPDATE organization_settings SET public_careers_enabled=?,updated_at=current_timestamp WHERE organization_id=?').run(enabled?1:0,actor.organizationId);recordAuditSync({organizationId:actor.organizationId,actorUserId:actor.id,action:'public_careers_setting_changed',entityType:'organization_settings',entityId:actor.organizationId,metadata:{enabled}});}); revalidatePath('/recruitment');revalidatePath('/recruitment/jobs');revalidatePath('/careers');return {error:null}; }
  catch{return {error:'Unable to update the public careers setting. Please try again.'};}
}
