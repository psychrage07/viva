import { GoogleGenAI, type Schema } from '@google/genai';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import replays from '../../../fixtures/replays.json';
import type { Result } from '../session-logic';
export const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
export type Phase = 'coverage' | 'student-voice' | 'repair';
type Entry = { data: unknown; recorded: boolean };
const cache = new Map<string, Result<unknown>>();
const pending = new Map<string, Promise<Result<unknown>>>();
const buckets = new Map<string, { tokens: number; at: number }>();
let requestCount = 0;
export function getRequestCount() { return requestCount; }
export function resetClientState() { cache.clear(); pending.clear(); buckets.clear(); requestCount=0; }
export const normalizeInput = (input: unknown): string => {
  if (typeof input === 'string') return JSON.stringify(input.trim().replace(/\s+/g,' '));
  if (Array.isArray(input)) return '['+input.map(normalizeInput).join(',')+']';
  if(input && typeof input==='object') return '{'+Object.entries(input).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+normalizeInput(v)).join(',')+'}';
  return JSON.stringify(input);
};
export function cacheKey(phase: Phase,input:unknown) { return createHash('sha256').update('newtonian|'+phase+'|'+normalizeInput(input)).digest('hex'); }
export function rateAllowed(ip:string) {
  const now=Date.now(); const b=buckets.get(ip)??{tokens:18,at:now};
  b.tokens=Math.min(18,b.tokens+(now-b.at)/30000); b.at=now;
  if(buckets.size>3000) for(const [key,value] of buckets) if(now-value.at>600000) buckets.delete(key);
  if(buckets.size>5000 && !buckets.has(ip)) return false;
  if(b.tokens<1) { buckets.set(ip,b); return false; }
  b.tokens-=1; buckets.set(ip,b); return true;
}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export interface CallOptions<T> { phase:Phase; input:unknown; prompt:string; schema:z.ZodType<T>; jsonSchema:Schema; fallback:()=>T; accept?:(data:T)=>boolean; bypassCache?:boolean; }
export async function structured<T>(o:CallOptions<T>):Promise<Result<T>> {
  const key=cacheKey(o.phase,o.input);
  if(!o.bypassCache && cache.has(key)) { const hit=cache.get(key)!; cache.delete(key); cache.set(key,hit); return {...hit,source:'cache'} as Result<T>; }
  if(!o.bypassCache && pending.has(key)) return pending.get(key)! as Promise<Result<T>>;
  const work=async():Promise<Result<T>>=>{
    const fallback=(reason:string):Result<T>=>({data:o.fallback(),degraded:true,source:'fallback',reason});
    if(process.env.DEMO_MODE==='1') {
      await sleep(process.env.VIVA_TEST==='1'?0:400+Math.floor(Math.random()*501));
      const entry=(replays as Record<string,Entry>)[key];
      const parsed=o.schema.safeParse(entry?.data);
      if(parsed.success && (!o.accept || o.accept(parsed.data))) return {data:parsed.data,degraded:!entry.recorded,source:'fixture',reason:entry.recorded?undefined:'Authored demo fixture; not a recorded model response.'};
      return fallback('Offline demo: no matching fixture; using an authored fallback.');
    }
    if(!process.env.GEMINI_API_KEY) return fallback('No API key configured. Using the deterministic fallback.');
    const ai=new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY});
    let prompt=o.prompt; let validationFailures=0;
    // Three total attempts maximum; validation gets one repair, transport gets bounded backoff.
    for(let attempt=0;attempt<3;attempt++) {
      try {
        requestCount++;
        if(process.env.NODE_ENV!=='production') console.info(`[Viva Gemini] request ${requestCount}; phase=${o.phase}; attempt=${attempt+1}`);
        const response=await ai.models.generateContent({model:MODEL,contents:prompt,config:{responseMimeType:'application/json',responseSchema:o.jsonSchema,temperature:.25,httpOptions:{timeout:12000}}});
        let raw:unknown;
        try { raw=JSON.parse(response.text??''); } catch { raw=null; }
        const parsed=o.schema.safeParse(raw);
        if(parsed.success && (!o.accept || o.accept(parsed.data))) return {data:parsed.data,degraded:false,source:'live'};
        validationFailures++;
        if(validationFailures>=2) return fallback('Model output failed validation twice.');
        prompt+='\nRepair your JSON response. Validation errors: '+(parsed.success?'Semantic constraint violated: follow the supplied committed answer and approved wording exactly.':parsed.error.message);
      } catch(error) {
        const status=typeof error==='object' && error!==null && 'status' in error ? Number(error.status):0;
        if(status && status!==429 && status<500) return fallback('Model service unavailable.');
        if(attempt<2) await sleep(process.env.VIVA_TEST==='1'?0:500*2**attempt+Math.floor(Math.random()*200));
      }
    }
    return fallback('Model unavailable after bounded retries.');
  };
  const promise=work();
  if(!o.bypassCache) pending.set(key,promise as Promise<Result<unknown>>);
  try {
    const result=await promise;
    if(!o.bypassCache) { cache.set(key,result); if(cache.size>256) cache.delete(cache.keys().next().value!); }
    return result;
  } finally { pending.delete(key); }
}
