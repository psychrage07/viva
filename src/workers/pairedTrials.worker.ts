// Runs the 200-trial paired A/B comparison off the main thread so the UI never freezes.
// Zero network calls: pure deterministic math over the engine + pack, exactly like BENCHMARK.md,
// just reproducible live in the browser instead of committed as a static table.
import { seededRng } from '@/lib/engine';
import { newtonian as pack } from '@/lib/packs';
import { baseConfig, runPairedTrial } from '@/lib/compare/pairedSim';

export interface RunRequest { type: 'run'; seed: number; truth: string | 'random'; slip: number; trials: number; }
export interface RunProgress { type: 'progress'; completed: number; total: number; }
export interface RunDone {
  type: 'done';
  trials: number;
  activeMeanProbes: number; naiveMeanProbes: number;
  activeAccuracy: number; naiveAccuracy: number;
  activeProbeHistogram: number[]; naiveProbeHistogram: number[]; // index = probe count (0..maxProbes)
}

self.onmessage = (event: MessageEvent<RunRequest>) => {
  const { seed, truth, slip, trials } = event.data;
  const cfg = { ...baseConfig, slip };
  const rng = seededRng(seed);
  const ids = ['SOUND', ...pack.misconceptions.map(m => m.id)];
  const activeHist = new Array(cfg.maxProbes + 1).fill(0);
  const naiveHist = new Array(cfg.maxProbes + 1).fill(0);
  let activeCorrect = 0, naiveCorrect = 0, activeProbeSum = 0, naiveProbeSum = 0;
  for (let i = 0; i < trials; i++) {
    const trialTruth = truth === 'random' ? ids[Math.floor(rng() * ids.length)] : truth;
    const result = runPairedTrial(pack, trialTruth, cfg, seed + i * 7919 + 1);
    activeHist[Math.min(cfg.maxProbes, result.activeProbes)]++;
    naiveHist[Math.min(cfg.maxProbes, result.naiveProbes)]++;
    activeProbeSum += result.activeProbes; naiveProbeSum += result.naiveProbes;
    if (result.activeCorrect) activeCorrect++;
    if (result.naiveCorrect) naiveCorrect++;
    if (i % 20 === 0) (self as unknown as Worker).postMessage({ type: 'progress', completed: i, total: trials } satisfies RunProgress);
  }
  const done: RunDone = {
    type: 'done',
    trials,
    activeMeanProbes: activeProbeSum / trials,
    naiveMeanProbes: naiveProbeSum / trials,
    activeAccuracy: activeCorrect / trials,
    naiveAccuracy: naiveCorrect / trials,
    activeProbeHistogram: activeHist,
    naiveProbeHistogram: naiveHist,
  };
  (self as unknown as Worker).postMessage(done);
};
