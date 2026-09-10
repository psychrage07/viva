import { newtonian as pack, validatePack } from '../src/lib/packs';
const errors = validatePack(pack);
const ids = ['SOUND', ...pack.misconceptions.map(m => m.id)];
const entropy = (values: number[]) => -values.reduce((sum, v) => sum + (v ? v * Math.log2(v) : 0), 0);
// Uniform-prior I(H;C) = H(C) - E_h H(C|h); independent cross-check of engine EIG.
const scores = pack.probes.map(p => {
  const rows = ids.map(h => p.choices.map(c => .88 * Number(c.id === (h === 'SOUND' || p.predicted[h] === '*' ? p.correct : p.predicted[h])) + .12 / p.choices.length));
  const marginal = p.choices.map((_, i) => rows.reduce((sum, row) => sum + row[i], 0) / ids.length);
  return { id: p.id, bits: entropy(marginal) - rows.reduce((sum, row) => sum + entropy(row), 0) / ids.length };
}).sort((a, b) => b.bits - a.bits || a.id.localeCompare(b.id));
console.log(`${pack.misconceptions.length} misconceptions; ${pack.probes.length} original probes`);
for (const s of scores) console.log(`${s.id}: ${s.bits.toFixed(4)} bits`);
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('PASS: all hypotheses distinguished; complete maps; no zero-information items.');
