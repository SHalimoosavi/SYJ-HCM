'use client';
import { useFormState, useFormStatus } from 'react-dom';
import { uploadOfferDocumentAction } from '../offer-actions';
function Submit(){const {pending}=useFormStatus();return <button className="btn-primary" disabled={pending}>{pending?'Uploading…':'Upload supporting document'}</button>}
export default function OfferDocumentUploadForm({offerId}:{offerId:string}){const [state,action]=useFormState(uploadOfferDocumentAction,{error:null,success:undefined});return <form action={action} encType="multipart/form-data" className="mt-4 space-y-3"><input type="hidden" name="offerId" value={offerId}/><input className="input" type="file" name="file" required accept=".pdf,.docx,.doc,.txt,.png,.jpg,.jpeg,.webp,.gif"/><input type="hidden" name="documentType" value="other"/>{state.error&&<p role="alert" className="text-sm text-red-600">{state.error}</p>}{state.success&&<p role="status" className="text-sm text-green-700">{state.success}</p>}<Submit/></form>}
