import type { Config, Coverage, Dist, TopicPack } from './types';
import { normalize } from './posterior';
export function priorFromCoverage(pack: TopicPack, coverage: Record<string, Coverage>, cfg: Config): Dist {
  // Coverage is weak evidence, never a diagnosis. Missing coverage raises attached hypotheses.
  const weights: Dist = Object.fromEntries(pack.misconceptions.map(m => [m.id, m.attachedTo.reduce((sum, c) => sum + cfg.gapWeight[coverage[c] ?? 'unknown'], 0) / m.attachedTo.length]));
  weights.SOUND = cfg.soundBias * pack.concepts.filter(c => coverage[c.id] === 'covered').length / pack.concepts.length;
  const normalized = normalize(weights);
  const entries = Object.entries(normalized);
  if (cfg.floor * entries.length >= 1) throw new Error('Prior floor too high');
  // Water-fill: reserve exact floors and scale the remaining mass proportionally.
  // Unlike clamp-then-renormalize, this guarantees every final probability >= floor.
  const fixed = new Set<string>();
  for (;;) {
    const freeSum = entries.filter(([h]) => !fixed.has(h)).reduce((sum, [, p]) => sum + p, 0);
    const scale = (1 - fixed.size * cfg.floor) / freeSum;
    const low = entries.filter(([h, p]) => !fixed.has(h) && p * scale < cfg.floor);
    if (!low.length) return Object.fromEntries(entries.map(([h, p]) => [h, fixed.has(h) ? cfg.floor : p * scale]));
    low.forEach(([h]) => fixed.add(h));
  }
}
