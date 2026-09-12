import { createHmac } from 'node:crypto';
import { and, asc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { db, sqlite, withSqliteTransactionSync } from '@/db/client';
import { organizations, organizationSettings, jobRequisitions, jobPublications, candidates, applications, candidateDocuments, departments } from '@/db/schema';
import { nanoid } from 'nanoid';
import { recordAuditSync } from '@/lib/audit';
import { recordCandidateActivitySync } from '@/lib/recruitment-workflow';
import { detectFileType, validateDocumentInput, MAX_DOCUMENT_BYTES } from '@/lib/documents/constants';
import { uploadCandidateDocument } from '@/lib/documents/service';

export type PublicJob = {
  slug: string;
  organizationName: string;
  title: string;
  description: string;
  location: string | null;
  employmentType: string;
  workplaceType: string;
  department: string | null;
  publishedAt: string;
  closesAt: string | null;
  applicationEnabled: boolean;
  isOpen: boolean;
};

const PUBLIC_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 50000;
const MAX_NAME = 100;
const MAX_PHONE = 40;
const MAX_COVER_LETTER = 10000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_PER_IP = 5;
const MIN_SUBMISSION_INTERVAL_MS = 45 * 1000;
const RATE_MAX_PER_EMAIL = 2;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error('SESSION_SECRET is not configured.');
  return value;
}

function publicKey(prefix: string, value: string): string {
  return `${prefix}:${createHmac('sha256', secret()).update(value).digest('hex')}`;
}

export function normalizeSlug(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140);
}

export function slugifyTitle(title: string): string {
  return normalizeSlug(title) || 'job';
}

export function validPublicSlug(slug: string): boolean {
  return slug.length >= 3 && slug.length <= 140 && PUBLIC_SLUG.test(slug);
}

export function safePublicJob(row: {
  slug: string; organizationName: string; publicTitle: string; publicDescription: string; publicLocation: string | null;
  employmentType: string; workplaceType: string; publicDepartmentName: string | null; publishedAt: string | null; closesAt: string | null; applicationEnabled: boolean;
}): PublicJob | null {
  if (!row.publishedAt || !validPublicSlug(row.slug)) return null;
  const now = Date.now();
  const isOpen = !row.closesAt || new Date(row.closesAt).getTime() > now;
  return {
    slug: row.slug, organizationName: row.organizationName, title: row.publicTitle, description: row.publicDescription,
    location: row.publicLocation, employmentType: row.employmentType, workplaceType: row.workplaceType,
    department: row.publicDepartmentName, publishedAt: row.publishedAt, closesAt: row.closesAt,
    applicationEnabled: Boolean(row.applicationEnabled) && isOpen, isOpen
  };
}

const publicConditions = (nowIso: string) => and(
  eq(jobPublications.status, 'published'),
  eq(organizations.status, 'active'),
  eq(organizationSettings.publicCareersEnabled, true),
  or(isNull(jobPublications.closesAt), gt(jobPublications.closesAt, nowIso)),
  eq(jobRequisitions.status, 'open')
);

export async function listPublicJobs(params?: { q?: string; workplaceType?: string; employmentType?: string }): Promise<PublicJob[]> {
  const now = new Date().toISOString();
  const conditions = [publicConditions(now)];
  if (params?.q?.trim()) {
    const q = `%${params.q.trim().slice(0, 80)}%`;
    conditions.push(or(sql`${jobPublications.publicTitle} LIKE ${q}`, sql`${jobPublications.publicDescription} LIKE ${q}`, sql`${jobPublications.publicLocation} LIKE ${q}`)!);
  }
  if (params?.workplaceType && ['on_site','hybrid','remote'].includes(params.workplaceType)) conditions.push(eq(jobPublications.workplaceType, params.workplaceType));
  if (params?.employmentType && ['full_time','part_time','contract','temporary','internship'].includes(params.employmentType)) conditions.push(eq(jobPublications.employmentType, params.employmentType));
  const rows = await db.select({ slug: jobPublications.publicSlug, organizationName: organizations.name, publicTitle: jobPublications.publicTitle,
    publicDescription: jobPublications.publicDescription, publicLocation: jobPublications.publicLocation, employmentType: jobPublications.employmentType,
    workplaceType: jobPublications.workplaceType, publicDepartmentName: jobPublications.publicDepartmentName, publishedAt: jobPublications.publishedAt,
    closesAt: jobPublications.closesAt, applicationEnabled: jobPublications.applicationEnabled
  }).from(jobPublications).innerJoin(organizations, eq(jobPublications.organizationId, organizations.id))
    .innerJoin(organizationSettings, eq(jobPublications.organizationId, organizationSettings.organizationId))
    .innerJoin(jobRequisitions, and(eq(jobPublications.jobRequisitionId, jobRequisitions.id), eq(jobPublications.organizationId, jobRequisitions.organizationId)))
    .where(and(...conditions)).orderBy(asc(jobPublications.publicTitle), asc(jobPublications.publicSlug));
  return rows.map(safePublicJob).filter((x): x is PublicJob => Boolean(x));
}

