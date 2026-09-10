import type { Config } from './types';
export const config: Config = { slip: .12, soundBias: 1.5, floor: .01, confidence: .90, maxProbes: 6, gapWeight: { missing: 1, partial: .5, unknown: .4, covered: .08 } };
