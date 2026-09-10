import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { config } from 'dotenv';
import { newtonian as pack } from '../src/lib/packs';
import type { CoverageResult } from '../src/lib/session-logic';
config({path:['.env.local','.env'],quiet:true});
async function main() {
  const gold=readdirSync('tests/fixtures/explanations').filter(f=>f.endsWith('.json')).sort().map(f=>JSON.parse(readFileSync('tests/fixtures/explanations/'+f,'utf8')) as {id:string;explanation:string;gold:Record<string,string>});
  type Run={id:string;run:number;source:string;degraded:boolean;data:CoverageResult};
  let outputs=JSON.parse(readFileSync('tests/fixtures/coverage-outputs.json','utf8')) as {provenance:string;model:string|null;runs:Run[]};
  if(process.argv.includes('--live')) {
    if(!process.env.GEMINI_API_KEY) throw new Error('--live requires GEMINI_API_KEY; no calls made.');
    process.env.DEMO_MODE='0';
    const { classifyCoverage }=await import('../src/lib/gemini/coverage');
    const { MODEL }=await import('../src/lib/gemini/client');
    const runs:Run[]=[];
    for(const e of gold) for(let run=0;run<3;run++) { const result=await classifyCoverage(e.explanation,true); runs.push({id:e.id,run,source:result.source,degraded:result.degraded,data:result.data}); console.log(e.id,run,result.source); }
    outputs={provenance:'live evaluation; fallback rows explicitly flagged',model:MODEL,runs};
    writeFileSync('tests/fixtures/coverage-outputs.json',JSON.stringify(outputs,null,2)+'\n');
  }
  if(outputs.runs.length!==60) throw new Error('Expected 60 committed outputs');
  const live=outputs.runs.filter(r=>r.source==='live').length;
  let report='## Coverage evaluation\n\n'+`Provenance: **${outputs.provenance}**. Model: ${outputs.model??'not run'}. ${live}/60 outputs came from Gemini. `+(live===60?'Measured live classifier results.':'**Gemini reliability is NOT measured.** The table below measures only the committed outputs, including deterministic unknown fallbacks. Do not interpret it as model performance. No API key was available during this build.')+'\n\nGold set: 20 authored explanations (10 sound; 10 each omitting a distinct concept), three runs each. These templated gold texts are an easy, narrow evaluation; diverse natural learner explanations are still needed. Covered is the positive class; partial/missing/unknown are negative. Precision is n/a when there are no predicted positives. Consistency is the fraction of examples with the same label on all three runs.\n\n| Concept | Precision (covered) | Recall (covered) | 3-run consistency |\n|---|---:|---:|---:|\n';
  const pct=(v:number)=>`${(v*100).toFixed(1)}%`;
  for(const c of pack.concepts) {
    let tp=0,fp=0,fn=0,consistent=0;
    for(const e of gold) { const runs=outputs.runs.filter(r=>r.id===e.id); if(runs.length!==3) throw new Error('Missing repetitions'); if(new Set(runs.map(r=>r.data.coverage[c.id])).size===1) consistent++; for(const r of runs) { const positive=r.data.coverage[c.id]==='covered'; const actual=e.gold[c.id]==='covered'; if(positive&&actual)tp++; if(positive&&!actual)fp++; if(!positive&&actual)fn++; } }
    report+=`| ${c.label} | ${tp+fp?pct(tp/(tp+fp)):'n/a (no positives)'} | ${tp+fn?pct(tp/(tp+fn)):'n/a'} | ${pct(consistent/gold.length)} |\n`;
  }
  report+='\nReproduce without network: `npm run eval:coverage`. Collect real model outputs: `npm run eval:coverage -- --live` (60 logical calls; retries may add attempts). Live runs bypass cache; replay is the default. Unknown fallbacks can be perfectly self-consistent while conveying no information: consistency is not accuracy.\n';
  const existing=readFileSync('BENCHMARK.md','utf8').split('## Coverage evaluation')[0];
  writeFileSync('BENCHMARK.md',existing+report); console.log(report);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
