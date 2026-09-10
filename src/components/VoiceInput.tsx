'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Volume2, VolumeX } from 'lucide-react';
interface SpeechEvent { resultIndex:number; results:{length:number;[index:number]:{isFinal:boolean;0:{transcript:string}}} }
interface Recognition { continuous:boolean; interimResults:boolean; lang:string; onresult:((e:SpeechEvent)=>void)|null; onerror:((e:{error:string})=>void)|null; onend:(()=>void)|null; start:()=>void; stop:()=>void; abort:()=>void }
type SpeechWindow=Window & {SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};
export function VoiceInput({onText,disabled=false}:{onText:(text:string)=>void;disabled?:boolean}) {
  const [supported,setSupported]=useState<boolean|null>(null);const [listening,setListening]=useState(false);const [notice,setNotice]=useState('');const [interim,setInterim]=useState('');
  const ref=useRef<Recognition|null>(null);const callback=useRef(onText);callback.current=onText;
  useEffect(()=>{const w=window as SpeechWindow;setSupported(Boolean(w.SpeechRecognition||w.webkitSpeechRecognition));return()=>{if(ref.current){ref.current.onend=null;ref.current.abort();}};},[]);
  useEffect(()=>{if(disabled)ref.current?.stop();},[disabled]);
  function toggle(){
    if(listening){ref.current?.stop();return;}
    const w=window as SpeechWindow;const Constructor=w.SpeechRecognition||w.webkitSpeechRecognition;
    if(!Constructor){setNotice('Dictation is not supported in this browser. You can type, or try Chrome or Edge.');return;}
    const recognition=new Constructor();ref.current=recognition;recognition.continuous=true;recognition.interimResults=true;recognition.lang='en-US';
    recognition.onresult=e=>{let draft='';for(let i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal) callback.current(e.results[i][0].transcript);else draft+=e.results[i][0].transcript;}setInterim(draft);};
    recognition.onerror=e=>{setListening(false);setNotice(e.error==='not-allowed'?'Microphone permission was declined. Typing works just as well.':e.error==='no-speech'?'No speech heard. Try again when you are ready.':'Dictation is unavailable right now. Your typed explanation is safe.');};
    recognition.onend=()=>{setListening(false);setInterim('');};
    try{recognition.start();setListening(true);setNotice('Listening. Speak naturally, then stop and review your transcript.');}catch{setNotice('Could not start the microphone. Please use the text field.');}
  }
  return <div className="voice-controls"><button type="button" className={'voice-button '+(listening?'listening':'')} onClick={toggle} disabled={disabled||supported===null} aria-pressed={listening}>{listening?<Square size={15}/>:<Mic size={17}/>} {listening?'Stop recording':'Use your voice'}{listening&&<span className="voice-wave"><i/><i/><i/><i/></span>}</button><span className="voice-note">{supported===false?'Not supported here · typing is always available':'Your words. Not a perfect script.'}</span><p className="sr-only">Your browser may send audio to its speech service. Viva stores only your editable transcript in this tab.</p>{(notice||interim)&&<div className="voice-notice" role="status">{interim||notice}</div>}</div>;
}
export function ReadAloud({text}:{text:string}) {
  const [speaking,setSpeaking]=useState(false);const [notice,setNotice]=useState('');
  useEffect(()=>()=>{window.speechSynthesis?.cancel();},[]);
  function toggle(){if(!('speechSynthesis' in window)){setNotice('Read-aloud is unavailable in this browser.');return;}if(speaking){window.speechSynthesis.cancel();setSpeaking(false);return;}window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.rate=.93;utterance.onend=()=>setSpeaking(false);utterance.onerror=()=>{setSpeaking(false);setNotice('Read-aloud is unavailable right now.');};window.speechSynthesis.speak(utterance);setSpeaking(true);}
  return <><button className="icon-button" onClick={toggle} aria-label={speaking?'Stop reading':'Read aloud'} title={speaking?'Stop reading':'Read aloud'}>{speaking?<VolumeX size={18}/>:<Volume2 size={18}/>}</button>{notice&&<small role="status">{notice}</small>}</>;
}
