import { readFileSync, writeFileSync } from 'node:fs';
import { config } from 'dotenv';
config({path:['.env.local','.env'],quiet:true});
async function main() {
  if(!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required to record LIVE fixtures. No calls made.');
  process.env.DEMO_MODE='0';
  const { classifyCoverage }=await import('../src/lib/gemini/coverage');
  const { studentVoice }=await import('../src/lib/gemini/studentVoice');
  const { writeRepair }=await import('../src/lib/gemini/repair');
  const { cacheKey, MODEL }=await import('../src/lib/gemini/client');
  const { config:cfg,map,priorFromCoverage,selectNextProbe,prediction,transferSet,updatePosterior }=await import('../src/lib/engine');
  const { newtonian:pack }=await import('../src/lib/packs');
  const { demoExplanation:explanation }=await import('../src/lib/session-logic');
  const coverage=await classifyCoverage(explanation,true);
  if(coverage.degraded) throw new Error('Coverage degraded; refusing to label a fallback as a live recording.');
  let d=priorFromCoverage(pack,coverage.data.coverage,cfg);const asked:string[]=[];
  while(asked.length<6&&(asked.length<3||map(d).p<cfg.confidence)) {const p=selectNextProbe(pack.probes,d,asked,cfg)!;d=updatePosterior(d,p,prediction('used-up',p),cfg);asked.push(p.id);}
  const hypothesis=map(d).id;const probeIds=transferSet(pack,hypothesis,asked).map(p=>p.id);
  const voice=await studentVoice(hypothesis,probeIds,explanation,true);
  const repair=await writeRepair(hypothesis,explanation,true);
  if(voice.degraded||repair.degraded) throw new Error('A response degraded. Existing fixtures preserved.');
  const entries=JSON.parse(readFileSync('fixtures/replays.json','utf8'));
  for(const [phase,input,data] of [['coverage',{explanation},coverage.data],['student-voice',{hypothesis,probeIds,explanation},voice.data],['repair',{hypothesis,explanation},repair.data]] as const) entries[cacheKey(phase,input)]={recorded:true,model:MODEL,data};
  writeFileSync('fixtures/replays.json',JSON.stringify(entries,null,2)+'\n');
  writeFileSync('fixtures/demo-path.json',JSON.stringify({explanation,hypothesis,asked:asked.map(probeId=>({probeId,answer:prediction('used-up',pack.probes.find(p=>p.id===probeId)!)})),probeIds,provenance:'Live Gemini recording; '+MODEL},null,2)+'\n');
  console.log('Recorded all three live responses. Rebuild to bundle updated fixtures.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
