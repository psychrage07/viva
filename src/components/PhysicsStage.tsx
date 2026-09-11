'use client';
import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { newtonian as pack } from '@/lib/packs';
import { frameFor, sceneLabelFor, trueFrameFor } from '@/lib/physics-viz/scenes';
import SceneRenderer, { type ScenePalette } from './SceneRenderer';

const DURATION_MS = 2200;

// --- Color: three.Color.setStyle() parses hex/rgb/hsl/named — it never reads the CSS cascade,
// so `var(--x)` is silently wrong in a three.js material prop. Sample the computed style once per
// mount instead, with literal fallbacks so SSR/first-paint never reads getComputedStyle on a
// server document. The fallback hex values are copied verbatim from :root in globals.css.
const FALLBACK_PALETTE = {
  green: '#284c3a',
  yellow: '#e7ce65',
  lavender: '#ded5ed',
  cream: '#f9f9f1',
  muted: '#72786d',
  dark: '#253e30',
};
function usePalette() {
  const [palette, setPalette] = useState(FALLBACK_PALETTE);
  useEffect(() => {
    const s = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
    setPalette({
      green: read('--green', FALLBACK_PALETTE.green),
      yellow: read('--yellow', FALLBACK_PALETTE.yellow),
      lavender: read('--lavender', FALLBACK_PALETTE.lavender),
      cream: read('--cream', FALLBACK_PALETTE.cream),
      muted: read('--muted', FALLBACK_PALETTE.muted),
      dark: read('--dark', FALLBACK_PALETTE.dark),
    });
  }, []);
  return palette;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export interface PhysicsStageProps {
  /** Current MAP hypothesis id (e.g. from `map(posterior).id`) — 'SOUND' or a misconception id. */
  hypothesis: string;
  /** Whether to show the dimmer true-kinematics scene alongside the believed one. Typically only
   * in the reveal phase. */
  showGhost?: boolean;
  compact?: boolean;
}

const labelFor = (id: string) => (id === 'SOUND' ? 'sound understanding' : pack.misconceptions.find((m) => m.id === id)?.label ?? id);

export default function PhysicsStage({ hypothesis, showGhost = false, compact = false }: PhysicsStageProps) {
  const palette = usePalette();
  const reducedMotion = usePrefersReducedMotion();

  const believedPalette: ScenePalette = {
    primary: hypothesis === 'SOUND' ? palette.green : palette.yellow,
    secondary: palette.muted,
    ghost: palette.lavender,
    ground: palette.dark,
    groundIndoor: palette.cream,
  };
  const truePalette: ScenePalette = {
    primary: palette.lavender,
    secondary: palette.lavender,
    ghost: palette.lavender,
    ground: palette.dark,
    groundIndoor: palette.cream,
  };

  const [t, setT] = useState(0);
  // Autoplay only when motion is allowed; reduced-motion users get a static apex-frame preview
  // with manual scrub still available, per the accessibility note below.
  const [playing, setPlaying] = useState(!reducedMotion);
  const startRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  // If the leading hypothesis changes mid-flight (the user answered while the ball was airborne),
  // reset to t=0 rather than let it teleport. Keying the whole component on `hypothesis` at the
  // call site (see PhysicsStageLoader) additionally forces a full remount, which also resets
  // local playback state cleanly.
  useEffect(() => {
    setT(0);
    startRef.current = null;
  }, [hypothesis]);

  useEffect(() => {
    if (!playing) return;
    function tick(now: number) {
      if (startRef.current === null) startRef.current = now - t * DURATION_MS;
      const elapsed = now - startRef.current;
      const next = Math.min(1, elapsed / DURATION_MS);
      setT(next);
      if (next < 1) frameRef.current = requestAnimationFrame(tick);
      else setPlaying(false);
    }
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  function togglePlay() {
    if (t >= 1) {
      setT(0);
      startRef.current = null;
    }
    setPlaying((p) => !p);
  }
  function restart() {
    setT(0);
    startRef.current = null;
    setPlaying(!reducedMotion);
  }
  function scrub(next: number) {
    setPlaying(false);
    startRef.current = null;
    setT(next);
  }

  const believedFrame = frameFor(hypothesis)(t);
  const trueFrame = trueFrameFor(hypothesis)(t);
  const sceneLabel = sceneLabelFor(hypothesis);

  const label = `Showing: the "${labelFor(hypothesis)}" belief's predicted motion${showGhost ? ', with the true motion shown alongside it' : ''}.`;

  const canvasHeight = compact ? 260 : 420;

  return (
    <div className={'physics-stage ' + (compact ? 'compact' : '')}>
      <p className="physics-stage-scene-label">{sceneLabel}</p>
      <div className="physics-stage-canvas" style={{ height: canvasHeight, width: '100%', background: palette.cream }} aria-hidden="true">
        <Canvas shadows camera={{ position: [1.8, 1.3, 2.1], fov: 42 }}>
          <SceneRenderer frame={believedFrame} palette={believedPalette} trail t={t} />
          {showGhost && <SceneRenderer frame={trueFrame} palette={truePalette} dim />}
          <OrbitControls autoRotate autoRotateSpeed={0.6} enablePan={false} enableZoom={false} minPolarAngle={0.4} maxPolarAngle={1.4} />
        </Canvas>
      </div>

      <div className="physics-stage-controls">
        <button type="button" className="icon-button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button type="button" className="icon-button" onClick={restart} aria-label="Restart">
          <RotateCcw size={15} />
        </button>
        <input type="range" min={0} max={1} step={0.01} value={t} onChange={(e) => scrub(Number(e.target.value))} aria-label="Scrub through the demonstration" style={{ flex: 1 }} />
      </div>

      {/* Visible + informational text: the animation alone must never be the only place this
          information lives (accessibility gap called out in review). */}
      <p className="physics-stage-label">{label}</p>
    </div>
  );
}
