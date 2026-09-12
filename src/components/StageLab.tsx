'use client';
// Development-only control surface for the physics stage. Kept out of the learner flow (the route
// 404s in production) but useful for reviewing motion: it puts every hypothesis on the shared
// framing its scenario uses, and exposes the ghost overlay.
import { useState } from 'react';
import PhysicsStage from './PhysicsStage';
import { newtonian as pack } from '@/lib/packs';
import { scenarioFor, sceneLabelFor } from '@/lib/physics-viz/scenes';

const HYPOTHESES = ['SOUND', ...pack.misconceptions.map((m) => m.id)];
const LABELS: Record<string, string> = Object.fromEntries([
  ['SOUND', 'sound understanding'],
  ...pack.misconceptions.map((m) => [m.id, m.label]),
]);

export default function StageLab() {
  const [hypothesis, setHypothesis] = useState('SOUND');
  const [showGhost, setShowGhost] = useState(false);
  return (
    <div style={{ display: 'grid', gap: 18, marginTop: 22 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {HYPOTHESES.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setHypothesis(id)}
            aria-pressed={hypothesis === id}
            className={'text-button ' + (hypothesis === id ? 'lab-chip-active' : 'lab-chip')}
            title={sceneLabelFor(id)}
          >
            {LABELS[id]}
          </button>
        ))}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <input type="checkbox" checked={showGhost} onChange={(e) => setShowGhost(e.target.checked)} />
        Show the true motion alongside it
      </label>
      <p className="physics-stage-scene-label">
        {scenarioFor(hypothesis)} · <code>{hypothesis}</code>
      </p>
      <PhysicsStage key={hypothesis + (showGhost ? '+ghost' : '')} hypothesis={hypothesis} showGhost={showGhost} />
    </div>
  );
}
