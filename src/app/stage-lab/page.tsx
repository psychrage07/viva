import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Brand } from '@/components/Brand';
import StageLab from '@/components/StageLab';

export const metadata = { title: 'Scene lab — Viva' };

/** Development-only review surface for the physics stage: every hypothesis on one camera framing
 * per scenario, with the ghost overlay and the scrubber exposed. Not part of the learner flow, so
 * it 404s in a production build. */
export default function StageLabPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <>
      <header className="site-header wrap">
        <Brand />
        <Link href="/" className="inline-link">
          <ArrowLeft size={14} /> Back to Viva
        </Link>
      </header>
      <main className="science-page">
        <span className="eyebrow">DEVELOPMENT ONLY</span>
        <h1>Scene lab</h1>
        <p>Every hypothesis the engine can infer, on the shared framing its scenario uses. Switch beliefs to check the motion, the trail, and the true-motion overlay.</p>
        <StageLab />
      </main>
    </>
  );
}
