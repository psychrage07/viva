import { Suspense } from 'react';
import ResultCard from '@/components/ResultCard';
export const metadata={title:'An aha! moment — Viva'};
export default function ResultPage(){return <Suspense fallback={<div className="loading-state">Opening your little breakthrough…</div>}><ResultCard/></Suspense>;}
