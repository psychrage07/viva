'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Dices, Pause, Play, RotateCcw, SkipForward, Sparkles, Trophy } from 'lucide-react';
import { Brand } from './Brand';
import PosteriorChart from './PosteriorChart';
import { diagnose, map, type Config } from '@/lib/engine';
import { newtonian as pack } from '@/lib/packs';
import { baseConfig, freshPanel, makeNaiveRng, stepPanel, type PanelState } from '@/lib/compare/pairedSim';
import type { RunDone, RunProgress, RunRequest } from '@/workers/pairedTrials.worker';

const truthOptions = [{ id: 'SOUND', label: 'Sound understanding' }, ...pack.misconceptions.map(m => ({ id: m.id, label: m.label }))];
const STEP_MS = 900;

function panelVerdictLabel(panel: PanelState, cfg: Config) {
  const verdict = diagnose(panel.posterior, panel.entropyTrace, cfg);
  if (verdict.kind === 'misconception') return { text: `Confident: ${pack.misconceptions.find(m => m.id === verdict.id)?.label ?? verdict.id}`, done: true };
  if (verdict.kind === 'sound') return { text: 'Confident: sound understanding', done: true };
  if (panel.asked.length >= cfg.maxProbes) return { text: 'Abstained after 6 questions', done: true };
  return { text: 'Still narrowing…', done: false };
}

