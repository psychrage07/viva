import { safeRoute } from '@/lib/gemini/route';
import { explanationInput } from '@/lib/gemini/schemas';
import { classifyCoverage } from '@/lib/gemini/coverage';
import { unknownCoverage } from '@/lib/session-logic';
export const runtime='nodejs';
export const POST=safeRoute(explanationInput,i=>classifyCoverage(i.explanation),unknownCoverage);
