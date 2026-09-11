'use client';
import { useEffect, useRef } from 'react';
import { ArrowRight, CircleHelp, ScanSearch } from 'lucide-react';
import { Atom } from 'lucide-react';
import { newtonian as pack } from '@/lib/packs';
import { distinguishingConcept } from '@/lib/session-logic';
import type { InsufficientDiagnosis } from '@/lib/engine';

const labels: Record<string, string> = { SOUND: 'Sound understanding', ...Object.fromEntries(pack.misconceptions.map(m => [m.id, m.label])) };

/**
 * The evidence gate, made visible: shown only when diagnose() returns `insufficient`.
 * Never names a single misconception here — that would misrepresent what the posterior supports.
 */
export default function AbstainScreen({ diagnosis, onContinue }: { diagnosis: InsufficientDiagnosis; onContinue: () => void }) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, []);
  return <section className="abstain-screen">
    <div className="session-topic"><Atom size={14} /> Newtonian force & motion <span> / </span> Your learning session</div>
    <h1 className="session-title" ref={title} tabIndex={-1}>Still a few open possibilities.</h1>
    <p className="session-subtitle">Your explanation left several possibilities open, and the questions didn’t separate them. Here’s what’s still in contention, rather than a guess dressed up as a diagnosis.</p>
    <div className="offline-notice" style={{ marginTop: 5 }}>
      <CircleHelp size={14} />
      <span>Remaining uncertainty: <strong>{diagnosis.entropyBits.toFixed(2)} bits</strong>. That is why we are not naming a single working hypothesis — sometimes the most responsible output is no output.</span>
    </div>
    <div className="contention-grid">
      {diagnosis.topCandidates.map(c => {
        const concept = distinguishingConcept(c.id);
        return <article className="contention-card" key={c.id}>
          <div className="contention-card-top"><span>{labels[c.id] ?? c.id}</span><b>{Math.round(c.p * 100)}%</b></div>
          <div className="bar-track"><div style={{ width: `${Math.max(4, c.p * 100)}%` }} /></div>
          <p className="contention-distinguish"><ScanSearch size={13} /> {concept ? <>Would be separated from the others by clarifying: <strong>{concept.label}</strong> — {concept.statement}</> : <>This candidate means everything covered so far checks out; more evidence about any open concept could still confirm it.</>}</p>
        </article>;
      })}
    </div>
    <button className="button" onClick={onContinue}>See how your student did anyway <ArrowRight size={17} /></button>
    <p className="probe-help" style={{ marginTop: 14 }}><CircleHelp size={14} /><span>Your student will still sit the transfer exam, answering as a sound understanding. We can’t tell what it would get wrong — which is itself informative: your explanation was ambiguous rather than incomplete.</span></p>
  </section>;
}