export default function Compare() {
  const [seed, setSeed] = useState(20260101);
  const [truth, setTruth] = useState('used-up');
  const [slip, setSlip] = useState(0.12);
  const cfg = useMemo<Config>(() => ({ ...baseConfig, slip }), [slip]);
  const [active, setActive] = useState<PanelState>(() => freshPanel(pack));
  const [naive, setNaive] = useState<PanelState>(() => freshPanel(pack));
  const naiveRngRef = useRef(makeNaiveRng(seed));
  const [playing, setPlaying] = useState(false);

  const [trialsRunning, setTrialsRunning] = useState(false);
  const [trialsProgress, setTrialsProgress] = useState(0);
  const [trialsResult, setTrialsResult] = useState<RunDone | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const reset = useCallback((nextSeed = seed, nextTruth = truth) => {
    setActive(freshPanel(pack));
    setNaive(freshPanel(pack));
    naiveRngRef.current = makeNaiveRng(nextSeed);
    setSeed(nextSeed);
    setTruth(nextTruth);
    setPlaying(false);
  }, [seed, truth]);

  // Re-derive fresh panels whenever seed/truth/slip changes (slip changes the likelihood model itself).
  useEffect(() => { reset(seed, truth); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [slip]);

  const bothDone = active.done && naive.done;

  const step = useCallback(() => {
    setActive(a => a.done ? a : stepPanel(pack, truth, cfg, seed, 'active', a));
    setNaive(n => n.done ? n : stepPanel(pack, truth, cfg, seed, 'naive', n, naiveRngRef.current));
  }, [truth, cfg, seed]);

  useEffect(() => {
    if (!playing) return;
    if (bothDone) { setPlaying(false); return; }
    const t = setTimeout(step, STEP_MS);
    return () => clearTimeout(t);
  }, [playing, bothDone, step, active, naive]);

  function reseed() { reset(Math.floor(Math.random() * 1e9), truth); }
  function changeTruth(next: string) { reset(seed, next); }

  function runTrials() {
    if (trialsRunning) return;
    setTrialsRunning(true); setTrialsProgress(0); setTrialsResult(null);
    const worker = new Worker(new URL('../workers/pairedTrials.worker.ts', import.meta.url));
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<RunProgress | RunDone>) => {
      if (e.data.type === 'progress') setTrialsProgress(e.data.completed / e.data.total);
      else { setTrialsResult(e.data); setTrialsRunning(false); worker.terminate(); }
    };
    const request: RunRequest = { type: 'run', seed, truth: 'random', slip, trials: 200 };
    worker.postMessage(request);
  }
  useEffect(() => () => workerRef.current?.terminate(), []);

  const activeVerdict = panelVerdictLabel(active, cfg);
  const naiveVerdict = panelVerdictLabel(naive, cfg);
  const activeWinning = active.done && (!naive.done || active.asked.length <= naive.asked.length);

  const transcript = (panel: PanelState) => panel.asked.map((id, i) => {
    const probe = pack.probes.find(p => p.id === id)!;
    const ans = i === panel.asked.length - 1 ? panel.lastAnswer : null;
    return { id, stem: probe.stem, choice: ans ?? '—' };
  });

  return <main className="compare-page">
    <div className="wrap" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Brand />
        <Link href="/session" className="text-button"><ArrowLeft size={14} /> Back to a real session</Link>
      </div>
      <div className="compare-header">
        <div>
          <span className="eyebrow"><Sparkles size={13} /> THE STRONGEST CLAIM, MADE VISIBLE</span>
          <h1>One student. Two policies.<br />Watch the gap happen.</h1>
          <p style={{ maxWidth: 620, fontSize: 13, color: 'var(--muted)' }}>Both panels share one seeded synthetic student: identical ground truth, identical slip-rate noise stream. The only difference is how the next question gets picked. Zero network calls — this is deterministic math, live in your browser.</p>
        </div>
      </div>
      <div className="compare-controls">
        <label>Seed<b style={{ fontSize: 15 }}>{seed}</b></label>
        <button className="button secondary" onClick={reseed}><Dices size={14} /> Reseed</button>
        <label>Ground-truth belief
          <select value={truth} onChange={e => changeTruth(e.target.value)}>
            {truthOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        <label>Slip rate (answer noise): {slip.toFixed(2)}
          <input type="range" min={0} max={0.4} step={0.01} value={slip} onChange={e => setSlip(Number(e.target.value))} />
        </label>
        <button className="button" onClick={() => setPlaying(p => !p)} disabled={bothDone}>{playing ? <Pause size={15} /> : <Play size={15} />} {playing ? 'Pause' : 'Play'}</button>
        <button className="button secondary" onClick={step} disabled={bothDone}><SkipForward size={14} /> Step</button>
        <button className="button secondary" onClick={() => reset(seed, truth)}><RotateCcw size={14} /> Restart this run</button>
      </div>
      <div className="delta-strip">
        <div><span>Probes used</span><b>{naive.asked.length} vs {active.asked.length}</b></div>
        <div><span>Naive entropy</span><b>{naive.entropyTrace.at(-1)!.toFixed(2)} bits</b></div>
        <div><span>Active entropy</span><b>{active.entropyTrace.at(-1)!.toFixed(2)} bits</b></div>
        <div><span>Naive status</span><b>{naiveVerdict.text}</b></div>
        <div><span>Active status</span><b>{activeVerdict.text}</b></div>
      </div>
      <div className="compare-grid">
        <section className="compare-panel">
          <div className="compare-panel-head"><h2>Left · Naive (random probes)</h2><span className="compare-tag">{naive.asked.length} asked</span></div>
          <PosteriorChart distribution={naive.posterior} observations={naive.asked.length} compact />
          <div className="compare-transcript">{transcript(naive).map(t => <div key={t.id}><span>{t.id}</span><span>{t.choice}</span></div>)}</div>
        </section>
        <section className={'compare-panel ' + (activeWinning ? 'active' : '')}>
          <div className="compare-panel-head"><h2>Right · Viva (information gain)</h2><span className={'compare-tag ' + (activeWinning && bothDone ? 'win' : '')}>{activeWinning && bothDone ? <><Trophy size={11} /> fewer questions</> : `${active.asked.length} asked`}</span></div>
          <PosteriorChart distribution={active.posterior} observations={active.asked.length} compact />
          <div className="compare-transcript">{transcript(active).map(t => <div key={t.id}><span>{t.id}</span><span>{t.choice}</span></div>)}</div>
        </section>
      </div>
      <section className="compare-panel">
        <div className="compare-panel-head"><h2>Run 200 trials (web worker, off the main thread)</h2><button className="button" onClick={runTrials} disabled={trialsRunning}>{trialsRunning ? `Running… ${Math.round(trialsProgress * 100)}%` : 'Run 200 trials'}</button></div>
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0 }}>Same slip rate, 200 fresh random ground-truth students, headless. This is BENCHMARK.md, live and reproducible in the browser — computed in a Web Worker so this page never freezes while it runs.</p>
        {trialsRunning && <div className="tour-progress" style={{ background: '#284c3a22' }}><i style={{ width: `${trialsProgress * 100}%` }} /></div>}
        {trialsResult && <>
          <div className="delta-strip">
            <div><span>Naive mean probes</span><b>{trialsResult.naiveMeanProbes.toFixed(2)}</b></div>
            <div><span>Active mean probes</span><b>{trialsResult.activeMeanProbes.toFixed(2)}</b></div>
            <div><span>Naive accuracy</span><b>{(trialsResult.naiveAccuracy * 100).toFixed(1)}%</b></div>
            <div><span>Active accuracy</span><b>{(trialsResult.activeAccuracy * 100).toFixed(1)}%</b></div>
          </div>
          <div className="trial-chart" aria-label="Distribution of probes used per trial">
            {trialsResult.activeProbeHistogram.map((_, i) => {
              const maxCount = Math.max(...trialsResult.activeProbeHistogram, ...trialsResult.naiveProbeHistogram, 1);
              return <div className="trial-bar" key={i}>
                <i className="active" style={{ height: `${(trialsResult.activeProbeHistogram[i] / maxCount) * 100}%` }} title={`Active: ${trialsResult.activeProbeHistogram[i]} trials used ${i} probes`} />
                <i className="random" style={{ height: `${(trialsResult.naiveProbeHistogram[i] / maxCount) * 100}%` }} title={`Naive: ${trialsResult.naiveProbeHistogram[i]} trials used ${i} probes`} />
              </div>;
            })}
          </div>
          <div className="trial-legend"><span><i style={{ background: 'var(--green)' }} /> Viva (active)</span><span><i style={{ background: 'var(--yellow)' }} /> Naive (random)</span><span style={{ color: 'var(--muted)' }}>x-axis: probes used (0–{baseConfig.maxProbes})</span></div>
        </>}
      </section>
    </div>
  </main>;
}