export async function getPublicJob(slug: string): Promise<PublicJob | null> {
  if (!validPublicSlug(slug)) return null;
  const now = new Date().toISOString();
  const rows = await db.select({ slug: jobPublications.publicSlug, organizationName: organizations.name, publicTitle: jobPublications.publicTitle,
    publicDescription: jobPublications.publicDescription, publicLocation: jobPublications.publicLocation, employmentType: jobPublications.employmentType,
    workplaceType: jobPublications.workplaceType, publicDepartmentName: jobPublications.publicDepartmentName, publishedAt: jobPublications.publishedAt,
    closesAt: jobPublications.closesAt, applicationEnabled: jobPublications.applicationEnabled
  }).from(jobPublications).innerJoin(organizations, eq(jobPublications.organizationId, organizations.id))
    .innerJoin(organizationSettings, eq(jobPublications.organizationId, organizationSettings.organizationId))
    .innerJoin(jobRequisitions, and(eq(jobPublications.jobRequisitionId, jobRequisitions.id), eq(jobPublications.organizationId, jobRequisitions.organizationId)))
    .where(and(eq(jobPublications.publicSlug, slug), publicConditions(now))).limit(1);
  return rows[0] ? safePublicJob(rows[0]) : null;
}

export async function getPublicationForInternal(organizationId: string, jobRequisitionId: string) {
  const fetch = () => db.select({ publication: jobPublications, jobStatus: jobRequisitions.status, jobTitle: jobRequisitions.title, jobDescription: jobRequisitions.description,
    jobLocation: jobRequisitions.location, jobEmploymentType: jobRequisitions.employmentType, departmentName: departments.name,
    careersEnabled: organizationSettings.publicCareersEnabled
  }).from(jobPublications).innerJoin(jobRequisitions, and(eq(jobPublications.jobRequisitionId, jobRequisitions.id), eq(jobPublications.organizationId, jobRequisitions.organizationId)))
    .leftJoin(departments, and(eq(jobRequisitions.departmentId, departments.id), eq(jobPublications.organizationId, departments.organizationId)))
    .innerJoin(organizationSettings, eq(jobPublications.organizationId, organizationSettings.organizationId))
    .where(and(eq(jobPublications.organizationId, organizationId), eq(jobPublications.jobRequisitionId, jobRequisitionId))).limit(1);
  const rows = await fetch();
  const row = rows[0];
  if (row && row.publication.status === 'published' && (row.jobStatus !== 'open' || (row.publication.closesAt && new Date(row.publication.closesAt).getTime() <= Date.now()))) {
    withSqliteTransactionSync(() => {
      sqlite.prepare(`UPDATE job_publications SET status='closed',updated_at=current_timestamp WHERE organization_id=? AND id=? AND status='published'`).run(organizationId,row.publication.id);
      recordAuditSync({organizationId,actorUserId:row.publication.createdBy,action:'job_publication_auto_closed',entityType:'job_publication',entityId:row.publication.id,metadata:{reason:row.jobStatus!=='open'?'requisition_not_open':'closing_date_reached'}});
    });
    return fetch();
  }
  return rows;
}

