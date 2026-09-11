import { z } from 'zod';
import { newtonian as pack } from './packs';
import { config, entropy, uniformPrior, type Coverage, type Diagnosis, type Dist, type Observation } from './engine';
import type { CoverageResult, RepairResult, VoiceResult } from './session-logic';
export type Phase = 'teach' | 'coverage' | 'probe' | 'abstain' | 'reveal' | 'repair';
export interface SessionState { version: 1; phase: Phase; explanation: string; coverage: CoverageResult['coverage']; posterior: Dist; observations: Observation[]; entropyTrace: number[]; diagnosis: Diagnosis | null; hypothesis: string; transferIds: string[]; voice: VoiceResult | null; repair: RepairResult | null; degraded: boolean; sourceNote: string; shown: number; repairText: string; after: number | null; }
export const initialSession = (): SessionState => ({ version: 1, phase: 'teach', explanation: '', coverage: Object.fromEntries(pack.concepts.map(c => [c.id, 'unknown' as Coverage])), posterior: uniformPrior(pack), observations: [], entropyTrace: [entropy(uniformPrior(pack))], diagnosis: null, hypothesis: 'SOUND', transferIds: [], voice: null, repair: null, degraded: false, sourceNote: '', shown: 1, repairText: '', after: null });
const conceptId = z.enum(pack.concepts.map(c => c.id) as [string, ...string[]]);
const hId = z.enum(['SOUND', ...pack.misconceptions.map(m => m.id)] as [string, ...string[]]);
const probeId = z.string().refine(id => pack.probes.some(p => p.id === id));
const diagnosisSchema: z.ZodType<Diagnosis> = z.union([
  z.object({ kind: z.literal('misconception'), id: hId, confidence: z.number().min(0).max(1) }),
  z.object({ kind: z.literal('sound'), confidence: z.number().min(0).max(1) }),
  z.object({ kind: z.literal('insufficient'), entropyBits: z.number().min(0), topCandidates: z.array(z.object({ id: hId, p: z.number().min(0).max(1) })).min(1).max(3) }),
]);
export const savedSessionSchema = z.object({ version: z.literal(1), phase: z.enum(['teach', 'coverage', 'probe', 'abstain', 'reveal', 'repair']), explanation: z.string().max(10000), coverage: z.record(conceptId, z.enum(['covered', 'partial', 'missing', 'unknown'])), posterior: z.record(hId, z.number().min(0).max(1)).refine(d => Math.abs(Object.values(d).reduce((a, b) => a + b, 0) - 1) < 1e-6), observations: z.array(z.object({ probeId, answer: z.string() })).max(config.maxProbes).refine(obs => new Set(obs.map(o => o.probeId)).size === obs.length && obs.every(o => pack.probes.find(p => p.id === o.probeId)?.choices.some(c => c.id === o.answer))), entropyTrace: z.array(z.number().min(0)).max(config.maxProbes + 1), diagnosis: diagnosisSchema.nullable(), hypothesis: hId, transferIds: z.array(probeId).max(4), voice: z.object({ answers: z.array(z.object({ probeId, choice: z.string(), reasoning: z.string().max(1000) })).length(4) }).nullable(), repair: z.object({ diagnosis: z.string().max(1200), sentence: z.string().max(500), conceptId }).nullable(), degraded: z.boolean(), sourceNote: z.string().max(2000), shown: z.number().int().min(1).max(4), repairText: z.string().max(2000), after: z.number().int().min(0).max(4).nullable() }).refine(s => !['reveal', 'repair'].includes(s.phase) || s.transferIds.length === 4);
