export type Coverage = 'covered' | 'partial' | 'missing' | 'unknown';
export interface Concept { id: string; label: string; statement: string; probeHint: string }
export interface Misconception { id: string; label: string; belief: string; attachedTo: string[]; repair: string; citation: string }
export interface Probe { id: string; stem: string; choices: { id: string; text: string }[]; correct: string; predicted: Record<string, string>; targets: string[] }
export interface TopicPack { id: string; title: string; concepts: Concept[]; misconceptions: Misconception[]; probes: Probe[] }
export type Dist = Record<string, number>;
export interface Config { slip: number; soundBias: number; floor: number; confidence: number; maxProbes: number; gapWeight: Record<Coverage, number> }
export interface Observation { probeId: string; answer: string }
export interface ExamAnswer { probeId: string; choice: string; correct: boolean }
