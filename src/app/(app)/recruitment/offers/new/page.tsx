import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { listOfferEligibleApplications } from '@/lib/offers';
import NewOfferForm from './form';
export default async function NewOfferPage(){const u=await requireRole('admin','hr');const applications=await listOfferEligibleApplications(u.organizationId);return <div className="max-w-4xl space-y-6"><div><Link className="text-sm text-brand-600 hover:underline" href="/recruitment/offers">← Offers</Link><p className="mt-2 text-sm font-medium text-brand-600">Recruitment / Offers</p><h1 className="mt-1 text-2xl font-semibold">Create offer</h1><p className="mt-1 text-sm text-surface-500">Create a controlled draft from an eligible ATS application.</p></div><NewOfferForm applications={applications}/></div>}
