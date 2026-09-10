import { expect,it } from 'vitest';
import { newtonian as pack } from '../src/lib/packs';
import { config, examAnswers, map, prediction, priorFromCoverage, selectNextProbe, transferSet, updatePosterior, type Coverage, type Observation } from '../src/lib/engine';
import { fallbackRepair, resit, normalizedSentence } from '../src/lib/session-logic';
import { initialSession,savedSessionSchema } from '../src/lib/session-state';
it('re-sits the same four unseen items with a normalized, explicitly intervened belief state',()=>{
 const coverage=Object.fromEntries(pack.concepts.map(c=>[c.id,'unknown' as Coverage]));let posterior=priorFromCoverage(pack,coverage,config);const obs:Observation[]=[];
 while(obs.length<6&&(obs.length<3||map(posterior).p<.9)){const p=selectNextProbe(pack.probes,posterior,obs.map(o=>o.probeId),config)!;const answer=prediction('used-up',p);posterior=updatePosterior(posterior,p,answer,config);obs.push({probeId:p.id,answer});}
 const h=map(posterior).id;const probes=transferSet(pack,h,obs.map(o=>o.probeId));expect(probes.every(p=>!obs.some(o=>o.probeId===p.id))).toBe(true);const result=resit(coverage,obs,fallbackRepair(h).conceptId,probes);expect(Object.values(result.posterior).reduce((a,b)=>a+b,0)).toBeCloseTo(1,9);expect(result.answers.map(a=>a.probeId)).toEqual(probes.map(p=>p.id));expect(result.answers.filter(a=>a.correct).length).toBeGreaterThan(examAnswers(h,probes).filter(a=>a.correct).length);
});
it('checks punctuation-insensitive repair inclusion without pretending to classify paraphrases',()=>{expect(normalizedSentence('Gravity acts, in a vacuum!')).toBe(normalizedSentence('gravity acts in a vacuum'));expect(normalizedSentence('maybe gravity')).not.toBe(normalizedSentence('Gravity acts in a vacuum'));});
it('validates restored session state and rejects injected hypotheses',()=>{expect(savedSessionSchema.safeParse(initialSession()).success).toBe(true);expect(savedSessionSchema.safeParse({...initialSession(),hypothesis:'invented'}).success).toBe(false);expect(savedSessionSchema.safeParse({...initialSession(),phase:'reveal',transferIds:[]}).success).toBe(false);});
