import type { Config, Dist, Probe } from './types';
import { entropy, updatePosterior } from './posterior';
import { likelihood, prediction } from './likelihood';
export function informationGain(posterior: Dist, probe: Probe, cfg: Config): number {
  if (new Set(Object.keys(posterior).filter(h => posterior[h] > 0).map(h => prediction(h, probe))).size <= 1) return 0;
  let expected = 0;
  for (const c of probe.choices) {
    const pc = Object.entries(posterior).reduce((sum, [h, p]) => sum + p * likelihood(h, probe, c.id, cfg), 0);
    if (pc > 0) expected += pc * entropy(updatePosterior(posterior, probe, c.id, cfg));
  }
  return Math.max(0, entropy(posterior) - expected);
}
export type Selector = (probes: Probe[], posterior: Dist, asked: string[], cfg: Config, rng?: () => number) => Probe | undefined;
export const selectNextProbe: Selector = (probes, posterior, asked, cfg) => {
  return probes.filter(p => !asked.includes(p.id)).map(probe => ({ probe, gain: informationGain(posterior, probe, cfg) })).sort((a, b) => b.gain - a.gain || (a.probe.id < b.probe.id ? -1 : 1))[0]?.probe;
};
export const selectRandomProbe: Selector = (probes, _posterior, asked, _cfg, rng = Math.random) => {
  const available = probes.filter(p => !asked.includes(p.id)).sort((a, b) => a.id < b.id ? -1 : 1);
  return available[Math.floor(rng() * available.length)];
};
