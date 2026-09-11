'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useModal } from './useModal';
import { ArrowRight, ArrowUpRight, Atom, Check, CircleHelp, Leaf, LoaderCircle, Minus, RotateCcw, ShieldCheck, Sparkles, X } from 'lucide-react';
import { Brand } from './Brand';
import Mascot from './Mascot';
import PosteriorChart from './PosteriorChart';
import RevealRepair from './RevealRepair';
import { ReadAloud, VoiceInput } from './VoiceInput';
import { config, diagnose, entropy, examAnswers, map, priorFromCoverage, seededRng, selectNextProbe, transferSet, updatePosterior, type Diagnosis, type Dist, type Observation } from '@/lib/engine';
import { newtonian as pack } from '@/lib/packs';
import { demoExplanation, fallbackRepair, fallbackVoice, unknownCoverage, type CoverageResult, type RepairResult, type Result, type VoiceResult } from '@/lib/session-logic';
import { initialSession, savedSessionSchema, type SessionState } from '@/lib/session-state';
import AbstainScreen from './AbstainScreen';
const STORAGE='viva-session-v1';
async function post<T>(phase:string,input:unknown,fallback:()=>T):Promise<Result<T>>{
 try{const response=await fetch('/api/'+phase,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({packId:'newtonian',...input as object}),signal:AbortSignal.timeout(42000)});if(!response.ok)throw new Error();const result=await response.json();if(!result||typeof result.degraded!=='boolean'||!result.data)throw new Error();return result;}catch{return {data:fallback(),degraded:true,source:'fallback',reason:'Connection unavailable. The deterministic experience continues.'};}
}
export default function Session({demoMode}:{demoMode:boolean}){
 const [s,setS]=useState<SessionState>(initialSession);const [ready,setReady]=useState(false);const [busy,setBusy]=useState('');const [chosen,setChosen]=useState('');const [confirmReset,setConfirmReset]=useState(false);const [storageNote,setStorageNote]=useState('');const titleRef=useRef<HTMLHeadingElement>(null);const lock=useRef(false);
 const closeReset=useCallback(()=>setConfirmReset(false),[]);useModal(confirmReset,closeReset);
 useEffect(()=>{try{const saved=sessionStorage.getItem(STORAGE);if(saved){const parsed=savedSessionSchema.safeParse(JSON.parse(saved));if(parsed.success)setS(parsed.data as SessionState);}else if(new URLSearchParams(window.location.search).get('demo')==='1')setS({...initialSession(),explanation:demoExplanation});}catch{setStorageNote('Tab storage is unavailable. Your session still works until you leave this page.');}setReady(true);},[]);
 useEffect(()=>{if(ready)try{sessionStorage.setItem(STORAGE,JSON.stringify(s));}catch{setStorageNote('Your browser could not save this session. Keep this tab open.');}},[s,ready]);
 useEffect(()=>{if(ready&&!busy){titleRef.current?.focus({preventScroll:true});window.scrollTo({top:0,behavior:'smooth'});}},[s.phase,ready,busy]);
 const patch=(values:Partial<SessionState>)=>setS(old=>({...old,...values}));
 const phaseIndex=s.phase==='teach'||s.phase==='coverage'?1:s.phase==='probe'||s.phase==='abstain'?2:3;
 const words=s.explanation.trim().split(/\s+/).filter(Boolean).length;
 const current=selectNextProbe(pack.probes,s.posterior,s.observations.map(o=>o.probeId),config);
 const choices=current?(()=>{const rng=seededRng(Number(current.id.slice(1))*8191);return current.choices.map(c=>({c,r:rng()})).sort((a,b)=>a.r-b.r).map(x=>x.c);})():[];
 async function teach(e:React.FormEvent){e.preventDefault();if(lock.current||words<5)return;lock.current=true;setBusy('Listening for the ideas in your explanation…');const result=await post<CoverageResult>('coverage',{explanation:s.explanation},unknownCoverage);const coverage=Object.fromEntries(pack.concepts.map(c=>[c.id,['covered','partial','missing','unknown'].includes(result.data.coverage?.[c.id])?result.data.coverage[c.id]:'unknown'])) as CoverageResult['coverage'];const posterior=priorFromCoverage(pack,coverage,config);patch({coverage,posterior,phase:'coverage',degraded:result.degraded,sourceNote:result.reason??'',entropyTrace:[entropy(posterior)],observations:[],diagnosis:null});setBusy('');lock.current=false;}
 async function reveal(posterior:Dist,observations:Observation[],diagnosisOverride?:Diagnosis){
  if(lock.current)return;lock.current=true;setBusy('Your student is taking a little transfer exam…');
  const diagnosis=diagnosisOverride??diagnose(posterior,s.entropyTrace,config);
  const hypothesis=diagnosis.kind==='misconception'?diagnosis.id:'SOUND';
  const probes=transferSet(pack,hypothesis,observations.map(o=>o.probeId));const transferIds=probes.map(p=>p.id);
  const voice=await post<VoiceResult>('student-voice',{hypothesis,probeIds:transferIds,explanation:s.explanation},()=>fallbackVoice(hypothesis,probes));
  const commitments=examAnswers(hypothesis,probes);const validVoice=voice.data.answers?.length===4&&voice.data.answers.every((a,i)=>a.probeId===commitments[i].probeId&&a.choice===commitments[i].choice);
  const repair=await post<RepairResult>('repair',{hypothesis,explanation:s.explanation},()=>fallbackRepair(hypothesis));const authored=fallbackRepair(hypothesis);const validRepair=repair.data.conceptId===authored.conceptId&&repair.data.sentence===authored.sentence;
  patch({posterior,observations,hypothesis,diagnosis,transferIds,voice:validVoice?voice.data:fallbackVoice(hypothesis,probes),repair:validRepair?repair.data:authored,phase:'reveal',shown:1,degraded:s.degraded||voice.degraded||repair.degraded||!validVoice||!validRepair});setBusy('');lock.current=false;
 }
 function answer(e:React.FormEvent,override?:string){
  e.preventDefault();const choice=override??chosen;if(!choice||!current||lock.current)return;
  const posterior=updatePosterior(s.posterior,current,choice,config);
  const observations=[...s.observations,{probeId:current.id,answer:choice}];
  const entropyTrace=[...s.entropyTrace,entropy(posterior)];
  setChosen('');patch({posterior,observations,entropyTrace});
  // The UI asks a minimum of 3 questions even if confidence would clear the bar sooner
  // (documented, deliberate divergence from the engine/benchmark's immediate-stop rule).
  const minReached=observations.length>=3;
  const confidentEnough=minReached&&map(posterior).p>=config.confidence;
  const exhausted=observations.length>=config.maxProbes;
  const recentDrops=entropyTrace.slice(-4);
  const avgDrop=recentDrops.length===4?((recentDrops[0]-recentDrops[1])+(recentDrops[1]-recentDrops[2])+(recentDrops[2]-recentDrops[3]))/3:Infinity;
  const stalled=minReached&&recentDrops.length===4&&avgDrop<config.minEntropyDropPerProbe&&entropy(posterior)>=config.abstainEntropyFloor;
  if(confidentEnough||exhausted||stalled){
   const verdict=diagnose(posterior,entropyTrace,config);
   if(verdict.kind==='insufficient')patch({phase:'abstain',diagnosis:verdict});else void reveal(posterior,observations,verdict);
  }
 }
 function continueFromAbstain(){if(!s.diagnosis||s.diagnosis.kind!=='insufficient')return;void reveal(s.posterior,s.observations,{kind:'sound',confidence:map(s.posterior).p});}
 function restart(){setS(initialSession());setChosen('');setConfirmReset(false);try{sessionStorage.removeItem(STORAGE);}catch{} }
 const heading=(title:string,subtitle:string)=><><div className="session-topic"><Atom size={14}/> Newtonian force & motion <span> / </span> Your learning session</div><h1 className="session-title" ref={titleRef} tabIndex={-1}>{title}</h1><p className="session-subtitle">{subtitle}</p></>;
 return <><header className="session-header"><div className="session-header-inner"><Brand/><nav className="session-progress" aria-label="Session progress">{['Teach','Probe','Repair'].map((label,i)=><span key={label} className={phaseIndex===i+1?'active':''} aria-current={phaseIndex===i+1?'step':undefined}><i>{phaseIndex>i+1?<Check size={12}/>:i+1}</i>{label}</span>)}</nav><div className="session-header-right"><span className="mode-label"><i/>{demoMode?'Offline demo':'Private to this tab'}</span><button className="text-button" onClick={()=>setConfirmReset(true)} disabled={Boolean(busy)}>Start over <RotateCcw size={12}/></button></div></div></header>
 <main className="session-main">{(!ready||busy)?<div className="loading-state" role="status"><Mascot small/><h2>{busy||'Getting your notebook ready…'}</h2><p>Good understanding starts with a little curiosity.</p><div className="loading-dots"><i/><i/><i/></div></div>:<>
 {storageNote&&<div className="offline-notice" role="status">{storageNote}</div>}
 {s.phase==='teach'&&<section className="teach-screen">{heading('Let’s start with your words.','You’re the teacher now. Explain it like you would to a curious friend.')}<div className="teaching-prompt"><div className="prompt-icon"><Atom size={29} strokeWidth={1.2}/></div><div><span>YOUR FIRST LITTLE LESSON</span><p>Why does a ball thrown straight up slow down, stop, and come back down?</p></div><ReadAloud text="Explain to a beginner why a ball thrown straight up slows down, stops, and comes back down. Ignore air resistance."/></div><form onSubmit={teach}><div className="explanation-box"><label htmlFor="explanation">YOUR EXPLANATION · IGNORE AIR RESISTANCE</label><textarea id="explanation" value={s.explanation} onChange={e=>patch({explanation:e.target.value})} maxLength={10000} placeholder="Well, imagine throwing a ball into the air…" required minLength={15}/><div className="input-bottom"><VoiceInput onText={text=>setS(old=>({...old,explanation:(old.explanation+' '+text).trim().slice(0,10000)}))}/><span className="word-counter">{words} word{words===1?'':'s'}</span></div></div><p className="voice-disclosure">Voice is optional. Your browser may process audio through its speech service; review the transcript before sending. Only your text is sent to Viva.</p><div className="teach-actions"><button type="button" className="sample-button" onClick={()=>patch({explanation:demoExplanation})}>A little stuck? Try an example</button><button type="submit" className="button" disabled={words<5}>Let’s see what I taught <ArrowRight size={17}/></button></div></form><div className="small-reassurance"><ShieldCheck size={13}/> No perfect words needed. This is a starting point, not a test.</div></section>}
 {s.phase==='coverage'&&<section>{heading('Here’s what came through.','Here is what your explanation established, and what it left open.')}<div className="phase-layout"><div>{s.degraded&&<div className="offline-notice"><Sparkles size={14}/><span>{demoMode?'You’re exploring the offline version. The example uses an authored fixture; other explanations may show “unknown”.':'The language model is unavailable. Concepts stay unknown rather than guessing.'} The questions still work normally.</span></div>}<div className="coverage-list">{pack.concepts.map((c,i)=>{const status=s.coverage[c.id];return <div key={c.id} className={'coverage-chip '+status} style={{animationDelay:`${i*60}ms`}} title={c.statement}><span className="coverage-icon">{status==='covered'?<Check size={13}/>:status==='partial'?<Minus size={13}/>:<CircleHelp size={12}/>}</span><span>{c.label}</span><span className="coverage-status">{status==='missing'?'Left open':status}</span></div>;})}</div><p className="coverage-list-footer">An explanation can’t tell us everything. We’ll use 3–6 short questions to distinguish the possibilities—not to catch you out.</p><button className="button" onClick={()=>patch({phase:'probe'})}>Let’s fill in the picture <ArrowRight size={17}/></button></div><PosteriorChart distribution={s.posterior}/></div></section>}
 {s.phase==='probe'&&current&&<section>{heading('A few questions. A clearer picture.','Choose what feels right to you. Every answer helps us understand your thinking.')}<div className="phase-layout"><div><form className="question-card" onSubmit={answer} key={current.id}><div className="question-topline"><span className="question-index">QUESTION {s.observations.length+1} OF UP TO 6</span><ReadAloud text={current.stem+' '+choices.map((c,i)=>`${String.fromCharCode(65+i)}: ${c.text}`).join('. ')}/></div><div className="probe-progress">{Array.from({length:6},(_,i)=><i key={i} className={i<=s.observations.length?'done':''}/>)}</div><h2>{current.stem}</h2><fieldset className="question-options"><legend className="sr-only">Choose one answer</legend>{choices.map((c,i)=><label className={'question-option '+(chosen===c.id?'selected':'')} key={c.id}><input type="radio" name="answer" value={c.id} checked={chosen===c.id} onChange={()=>setChosen(c.id)} required/><span className="option-letter">{String.fromCharCode(65+i)}</span><span>{c.text}</span></label>)}</fieldset><div className="question-footer"><span>Go with your understanding.</span><button className="button" disabled={!chosen}>That’s my answer <ArrowRight size={16}/></button></div></form><p className="probe-help"><CircleHelp size={14}/><span>Why this question? It offers the largest expected reduction in uncertainty among the questions you haven’t seen yet.</span></p></div><PosteriorChart distribution={s.posterior} observations={s.observations.length}/></div></section>}
  {s.phase==='abstain'&&s.diagnosis&&s.diagnosis.kind==='insufficient'&&<AbstainScreen diagnosis={s.diagnosis} onContinue={continueFromAbstain}/>}
  {['reveal','repair'].includes(s.phase)&&<RevealRepair s={s} patch={patch}/>}
 <footer className="phase-footer"><span><Leaf size={12}/> A little curiosity goes a long way.</span><span><ShieldCheck size={12}/> {s.degraded?'Deterministic offline support is active.':'Your session stays in this tab.'}</span></footer></>}
 </main>{confirmReset&&<div className="modal-backdrop" onClick={()=>setConfirmReset(false)}><section className="demo-modal" role="alertdialog" aria-modal="true" aria-labelledby="restart-title" onClick={e=>e.stopPropagation()}><button className="modal-close icon-button" onClick={()=>setConfirmReset(false)} aria-label="Cancel restart"><X/></button><h2 id="restart-title">A fresh page?</h2><p>This clears the explanation and progress saved in this tab. You can also keep going where you left off.</p><div className="modal-actions"><button className="button secondary" onClick={()=>setConfirmReset(false)} autoFocus>Keep my session</button><button className="button" onClick={restart}>Start fresh <RotateCcw size={15}/></button></div></section></div>}</>;
}