export async function ensurePublication(organizationId: string, actorUserId: string, jobRequisitionId: string) {
  const existing = await getPublicationForInternal(organizationId, jobRequisitionId);
  if (existing[0]) return existing[0].publication;
  const job = await db.select({ id: jobRequisitions.id, title: jobRequisitions.title, description: jobRequisitions.description, location: jobRequisitions.location, employmentType: jobRequisitions.employmentType, departmentId: jobRequisitions.departmentId, departmentName: departments.name })
    .from(jobRequisitions).leftJoin(departments, and(eq(jobRequisitions.departmentId, departments.id), eq(jobRequisitions.organizationId, departments.organizationId))).where(and(eq(jobRequisitions.organizationId, organizationId), eq(jobRequisitions.id, jobRequisitionId))).limit(1);
  const jobRow = job[0];
  if (!jobRow) throw new Error('Job requisition not found.');
  const id = nanoid();
  const slug = slugifyTitle(jobRow.title) + '-' + nanoid(6).toLowerCase();
  withSqliteTransactionSync(() => {
    sqlite.prepare(`INSERT INTO job_publications (id,organization_id,job_requisition_id,public_slug,public_title,public_description,public_location,employment_type,workplace_type,public_department_name,status,application_enabled,created_by) VALUES (?,?,?,?,?,?,?,?,?,'draft',1,?)`)
      .run(id, organizationId, jobRequisitionId, slug, jobRow.title, jobRow.description, jobRow.location, jobRow.employmentType, 'on_site', jobRow.departmentName ?? null, actorUserId);
    recordAuditSync({ organizationId, actorUserId, action: 'job_publication_created', entityType: 'job_publication', entityId: id });
  });
  return (await getPublicationForInternal(organizationId, jobRequisitionId))[0]?.publication ?? null;
}

function validatePublicText(value: string, max: number): boolean {
  return value.length > 0 && value.length <= max && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

export function validatePublicApplicationInput(input: { firstName: string; lastName: string; email: string; phone: string; coverLetter: string; consent: string; honeypot: string; startedAt: string }) {
  const email = input.email.trim().toLowerCase();
  if (!validatePublicText(input.firstName.trim(), MAX_NAME) || !validatePublicText(input.lastName.trim(), MAX_NAME)) return 'Please enter your full name.';
  if (!/^\S+@\S+\.\S{2,}$/.test(email) || email.length > 254) return 'Please enter a valid email address.';
  if (input.phone && (!validatePublicText(input.phone.trim(), MAX_PHONE) || !/^[+()\d\s.-]+$/.test(input.phone.trim()))) return 'Please enter a valid phone number.';
  if (input.coverLetter && !validatePublicText(input.coverLetter.trim(), MAX_COVER_LETTER)) return 'Your cover letter is too long.';
  if (input.consent !== 'yes') return 'Please acknowledge the application consent.';
  if (input.honeypot.trim()) return 'Unable to process the application.';
  const started = Number(input.startedAt);
  if (!Number.isFinite(started) || Date.now() - started < 2500 || Date.now() - started > 24 * 60 * 60 * 1000) return 'Unable to process the application. Please try again.';
  return null;
}

export function validatePublicResume(file: File | null): string | null {
  if (!file) return null;
  const input = validateDocumentInput(file, 'resume');
  if (input.error) return input.error;
  if (file.size > MAX_DOCUMENT_BYTES) return 'Resume exceeds the 12 MB limit.';
  return null;
}

async function checkRateLimit(key: string, organizationId: string, publicationId: string, max: number, now = new Date()): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - RATE_WINDOW_MS).toISOString();
  return withSqliteTransactionSync(() => {
    sqlite.prepare('DELETE FROM public_application_rate_limits WHERE updated_at < ?').run(cutoff);
    const row = sqlite.prepare('SELECT request_count, window_started_at, last_submitted_at FROM public_application_rate_limits WHERE key=? AND organization_id=? AND publication_id=?').get(key, organizationId, publicationId) as {request_count:number;window_started_at:string;last_submitted_at:string|null}|undefined;
    let count = 1;
    let started = nowIso;
    if (row && new Date(row.window_started_at).getTime() > now.getTime() - RATE_WINDOW_MS) {
      count = row.request_count + 1; started = row.window_started_at;
      if (row.last_submitted_at && now.getTime() - new Date(row.last_submitted_at).getTime() < MIN_SUBMISSION_INTERVAL_MS) return { allowed:false, retryAfterSeconds: Math.ceil((MIN_SUBMISSION_INTERVAL_MS - (now.getTime()-new Date(row.last_submitted_at).getTime()))/1000) };
    }
    if (count > max) return { allowed:false, retryAfterSeconds: Math.ceil((new Date(started).getTime()+RATE_WINDOW_MS-now.getTime())/1000) };
    sqlite.prepare(`INSERT INTO public_application_rate_limits (key,organization_id,publication_id,request_count,window_started_at,last_submitted_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET request_count=excluded.request_count,window_started_at=excluded.window_started_at,last_submitted_at=excluded.last_submitted_at,updated_at=excluded.updated_at`).run(key,organizationId,publicationId,count,started,nowIso,nowIso);
    return { allowed:true, retryAfterSeconds:0 };
  });
}

