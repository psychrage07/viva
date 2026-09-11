import { config, examAnswers, map, priorFromCoverage, updatePosterior, type Concept, type Coverage, type Dist, type ExamAnswer, type Observation, type Probe } from './engine';
import { newtonian as pack } from './packs';
export const demoExplanation = 'When you throw a ball up, the push from your hand goes into the ball. The ball uses up that upward push as it rises, so it slows down. When the push runs out at the top, gravity takes over and brings it back down.';
export type CoverageResult = { coverage: Record<string, Coverage> };
export type VoiceResult = { answers: { probeId: string; choice: string; reasoning: string }[] };
export type RepairResult = { diagnosis: string; sentence: string; conceptId: string };
export type Result<T> = { data: T; degraded: boolean; source: 'live' | 'cache' | 'fixture' | 'fallback'; reason?: string };
export const unknownCoverage = (): CoverageResult => ({ coverage: Object.fromEntries(pack.concepts.map(c => [c.id, 'unknown'])) });
export function beliefFor(h: string) { return pack.misconceptions.find(m => m.id === h)?.belief ?? 'I think forces change velocity, and motion follows Newton’s laws'; }
export function voiceOptions(h: string, probe: Probe, answer: ExamAnswer): string[] {
  const choice = probe.choices.find(c => c.id === answer.choice)!.text;
  const belief = answer.correct ? 'I am using what I know about this situation' : beliefFor(h);
  return [`${belief}. My answer is: ${choice}`, `Here is how I see it: ${belief.charAt(0).toLowerCase() + belief.slice(1)}. I choose: ${choice}`];
}
export function fallbackVoice(h: string, probes: Probe[]): VoiceResult {
  return { answers: examAnswers(h, probes).map((a, i) => ({ probeId: a.probeId, choice: a.choice, reasoning: voiceOptions(h, probes[i], a)[0] })) };
}
export function fallbackRepair(h: string): RepairResult {
  const m = pack.misconceptions.find(m => m.id === h);
  if (!m) return { diagnosis: 'Your answers support a sound understanding within this topic pack. Try explaining why gravity still acts at the very top of a throw.', sentence: pack.concepts[8].statement, conceptId: 'direction' };
  return { diagnosis: `Your answers are most consistent with “${m.label.toLowerCase()}”. This is a working hypothesis, not a label for you. Your student inherited this belief; making the missing idea explicit gives it a better starting point.`, sentence: m.repair, conceptId: m.attachedTo[0] };
}
export function repairPosterior(coverage: Record<string, Coverage>, observations: Observation[], conceptId: string): Dist {
  const repaired = { ...coverage, [conceptId]: 'covered' as Coverage };
  let posterior = priorFromCoverage(pack, repaired, config);
  // An intervention replaces evidence about the repaired concept. Unrelated evidence stays.
  for (const o of observations) { const p = pack.probes.find(p => p.id === o.probeId); if (p && !p.targets.includes(conceptId)) posterior = updatePosterior(posterior, p, o.answer, config); }
  // Authored instructional assumption, not new observed learning: move repaired-belief mass to SOUND.
  for (const m of pack.misconceptions.filter(m => m.attachedTo.includes(conceptId))) { posterior.SOUND += posterior[m.id]; posterior[m.id] = 0; }
  return posterior;
}
export function resit(coverage: Record<string, Coverage>, observations: Observation[], conceptId: string, probes: Probe[]) {
  const posterior = repairPosterior(coverage, observations, conceptId);
  return { posterior, answers: examAnswers(map(posterior).id, probes) };
}
export function normalizedSentence(text: string) { return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
// For a contention candidate in an "insufficient evidence" verdict: which concept, if the
// explanation had established it, would have separated this candidate from the rest?
// SOUND has no single attached concept (it means "everything covered"), so it returns null.
export function distinguishingConcept(h: string): Concept | null {
  const m = pack.misconceptions.find(m => m.id === h);
  if (!m) return null;
  return pack.concepts.find(c => c.id === m.attachedTo[0]) ?? null;
}
