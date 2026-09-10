'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { ArrowRight, ArrowUpRight, Check, Copy } from 'lucide-react';
import { Brand } from './Brand';
import Mascot from './Mascot';
import { newtonian as pack } from '@/lib/packs';
const schema=z.object({v:z.literal(1),h:z.string().refine(h=>h==='SOUND'||pack.misconceptions.some(m=>m.id===h)),b:z.number().int().min(0).max(4),a:z.number().int().min(0).max(4).nullable(),c:z.string().refine(id=>pack.concepts.some(c=>c.id===id))}).strict();
export default function ResultCard(){const params=useSearchParams();const [copied,setCopied]=useState(false);const [notice,setNotice]=useState('');let input:unknown=null;try{const raw=params.get('r');if(raw&&raw.length<1000)input=JSON.parse(raw);}catch{}const result=schema.safeParse(input);
 async function copy(){try{await navigator.clipboard.writeText(window.location.href);setCopied(true);setNotice('Link copied. No explanation or personal information is included.');}catch{setNotice('Copy the URL from your browser’s address bar to share this card.');}}
 if(!result.success)return <main className="share-page"><Brand/><div className="share-result"><h1>A fresh aha! is waiting.</h1><p>This result link is incomplete or invalid. Start a session to make your own shareable learning card.</p></div><Link href="/session" className="button">Meet your student <ArrowUpRight size={16}/></Link></main>;
 const s=result.data;const m=pack.misconceptions.find(m=>m.id===s.h);const concept=pack.concepts.find(c=>c.id===s.c)!;
 return <main className="share-page"><Brand/><article className="share-result"><span className="eyebrow">A LITTLE TEACHING. A LITTLE BREAKTHROUGH.</span><h1>I taught it.<br/>Then it clicked.</h1><Mascot small/><p>Newtonian force & motion<br/><strong>{m?.label??'Sound understanding'}</strong></p><div className="share-score"><div><b>{s.b}<small style={{fontSize:23}}> / 4</small></b><span>BEFORE</span></div><ArrowRight size={25}/><div><b>{s.a??'—'}<small style={{fontSize:23}}> / 4</small></b><span>AFTER THE REPAIR</span></div></div><p>“{concept.statement}”</p></article><div style={{display:'flex',justifyContent:'center',gap:15,flexWrap:'wrap'}}><button className="button secondary" onClick={copy}>{copied?<Check size={15}/>:<Copy size={15}/>} {copied?'Copied!':'Copy result link'}</button><Link href="/session" className="button">Find your own aha! <ArrowUpRight size={16}/></Link></div>{notice&&<p className="share-note" role="status">{notice}</p>}<p className="share-note">A self-reported simulation, not a verified grade. The result is encoded in this link and can be edited; no account or database is involved.</p></main>;
}
