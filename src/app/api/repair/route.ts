import { safeRoute } from '@/lib/gemini/route';
import { repairInput } from '@/lib/gemini/schemas';
import { writeRepair } from '@/lib/gemini/repair';
import { fallbackRepair } from '@/lib/session-logic';
export const runtime='nodejs';
export const POST=safeRoute(repairInput,i=>writeRepair(i.hypothesis,i.explanation),()=>fallbackRepair('SOUND'));
