import { safeRoute } from '@/lib/gemini/route';
import { voiceInput } from '@/lib/gemini/schemas';
import { studentVoice } from '@/lib/gemini/studentVoice';
import { fallbackVoice } from '@/lib/session-logic';
import { newtonian } from '@/lib/packs';
export const runtime='nodejs';
export const POST=safeRoute(voiceInput,i=>studentVoice(i.hypothesis,i.probeIds,i.explanation),()=>fallbackVoice('SOUND',newtonian.probes.slice(0,4)));
