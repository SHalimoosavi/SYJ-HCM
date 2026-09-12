import { NextResponse } from 'next/server';
import { clientAddressFromRequest, submitPublicApplication, validatePublicOrigin } from '@/lib/public-recruitment';
import { MAX_DOCUMENT_BYTES } from '@/lib/documents/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = MAX_DOCUMENT_BYTES + 512 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    if (!validatePublicOrigin(request)) return NextResponse.json({ message: 'Unable to process your application.' }, { status: 403, headers: { 'Cache-Control':'no-store' } });
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data;')) return NextResponse.json({ message:'Unable to process your application.' }, { status:400, headers:{'Cache-Control':'no-store'} });
    const rawLength = request.headers.get('content-length');
    if (!rawLength) return NextResponse.json({message:'Unable to process your application.'},{status:411,headers:{'Cache-Control':'no-store'}});
    const length = Number(rawLength);
    if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_REQUEST_BYTES) return NextResponse.json({ message:'Your submission is too large.' }, { status:413, headers:{'Cache-Control':'no-store'} });
    const { slug } = await params;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 140) return NextResponse.json({message:'Unable to process your application.'},{status:404,headers:{'Cache-Control':'no-store'}});
    const form = await request.formData();
    const resumeValue=form.get('resume');
    const resume=resumeValue instanceof File && resumeValue.size>0 ? resumeValue : null;
    const result=await submitPublicApplication({
      slug,
      firstName:String(form.get('firstName')??''),
      lastName:String(form.get('lastName')??''),
      email:String(form.get('email')??''),
      phone:String(form.get('phone')??''),
      coverLetter:String(form.get('coverLetter')??''),
      consent:String(form.get('consent')??''),
      honeypot:String(form.get('website')??''),
      startedAt:String(form.get('startedAt')??''),
      resume,
      clientAddress:clientAddressFromRequest(request)
    });
    return NextResponse.json({message:result.message},{status:result.status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  } catch {
    return NextResponse.json({message:'Unable to process your application. Please try again.'},{status:400,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
}

export async function GET() { return NextResponse.json({message:'Method not allowed.'},{status:405,headers:{Allow:'POST','Cache-Control':'no-store'}}); }
