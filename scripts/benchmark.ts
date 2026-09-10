import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { config, seededRng, selectNextProbe, selectRandomProbe, simulate, uniformPrior } from '../src/lib/engine';
import { newtonian as pack } from '../src/lib/packs';
const mean = (a: number[]) => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
const median = (a: number[]) => { const sorted=[...a].sort((x,y)=>x-y); return sorted.length ? (sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2 : 0; };
const pct = (n:number) => `${(100*n).toFixed(1)}%`;
let output = '# Viva — measured benchmarks\n\n## Engine benchmark\n\nSeed: 74021. 2,000 uniformly sampled ground-truth hypotheses per slip level; 13 hypotheses, 28 original items. Each paired trial uses the same truth, with separate reproducible answer/selection streams. Stopping: MAP ≥ 90% or 6 questions. Likelihood and simulator use the same slip. These are **in-model simulations, not learner validation**.\n\nCapped counts include unsuccessful trials at six. Target-only counts exclude trials that did not reach 90%; the reach column prevents hiding this censoring.\n\n| Slip | Selection | Mean capped | Median capped | Mean to target (reached only) | Median to target | Reached target | Recovery |\n|---|---|---:|---:|---:|---:|---:|---:|\n';
let calibration = '\n### Calibration\n\nBuckets group final MAP probabilities, including runs stopped at the cap. Empty buckets are omitted.\n\n| Slip | Selection | Confidence bucket | n | Mean stated confidence | Empirical accuracy |\n|---|---|---|---:|---:|---:|\n';
const all = [];
const gaps:number[]=[];
for(const slip of [.05,.12,.25]) {
  const rng=seededRng(74021); const ids=Object.keys(uniformPrior(pack));
  const truths=Array.from({length:2000},()=>ids[Math.floor(rng()*ids.length)]);
  const accuracies:number[]=[];
  for(const [name,selector] of [['Active',selectNextProbe],['Random',selectRandomProbe]] as const) {
    const results=truths.map((truth,i)=>simulate(pack,truth,selector,{...config,slip},seededRng(9001+i*37+(name==='Random'?1000000:0))));
    const reached=results.filter(r=>r.reached); const accuracy=mean(results.map(r=>Number(r.correct))); accuracies.push(accuracy);
    output+=`| ${slip} | ${name} | ${mean(results.map(r=>r.probes)).toFixed(2)} | ${median(results.map(r=>r.probes))} | ${mean(reached.map(r=>r.probes)).toFixed(2)} | ${median(reached.map(r=>r.probes))} | ${pct(reached.length/results.length)} | ${pct(accuracy)} |\n`;
    for(const [lo,hi] of [[0,.5],[.5,.7],[.7,.8],[.8,.9],[.9,.95],[.95,1.000001]]) {
      const bucket=results.filter(r=>r.confidence>=lo&&r.confidence<hi);
      if(bucket.length) calibration+=`| ${slip} | ${name} | ${Math.round(lo*100)}–${Math.min(100,Math.round(hi*100))}% | ${bucket.length} | ${pct(mean(bucket.map(r=>r.confidence)))} | ${pct(mean(bucket.map(r=>Number(r.correct))))} |\n`;
    }
    all.push({slip,selection:name,results});
  }
  gaps.push(accuracies[0]-accuracies[1]);
}
output+=calibration+'\n### Interpretation and limits\n\nActive-minus-random recovery gaps at slip 0.05, 0.12, and 0.25: '+gaps.map(g=>(g*100).toFixed(1)+' percentage points').join(', ')+'. The pack was not tuned after this benchmark. Its authored prediction matrix and single-dominant-belief assumption are not validated psychometrics. Transfer items are selected to expose the inferred belief, so the four-item score is not a general physics grade. Calibration here assumes the data-generating model is correct; real people can hold multiple beliefs, guess strategically, or change their minds.\n';
const prior=existsSync('BENCHMARK.md')?readFileSync('BENCHMARK.md','utf8'):'';
const coverage=prior.includes('## Coverage evaluation')?prior.slice(prior.indexOf('## Coverage evaluation')):'';
writeFileSync('BENCHMARK.md',output+'\n'+coverage);
mkdirSync('tests/fixtures',{recursive:true});
writeFileSync('tests/fixtures/engine-results.json',JSON.stringify({seed:74021,runs:all}));
console.log(output);
if(gaps.every(g=>Math.abs(g)<.01)) { console.error('Go/no-go: selection gap below 1 point at every slip level'); process.exitCode=1; }
