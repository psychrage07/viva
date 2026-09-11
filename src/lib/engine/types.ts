export type Coverage = 'covered' | 'partial' | 'missing' | 'unknown';
export interface Concept { id: string; label: string; statement: string; probeHint: string }
export interface Misconception { id: string; label: string; belief: string; attachedTo: string[]; repair: string; citation: string; searchTerms: string[] }
export interface Probe { id: string; stem: string; choices: { id: string; text: string }[]; correct: string; predicted: Record<string, string>; targets: string[] }
export interface TopicPack { id: string; title: string; concepts: Concept[]; misconceptions: Misconception[]; probes: Probe[] }
export type Dist = Record<string, number>;
export interface Config { slip: number; soundBias: number; floor: number; confidence: number; maxProbes: number; gapWeight: Record<Coverage, number>; abstainEntropyFloor: number; minEntropyDropPerProbe: number }
export interface Observation { probeId: string; answer: string }
export interface ExamAnswer { probeId: string; choice: string; correct: boolean }
// Diagnosis is a verdict ABOUT the posterior, not a fourth hypothesis inside it.
// INSUFFICIENT_EVIDENCE never enters the Dist that the Bayesian update operates over.
export const INSUFFICIENT_EVIDENCE = 'INSUFFICIENT_EVIDENCE' as const;
export interface Candidate { id: string; p: number }
export interface MisconceptionDiagnosis { kind: 'misconception'; id: string; confidence: number }
export interface SoundDiagnosis { kind: 'sound'; confidence: number }
export interface InsufficientDiagnosis { kind: 'insufficient'; entropyBits: number; topCandidates: Candidate[] }
export type Diagnosis = MisconceptionDiagnosis | SoundDiagnosis | InsufficientDiagnosis;
