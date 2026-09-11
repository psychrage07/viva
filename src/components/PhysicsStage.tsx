'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type * as THREE from 'three';
import { newtonian as pack } from '@/lib/packs';
import { resolveMotion, scenarioFor, type Resolution, type Scenario } from '@/lib/physics-viz/beliefMotion';

const DURATION_MS = 2200;

// --- Color: three.Color.setStyle() parses hex/rgb/hsl/named — it never reads the CSS cascade,
// so `var(--green)` is silently wrong. Sample the computed style once per mount instead, with
// literal fallbacks so SSR/first-paint never reads getComputedStyle on a server document. The
// fallback hex values are copied verbatim from :root in globals.css.
const FALLBACK_PALETTE = { green: '#284c3a', yellow: '#e7ce65', lavender: '#ded5ed', cream: '#f9f9f1', muted: '#72786d' };
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

/** Moves the ball via a ref inside useFrame — not React state — so the 60fps loop never touches
 * the component tree. `t` is a single source of truth (a ref for the frame loop, mirrored into
 * state only for the scrubber UI, which reads/writes less often). */
function Ball({ resolution, t, color }: { resolution: Resolution; t: number; color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!ref.current || resolution.kind !== 'motion') return;
    const { y } = resolution.fn(t);
    ref.current.position.y = y * 1.6; // scene-unit scale
  });
  if (resolution.kind !== 'motion') return null;
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.14, 24, 24]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function GhostPath({ scenario, color }: { scenario: Scenario; color: string }) {
  const points = useMemo<[number, number, number][]>(() => {
    const sound = resolveMotion('SOUND', scenario);
    if (sound.kind !== 'motion') return [];
    const n = 40;
    return Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n;
      return [0, sound.fn(t).y * 1.6, 0] as [number, number, number];
    });
  }, [scenario]);
  if (!points.length) return null;
  return <Line points={points} color={color} dashed dashSize={0.06} gapSize={0.05} lineWidth={1.5} />;
}

function Ground({ color }: { color: string }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[3, 3]} />
      <meshStandardMaterial color={color} transparent opacity={0.35} />
    </mesh>
  );
}

export interface PhysicsStageProps {
  /** Current MAP hypothesis id (e.g. from `map(posterior).id`) — 'SOUND' or a misconception id. */
  hypothesis: string;
  /** Whether to show the dashed true-kinematics reference path. Typically only in the reveal phase. */
  showGhost?: boolean;
  compact?: boolean;
}

const labelFor = (id: string) => (id === 'SOUND' ? 'sound understanding' : pack.misconceptions.find((m) => m.id === id)?.label ?? id);

export default function PhysicsStage({ hypothesis, showGhost = false, compact = false }: PhysicsStageProps) {
  const palette = usePalette();
  const reducedMotion = usePrefersReducedMotion();
  const scenario = scenarioFor(hypothesis) ?? 'toss';
  const resolution = resolveMotion(hypothesis, scenario);

  const [t, setT] = useState(0);
  // Autoplay only when motion is allowed; reduced-motion users get a static apex-frame preview
  // with manual scrub still available, per the accessibility note below.
  const [playing, setPlaying] = useState(!reducedMotion);
  const startRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  // Fix #3: if the leading hypothesis changes mid-flight (the user answered while the ball was
  // airborne), reset to t=0 rather than let it teleport. Keying the whole component on
  // `hypothesis` at the call site (see PhysicsStageLoader) additionally forces a full remount,
  // which also resets local playback state cleanly.
  useEffect(() => {
    setT(0);
    startRef.current = null;
  }, [hypothesis]);

  useEffect(() => {
    if (!playing || resolution.kind !== 'motion') return;
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

  const label = resolution.kind === 'motion' ? `Showing: the "${labelFor(hypothesis)}" belief's predicted motion${showGhost ? ', with the true trajectory shown as a dashed reference' : ''}.` : `The "${labelFor(hypothesis)}" belief is not yet visualized in this scene: ${resolution.reason}`;

  return (
    <div className={'physics-stage ' + (compact ? 'compact' : '')}>
      <div className="physics-stage-canvas" style={{ height: compact ? 160 : 260, background: palette.cream }} aria-hidden="true">
        {resolution.kind === 'motion' ? (
          <Canvas camera={{ position: [1.6, 1.1, 1.8], fov: 40 }}>
            <ambientLight intensity={0.7} />
            <directionalLight position={[2, 3, 2]} intensity={0.6} />
            <Ground color={palette.muted} />
            {showGhost && <GhostPath scenario={scenario} color={palette.lavender} />}
            <Ball resolution={resolution} t={t} color={hypothesis === 'SOUND' ? palette.green : palette.yellow} />
            <OrbitControls enablePan={false} enableZoom={false} minPolarAngle={0.5} maxPolarAngle={1.3} />
          </Canvas>
        ) : (
          <div className="physics-stage-unsupported" style={{ color: palette.muted }}>
            Not visualized yet for this belief.
          </div>
        )}
      </div>

      {resolution.kind === 'motion' && (
        <div className="physics-stage-controls">
          <button type="button" className="icon-button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button type="button" className="icon-button" onClick={restart} aria-label="Restart">
            <RotateCcw size={15} />
          </button>
          <input type="range" min={0} max={1} step={0.01} value={t} onChange={(e) => scrub(Number(e.target.value))} aria-label="Scrub through the flight" style={{ flex: 1 }} />
        </div>
      )}

      {/* Visible + informational text: the animation alone must never be the only place this
          information lives (accessibility gap called out in review). */}
      <p className="physics-stage-label">{label}</p>
    </div>
  );
}
