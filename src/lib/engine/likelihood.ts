import type { Config, Probe } from './types';
export function prediction(h: string, p: Probe): string {
  if (h === 'SOUND' || p.predicted[h] === '*') return p.correct;
  if (!p.predicted[h]) throw new Error(`Unknown hypothesis ${h}`);
  return p.predicted[h];
}
export function likelihood(h: string, p: Probe, answer: string, cfg: Config): number {
  if (!p.choices.some(c => c.id === answer)) throw new Error('Invalid choice');
  return (1 - cfg.slip) * Number(answer === prediction(h, p)) + cfg.slip / p.choices.length;
}
