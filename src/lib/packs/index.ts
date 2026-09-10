import type { TopicPack } from '../engine/types';
import { newtonian } from './newtonian';
export function validatePack(pack: TopicPack): string[] {
  const errors: string[] = [];
  const concepts = new Set(pack.concepts.map(c => c.id));
  const hypotheses = ['SOUND', ...pack.misconceptions.map(m => m.id)];
  if (new Set(hypotheses).size !== hypotheses.length) errors.push('Duplicate or reserved hypothesis ID');
  if (new Set(pack.probes.map(p => p.id)).size !== pack.probes.length) errors.push('Duplicate probe ID');
  for (const m of pack.misconceptions) {
    if (!m.attachedTo.length || m.attachedTo.some(c => !concepts.has(c))) errors.push(`${m.id}: invalid attachedTo`);
  }
  const predictions = Object.fromEntries(hypotheses.map(h => [h, [] as string[]]));
  for (const p of pack.probes) {
    const choices = new Set(p.choices.map(c => c.id));
    if (!choices.has(p.correct) || choices.size < 2 || choices.size !== p.choices.length) errors.push(`${p.id}: invalid choices`);
    if (p.targets.some(c => !concepts.has(c))) errors.push(`${p.id}: unknown target`);
    const values = hypotheses.map(h => {
      const raw = h === 'SOUND' ? p.correct : p.predicted[h];
      if (!raw) errors.push(`${p.id}: missing prediction for ${h}`);
      if (raw !== '*' && !choices.has(raw)) errors.push(`${p.id}: invalid prediction for ${h}`);
      const value = raw === '*' ? p.correct : raw;
      predictions[h].push(value);
      return value;
    });
    if (new Set(values).size === 1) errors.push(`${p.id}: zero information for every hypothesis`);
  }
  for (let a = 0; a < hypotheses.length; a++) for (let b = a + 1; b < hypotheses.length; b++) {
    if (predictions[hypotheses[a]].join('|') === predictions[hypotheses[b]].join('|')) errors.push(`Indistinguishable: ${hypotheses[a]}, ${hypotheses[b]}`);
  }
  return errors;
}
export function loadPack(id = 'newtonian') {
  if (id !== newtonian.id) throw new Error('Unknown topic pack');
  const errors = validatePack(newtonian);
  if (errors.length) throw new Error(errors.join('\n'));
  return newtonian;
}
export { newtonian };
