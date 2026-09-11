import type { Config } from './types';
export const config: Config = {
  slip: .12,
  soundBias: 1.5,
  floor: .01,
  confidence: .90,
  maxProbes: 6,
  gapWeight: { missing: 1, partial: .5, unknown: .4, covered: .08 },
  // Below this, the top hypothesis has not separated from the field: abstain rather than force a MAP call.
  abstainEntropyFloor: 1.2,
  // If the last 3 probes drop entropy by less than this on average, more probes will not help either.
  minEntropyDropPerProbe: .15,
};
