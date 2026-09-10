'use client';
import { useEffect } from 'react';
export function useModal(open:boolean,onClose:()=>void){
 useEffect(()=>{if(!open)return;const previouslyFocused=document.activeElement as HTMLElement|null;const previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
 const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();onClose();return;}if(e.key!=='Tab')return;const modal=document.querySelector<HTMLElement>('[aria-modal="true"]');if(!modal)return;const focusable=Array.from(modal.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input,textarea,[tabindex="0"]'));const first=focusable[0];const last=focusable[focusable.length-1];if(e.shiftKey&&(document.activeElement===first||!modal.contains(document.activeElement))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||!modal.contains(document.activeElement))){e.preventDefault();first?.focus();}};
 document.addEventListener('keydown',onKey);return()=>{document.removeEventListener('keydown',onKey);document.body.style.overflow=previousOverflow;previouslyFocused?.focus();};
 },[open,onClose]);
}
