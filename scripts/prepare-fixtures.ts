import { mkdirSync, writeFileSync } from 'node:fs';
import { newtonian as pack } from '../src/lib/packs';
import { cacheKey } from '../src/lib/gemini/client';
import { config, map, prediction, priorFromCoverage, selectNextProbe, transferSet, updatePosterior, type Coverage } from '../src/lib/engine';
import { demoExplanation, fallbackRepair, fallbackVoice, unknownCoverage } from '../src/lib/session-logic';
mkdirSync('tests/fixtures/explanations',{recursive:true});
const gold=[];
for(let i=0;i<20;i++) {
  const omitted=i<10?null:pack.concepts[i-10].id;
  const clauses=pack.concepts.filter(c=>c.id!==omitted).map(c=>c.statement);
  // Rotate sentence order across sound examples, keeping labels unambiguous.
  const offset=i%clauses.length; const reordered=[...clauses.slice(offset),...clauses.slice(0,offset)];
  const example={id:`explanation-${String(i+1).padStart(2,'0')}`,kind:omitted?'single-omission':'sound',omitted,explanation:['Here is how I understand force and motion.','I would explain it to a beginner like this.','Let me describe the important physical ideas.'][i%3]+' '+reordered.join(' '),gold:Object.fromEntries(pack.concepts.map(c=>[c.id,c.id===omitted?'missing':'covered']))};
  gold.push(example); writeFileSync(`tests/fixtures/explanations/${example.id}.json`,JSON.stringify(example,null,2)+'\n');
}
writeFileSync('tests/fixtures/coverage-outputs.json',JSON.stringify({provenance:'deterministic-fallback; NOT Gemini responses; API key unavailable',model:null,runs:gold.flatMap(e=>Array.from({length:3},(_,run)=>({id:e.id,run,source:'fallback',degraded:true,data:unknownCoverage()})))},null,2)+'\n');
const coverage:Record<string,Coverage>=Object.fromEntries(pack.concepts.map(c=>[c.id,'unknown']));
Object.assign(coverage,{interaction:'missing',acceleration:'missing',gravity:'partial',direction:'partial'});
let d=priorFromCoverage(pack,coverage,config); const asked:string[]=[];
while(asked.length<6 && (asked.length<3 || map(d).p<config.confidence)) { const p=selectNextProbe(pack.probes,d,asked,config)!; d=updatePosterior(d,p,prediction('used-up',p),config); asked.push(p.id); }
const hypothesis=map(d).id; const probeIds=transferSet(pack,hypothesis,asked).map(p=>p.id);
const entries={
  [cacheKey('coverage',{explanation:demoExplanation})]:{recorded:false,data:{coverage}},
  [cacheKey('student-voice',{hypothesis,probeIds,explanation:demoExplanation})]:{recorded:false,data:fallbackVoice(hypothesis,probeIds.map(id=>pack.probes.find(p=>p.id===id)!))},
  [cacheKey('repair',{hypothesis,explanation:demoExplanation})]:{recorded:false,data:fallbackRepair(hypothesis)},
};
writeFileSync('fixtures/replays.json',JSON.stringify(entries,null,2)+'\n');
writeFileSync('fixtures/demo-path.json',JSON.stringify({explanation:demoExplanation,hypothesis,asked:asked.map(probeId=>({probeId,answer:prediction('used-up',pack.probes.find(p=>p.id===probeId)!)})),probeIds,provenance:'Authored offline script; not recorded from Gemini'},null,2)+'\n');
console.log('Wrote 20 gold explanations, 60 explicitly labelled fallback outputs, and an authored 3-phase demo path.');
