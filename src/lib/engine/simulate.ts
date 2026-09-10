import type { Config, Dist, ExamAnswer, Probe, TopicPack } from './types';
import { likelihood, prediction } from './likelihood';
import { map, updatePosterior } from './posterior';
import type { Selector } from './infogain';
export function seededRng(seed: number) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function uniformPrior(pack: TopicPack): Dist {
  const ids = ['SOUND', ...pack.misconceptions.map(m => m.id)];
  return Object.fromEntries(ids.map(h => [h, 1 / ids.length]));
}
export function sampleAnswer(h: string, probe: Probe, cfg: Config, rng: () => number): string {
  let draw = rng();
  for (const choice of probe.choices) { draw -= likelihood(h, probe, choice.id, cfg); if (draw <= 0) return choice.id; }
  return probe.choices[probe.choices.length - 1].id;
}
export function simulate(pack: TopicPack, truth: string, selector: Selector, cfg: Config, rng: () => number) {
  let posterior = uniformPrior(pack); const asked: string[] = [];
  while (asked.length < cfg.maxProbes && map(posterior).p < cfg.confidence) {
    const probe = selector(pack.probes, posterior, asked, cfg, rng);
    if (!probe) break;
    posterior = updatePosterior(posterior, probe, sampleAnswer(truth, probe, cfg, rng), cfg);
    asked.push(probe.id);
  }
  return { truth, probes: asked.length, reached: map(posterior).p >= cfg.confidence, correct: map(posterior).id === truth, confidence: map(posterior).p };
}
export function examAnswers(hypothesis: string, probes: Probe[]): ExamAnswer[] {
  return probes.map(p => { const choice = prediction(hypothesis, p); return { probeId: p.id, choice, correct: choice === p.correct }; });
}
export function transferSet(pack: TopicPack, hypothesis: string, asked: string[]): Probe[] {
  // Deliberately select diagnostic unseen items, not a representative achievement test.
  return pack.probes.filter(p => !asked.includes(p.id)).sort((a, b) => Number(prediction(hypothesis, b) !== b.correct) - Number(prediction(hypothesis, a) !== a.correct) || (a.id < b.id ? -1 : 1)).slice(0, 4);
}
