'use client';
// <Canvas> cannot SSR, and three.js (~600KB) has no reason to sit in the main bundle for a
// component that's only visible in the probe/reveal phases. Both Session.tsx and RevealRepair.tsx
// are already 'use client', but Next.js still server-renders client components on first request
// for hydration — dynamic(..., { ssr: false }) is what actually skips that, not the 'use client'
// directive alone.
import dynamic from 'next/dynamic';
import type { PhysicsStageProps } from './PhysicsStage';

const PhysicsStage = dynamic(() => import('./PhysicsStage'), {
  ssr: false,
  loading: () => <div className="physics-stage-loading" aria-hidden="true" />,
});

export default function PhysicsStageLoader(props: PhysicsStageProps) {
  // Keying on hypothesis forces a full remount on change (fix #3), which also resets all local
  // playback state (t, playing, startRef) for free rather than needing an extra reset effect
  // fired from the parent.
  return <PhysicsStage key={props.hypothesis} {...props} />;
}
