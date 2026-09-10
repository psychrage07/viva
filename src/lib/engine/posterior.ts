import type { Config, Dist, Probe } from './types';
import { likelihood } from './likelihood';
export function normalize(d: Dist): Dist {
  const sum = Object.values(d).reduce((a, b) => a + b, 0);
  if (!(sum > 0) || Object.values(d).some(p => p < 0 || !Number.isFinite(p))) throw new Error('Invalid distribution');
  return Object.fromEntries(Object.entries(d).map(([h, p]) => [h, p / sum]));
}
export function updatePosterior(prior: Dist, probe: Probe, answer: string, cfg: Config): Dist {
  const logs = Object.entries(prior).map(([h, p]) => [h, Math.log(p) + Math.log(likelihood(h, probe, answer, cfg))] as const);
  const maxLog = Math.max(...logs.map(([, p]) => p));
  // An impossible observation with slip=0 has no conditional distribution. Preserve the prior.
  if (maxLog === -Infinity) return normalize(prior);
  return normalize(Object.fromEntries(logs.map(([h, p]) => [h, Math.exp(p - maxLog)])));
}
export function entropy(d: Dist): number { return Math.max(0, -Object.values(d).reduce((sum, p) => sum + (p > 0 ? p * Math.log2(p) : 0), 0)); }
export function map(d: Dist): { id: string; p: number } {
  const entries = Object.entries(d).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return { id: entries[0][0], p: entries[0][1] };
}