export async function submitPublicApplication(params: { slug: string; firstName: string; lastName: string; email: string; phone: string; coverLetter: string; consent: string; honeypot: string; startedAt: string; resume: File | null; clientAddress: string }) {
  const publicationRows = await db.select({ publication: jobPublications, jobStatus: jobRequisitions.status, organizationStatus: organizations.status, careersEnabled: organizationSettings.publicCareersEnabled, jobCreatedBy: jobRequisitions.createdBy })
    .from(jobPublications).innerJoin(jobRequisitions, and(eq(jobPublications.jobRequisitionId, jobRequisitions.id), eq(jobPublications.organizationId, jobRequisitions.organizationId)))
    .innerJoin(organizations, eq(jobPublications.organizationId, organizations.id)).innerJoin(organizationSettings, eq(jobPublications.organizationId, organizationSettings.organizationId))
    .where(and(eq(jobPublications.publicSlug, params.slug), eq(jobPublications.status,'published'), eq(organizations.status,'active'), eq(organizationSettings.publicCareersEnabled,true))).limit(1);
  const row = publicationRows[0];
  const now = Date.now();
  if (!row || row.jobStatus !== 'open' || (row.publication.closesAt && new Date(row.publication.closesAt).getTime() <= now) || !row.publication.applicationEnabled) return { ok:false as const, status:404, message:'This job is no longer accepting applications.' };

  const ipKey = publicKey('ip', `${params.clientAddress}\n${row.publication.id}`);
  const emailKey = publicKey('email', `${params.email.trim().toLowerCase()}\n${row.publication.id}`);
  const ipLimit = await checkRateLimit(ipKey,row.publication.organizationId,row.publication.id,RATE_MAX_PER_IP);
  const emailLimit = await checkRateLimit(emailKey,row.publication.organizationId,row.publication.id,RATE_MAX_PER_EMAIL);
  if (!ipLimit.allowed || !emailLimit.allowed) return { ok:false as const, status:429, message:'Unable to process the application right now. Please try again later.' };
  const validation = validatePublicApplicationInput(params);
  if (validation) return { ok:false as const, status:400, message:validation };

  if (params.resume) {
    const data = Buffer.from(await params.resume.arrayBuffer());
    const detected = detectFileType(data, params.resume.name);
    const declared = params.resume.type || null;
    const sanitizedMarkup = data.subarray(0, Math.min(data.length,512*1024)).toString('latin1');
    if (!detected || (declared && declared !== detected.mime) || /<\s*(?:script|html|svg|iframe|object|embed|meta)\b/i.test(sanitizedMarkup)) return { ok:false as const,status:400,message:'Unable to process the uploaded resume.' };
  }

  let candidateId = '';
  let applicationId = '';
  let applicationReference = '';
  try {
    withSqliteTransactionSync(() => {
      const email = params.email.trim().toLowerCase();
      const existingCandidate = sqlite.prepare('SELECT id FROM candidates WHERE organization_id=? AND email=? LIMIT 1').get(row.publication.organizationId,email) as {id:string}|undefined;
      candidateId = existingCandidate?.id ?? nanoid();
      if (!existingCandidate) {
        sqlite.prepare('INSERT INTO candidates (id,organization_id,first_name,last_name,email,phone,source,created_by) VALUES (?,?,?,?,?,?,?,?)').run(candidateId,row.publication.organizationId,params.firstName.trim(),params.lastName.trim(),email,params.phone.trim()||null,'public_careers',row.jobCreatedBy);
        recordCandidateActivitySync({organizationId:row.publication.organizationId,candidateId,activityType:'candidate_created',actorUserId:row.jobCreatedBy,summary:'Candidate received through public careers'});
        recordAuditSync({organizationId:row.publication.organizationId,actorUserId:row.jobCreatedBy,action:'candidate_created',entityType:'candidate',entityId:candidateId,metadata:{source:'public_careers'}});
      }
      const duplicate = sqlite.prepare(`SELECT id FROM applications WHERE organization_id=? AND candidate_id=? AND requisition_id=? AND status NOT IN ('rejected','withdrawn','archived') LIMIT 1`).get(row.publication.organizationId,candidateId,row.publication.jobRequisitionId) as {id:string}|undefined;
      if (duplicate) throw new Error('DUPLICATE_PUBLIC_APPLICATION');
      applicationId = nanoid(); applicationReference = `APP-${new Date().getUTCFullYear()}-${nanoid(8).toUpperCase()}`;
      sqlite.prepare(`INSERT INTO applications (id,organization_id,candidate_id,requisition_id,application_reference,status,source,current_stage,notes,public_cover_letter) VALUES (?,?,?,?,?,'applied','public_careers','applied',NULL,?)`).run(applicationId,row.publication.organizationId,candidateId,row.publication.jobRequisitionId,applicationReference,params.coverLetter.trim()||null);
      sqlite.prepare(`INSERT INTO application_history (id,organization_id,application_id,previous_status,new_status,previous_stage,new_stage,actor_user_id,reason) VALUES (?,?,?,?,?,?,?,?,?)`).run(nanoid(),row.publication.organizationId,applicationId,null,'applied',null,'applied',row.jobCreatedBy,'Public careers application received');
      recordCandidateActivitySync({organizationId:row.publication.organizationId,candidateId,applicationId,activityType:'application_created',actorUserId:row.jobCreatedBy,summary:`Application ${applicationReference} created from public careers`});
      recordAuditSync({organizationId:row.publication.organizationId,actorUserId:row.jobCreatedBy,action:'public_application_intake_accepted',entityType:'application',entityId:applicationId,metadata:{source:'public_careers',publicationId:row.publication.id}});
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'DUPLICATE_PUBLIC_APPLICATION') {
      recordAuditSync({organizationId:row.publication.organizationId,actorUserId:row.jobCreatedBy,action:'public_application_intake_rejected',entityType:'job_publication',entityId:row.publication.id,metadata:{reason:'duplicate_active_application'}});
      return {ok:true as const,status:200,message:'Thank you. Your application has been received.'};
    }
    return {ok:false as const,status:400,message:'Unable to process your application. Please try again.'};
  }

  if (params.resume) {
    const upload = await uploadCandidateDocument({ organizationId:row.publication.organizationId, candidateId, applicationId:null, documentType:'resume', file:params.resume, actorUserId:row.jobCreatedBy });
    if (upload.documentId) {
      try { sqlite.prepare(`UPDATE candidate_documents SET application_id=?,updated_at=current_timestamp WHERE organization_id=? AND id=? AND candidate_id=? AND application_id IS NULL`).run(applicationId,row.publication.organizationId,upload.documentId,candidateId); }
      catch { /* private document remains candidate-level if association fails */ }
    }
  }
  return {ok:true as const,status:200,message:'Thank you. Your application has been received.'};
}

export function clientAddressFromRequest(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const real = request.headers.get('x-real-ip')?.trim();
  return (forwarded || real || 'unknown').slice(0,128);
}

export function validatePublicOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin) return origin === new URL(request.url).origin;
  const referer = request.headers.get('referer');
  if (referer) { try { return new URL(referer).origin === new URL(request.url).origin; } catch { return false; } }
  return true;
}
