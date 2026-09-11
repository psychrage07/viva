// The live A/B counterfactual: reuses selectNextProbe / selectRandomProbe unchanged.
// A fair comparison needs one synthetic student whose noisy answer to a given probe is
// fixed by (seed, probeId) alone — independent of which policy asks it, or when. That is
// what makes this a genuine counterfactual rather than two independent random runs.
import {
  config as baseConfig, entropy, map, sampleAnswer, seededRng, selectNextProbe, selectRandomProbe,
  updatePosterior, uniformPrior, diagnose, type Config, type Dist, type Probe, type TopicPack,
} from '@/lib/engine';

export type PolicyKind = 'active' | 'naive';

export interface PanelState {
  posterior: Dist;
  asked: string[];
  entropyTrace: number[];
  done: boolean;
  lastProbeId: string | null;
  lastAnswer: string | null;
}

export function freshPanel(pack: TopicPack): PanelState {
  const posterior = uniformPrior(pack);
  return { posterior, asked: [], entropyTrace: [entropy(posterior)], done: false, lastProbeId: null, lastAnswer: null };
}

// Deterministic small hash so (seed, probeId) always yields the same integer seed for the
// per-probe answer RNG, regardless of call order.
export function deriveSeed(seed: number, probeId: string): number {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  for (let i = 0; i < probeId.length; i++) {
    h = Math.imul(h ^ probeId.charCodeAt(i), 2654435761);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

export function answerFor(truth: string, probe: Probe, cfg: Config, seed: number): string {
  return sampleAnswer(truth, probe, cfg, seededRng(deriveSeed(seed, probe.id)));
}

export function makeNaiveRng(seed: number) { return seededRng(deriveSeed(seed, '__naive_selection__')); }

/** Advances one panel by exactly one probe. No-op once done. Pure: returns a new state. */
export function stepPanel(pack: TopicPack, truth: string, cfg: Config, seed: number, kind: PolicyKind, state: PanelState, naiveRng?: () => number): PanelState {
  if (state.done) return state;
  const selector = kind === 'active' ? selectNextProbe : selectRandomProbe;
  const probe = selector(pack.probes, state.posterior, state.asked, cfg, naiveRng);
  if (!probe) return { ...state, done: true };
  const ans = answerFor(truth, probe, cfg, seed);
  const posterior = updatePosterior(state.posterior, probe, ans, cfg);
  const asked = [...state.asked, probe.id];
  const entropyTrace = [...state.entropyTrace, entropy(posterior)];
  const verdict = diagnose(posterior, entropyTrace, cfg);
  const done = verdict.kind !== 'insufficient' || asked.length >= cfg.maxProbes;
  return { posterior, asked, entropyTrace, done, lastProbeId: probe.id, lastAnswer: ans };
}

export interface TrialResult { activeProbes: number; naiveProbes: number; activeCorrect: boolean; naiveCorrect: boolean; }

/** Runs one full paired trial headlessly (no UI), for the 200-trial aggregate. */
export function runPairedTrial(pack: TopicPack, truth: string, cfg: Config, seed: number): TrialResult {
  let active = freshPanel(pack);
  let naive = freshPanel(pack);
  const naiveRng = makeNaiveRng(seed);
  let guard = 0;
  while ((!active.done || !naive.done) && guard < cfg.maxProbes * 2 + 4) {
    if (!active.done) active = stepPanel(pack, truth, cfg, seed, 'active', active);
    if (!naive.done) naive = stepPanel(pack, truth, cfg, seed, 'naive', naive, naiveRng);
    guard++;
  }
  return {
    activeProbes: active.asked.length,
    naiveProbes: naive.asked.length,
    activeCorrect: map(active.posterior).id === truth,
    naiveCorrect: map(naive.posterior).id === truth,
  };
}

export { baseConfig };
