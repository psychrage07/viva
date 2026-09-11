import type { Config, Diagnosis, Dist } from './types';
import { entropy, map } from './posterior';

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function candidates(posterior: Dist, n = 3) {
  return Object.entries(posterior)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([id, p]) => ({ id, p }));
}

/**
 * diagnose() is a verdict about the posterior, not a fifth hypothesis inside it.
 *
 * entropyTrace is the chronological sequence of entropy(posterior) readings, starting
 * with the entropy of the prior (before any probe) and appending one value after every
 * subsequent probe. It lets diagnose() detect a STALL: probes that stopped being
 * discriminating, which is a different failure mode than "just needs one more question".
 */
export function diagnose(posterior: Dist, entropyTrace: number[], cfg: Config): Diagnosis {
  const top = map(posterior);
  if (top.p >= cfg.confidence) {
    return top.id === 'SOUND' ? { kind: 'sound', confidence: top.p } : { kind: 'misconception', id: top.id, confidence: top.p };
  }
  const probesAsked = Math.max(0, entropyTrace.length - 1);
  const exhausted = probesAsked >= cfg.maxProbes;
  const recentDrops: number[] = [];
  for (let i = entropyTrace.length - 1; i >= 1 && recentDrops.length < 3; i--) recentDrops.push(entropyTrace[i - 1] - entropyTrace[i]);
  const stalled = recentDrops.length === 3 && mean(recentDrops) < cfg.minEntropyDropPerProbe && entropy(posterior) >= cfg.abstainEntropyFloor;
  // Not yet exhausted or stalled: the caller should keep probing. Still surface the
  // current contention so an in-progress UI can show it, but callers treat this as
  // non-terminal unless exhausted/stalled also holds.
  return { kind: 'insufficient', entropyBits: entropy(posterior), topCandidates: candidates(posterior) };
}

/** True only when diagnose() should be treated as a final, session-ending verdict. */
export function isTerminalDiagnosis(posterior: Dist, entropyTrace: number[], cfg: Config): boolean {
  const top = map(posterior);
  if (top.p >= cfg.confidence) return true;
  const probesAsked = Math.max(0, entropyTrace.length - 1);
  if (probesAsked >= cfg.maxProbes) return true;
  const recentDrops: number[] = [];
  for (let i = entropyTrace.length - 1; i >= 1 && recentDrops.length < 3; i--) recentDrops.push(entropyTrace[i - 1] - entropyTrace[i]);
  return recentDrops.length === 3 && mean(recentDrops) < cfg.minEntropyDropPerProbe && entropy(posterior) >= cfg.abstainEntropyFloor;
}
