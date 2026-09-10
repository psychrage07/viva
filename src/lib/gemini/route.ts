import { z } from 'zod';
import { rateAllowed } from './client';
import type { Result } from '../session-logic';
export function safeRoute<I,T>(schema:z.ZodType<I>,run:(input:I)=>Promise<Result<T>>,fallback:()=>T) {
  return async(request:Request)=>{
    const respond=(data:Result<T>)=>Response.json(data,{headers:{'Cache-Control':'no-store'}});
    const degraded=(reason:string)=>respond({data:fallback(),degraded:true,source:'fallback',reason});
    const ip=request.headers.get('x-forwarded-for')?.split(',')[0].trim()||'local';
    if(!rateAllowed(ip)) return degraded('Request budget reached. Your session can continue offline.');
    try {
      if(Number(request.headers.get('content-length')||0)>24000) return degraded('Request too large.');
      const text=await request.text();
      if(text.length>24000) return degraded('Request too large.');
      const input=schema.safeParse(JSON.parse(text));
      if(!input.success) return degraded('Invalid input; using safe defaults.');
      return respond(await run(input.data));
    } catch { return degraded('Using a safe offline response.'); }
  };
}
