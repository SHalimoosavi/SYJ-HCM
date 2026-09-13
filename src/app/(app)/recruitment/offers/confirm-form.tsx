'use client';
import { useFormStatus } from 'react-dom';
import type { FormEvent, ReactNode } from 'react';
function Button({children,className}:{children:ReactNode;className:string}){const {pending}=useFormStatus();return <button className={className} disabled={pending}>{pending?'Working…':children}</button>}
export default function ConfirmForm({action,offerId,children,confirmMessage,className='btn-secondary'}:{action:(fd:FormData)=>void|Promise<void>;offerId:string;children:ReactNode;confirmMessage:string;className?:string}){function submit(e:FormEvent<HTMLFormElement>){if(!window.confirm(confirmMessage))e.preventDefault()}return <form action={action} onSubmit={submit}><input type="hidden" name="offerId" value={offerId}/><Button className={className}>{children}</Button></form>}
