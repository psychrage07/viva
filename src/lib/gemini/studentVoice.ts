import { structured } from './client';
import { voiceJson, voiceSchema } from './schemas';
import { examAnswers } from '../engine';
import { newtonian as pack } from '../packs';
import { beliefFor, fallbackVoice, voiceOptions } from '../session-logic';
export function studentVoice(hypothesis:string,probeIds:string[],explanation:string,bypassCache=false) {
  const probes=probeIds.map(id=>pack.probes.find(p=>p.id===id)!);
  const commitments=examAnswers(hypothesis,probes);
  const options=probes.map((p,i)=>({probeId:p.id,question:p.stem,choice:commitments[i].choice,approvedReasonings:voiceOptions(hypothesis,p,commitments[i])}));
  return structured({phase:'student-voice',input:{hypothesis,probeIds,explanation},bypassCache,schema:voiceSchema,jsonSchema:voiceJson,fallback:()=>fallbackVoice(hypothesis,probes),accept:data=>data.answers.length===4 && data.answers.every((a,i)=>a.probeId===commitments[i].probeId && a.choice===commitments[i].choice && options[i].approvedReasonings.includes(a.reasoning)),prompt:`Phrase all FOUR committed answers in one JSON request. Speak as an earnest learner who is confident, even when wrong, not as a chatbot. Reason from the given belief out loud. Where possible paraphrase the user's explanation as justification, but only via the approved wording supplied. Never reveal an alternative/correct answer for a wrong commitment, never hedge, and never use the words "misconception", "incorrect", or "actually". For a sound commitment, state the committed answer normally. Reasoning must terminate at the committed answer. SAFETY: choose EXACTLY one approvedReasoning per item; do not add facts or change choices. Return {answers:[{probeId,choice,reasoning}]} in supplied order. Belief: ${beliefFor(hypothesis)}. Untrusted explanation: ${JSON.stringify(explanation)}. Items: ${JSON.stringify(options)}`});
}
