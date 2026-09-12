'use client';
// The stage that animates one hypothesis's predicted motion.
//
// v3 (animation pass). Three structural changes, all in service of the motion being smooth and
// staying inside the frame:
//
// 1. PLAYBACK LIVES IN A MUTABLE CLOCK, READ INSIDE THE CANVAS. v2 ran a requestAnimationFrame
//    loop here that called `setT` every frame, re-rendering this component, SceneRenderer, and
//    every mesh in the tree ~60 times a second just to move a ball. The clock is now a ref; the
//    meshes advance in useFrame (see SceneRenderer), and the scrubber is an uncontrolled input
//    written to directly, so a frame costs DOM writes instead of a reconciliation pass.
//
// 2. THE CAMERA FITS THE SCENE, PER SCENARIO. v2 parked the camera at a fixed [1.8, 1.3, 2.1]
//    with fov 42, whose visible world-Y half-extent at the origin is ~1.30 — while the toss arcs
//    peak at 1.60 (SOUND), 2.16 (sustaining) and 2.40 (impetus). Eight of thirteen hypotheses flew
//    clean out of the top of the frame at their apex. Bounds now come from `scenarioBounds`, which
//    is the union over EVERY hypothesis of the scenario: one camera per scenario, so 'sustaining'
//    floating higher than 'used-up' stays visible as a difference instead of both being auto-zoomed
//    to fill the box.
//
// 3. THE TIMELINE LOOPS WITH A HOLD. v2 stopped dead at t=1 and froze; a demonstration that ends
//    on a still frame looks broken next to one that keeps breathing.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Pause, Play, RotateCcw } from 'lucide-react';
import * as THREE from 'three';
import { newtonian as pack } from '@/lib/packs';
import { frameFor, scenarioBounds, scenarioFor, sceneLabelFor, trajectoryFor, trueFrameFor, type SceneBounds } from '@/lib/physics-viz/scenes';
import SceneRenderer, { type PlaybackClock, type ScenePalette } from './SceneRenderer';

/** A little slower than v2's 2200ms: the arcs are easier to read, and the trail has time to draw. */
const DURATION_MS = 2400;
/** Beat at the end of the timeline before it replays, so the loop doesn't snap. */
const HOLD_MS = 700;
export const FOV = 42;
/** Default viewing direction: azimuth ~35deg, polar ~66deg (inside the OrbitControls polar clamp). */
export const DEFAULT_VIEW = new THREE.Vector3(0.53, 0.4085, 0.743).normalize();
export const FIT_MARGIN = 1.2;
/** DEFAULT_VIEW.y is the *sine* of the camera's pitch. A world-Y extent projects onto the camera's
 * up axis scaled by the cosine of that pitch, so the fit needs this complementary term — using
 * DEFAULT_VIEW.y directly sits the camera at 45% of the distance it needs and crops the arc. */
const COS_PITCH = Math.sqrt(1 - DEFAULT_VIEW.y ** 2);
const INTRO_SECONDS = 0.95;
const INTRO_DOLLY = 0.16;

// --- Color: three.Color.setStyle() parses hex/rgb/hsl/named — it never reads the CSS cascade,
// so `var(--x)` is silently wrong in a three.js material prop. Sample the computed style once and
// cache it, with literal fallbacks so a server render never touches getComputedStyle. The fallback
// hex values are copied verbatim from :root in globals.css.
const FALLBACK_PALETTE = {
  green: '#284c3a',
  yellow: '#e7ce65',
  lavender: '#ded5ed',
  cream: '#f9f9f1',
  muted: '#72786d',
  dark: '#253e30',
};
type CssPalette = typeof FALLBACK_PALETTE;

let cssPaletteCache: CssPalette | null = null;
function readCssPalette(): CssPalette {
  if (cssPaletteCache) return cssPaletteCache;
  const s = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  cssPaletteCache = {
    green: read('--green', FALLBACK_PALETTE.green),
    yellow: read('--yellow', FALLBACK_PALETTE.yellow),
    lavender: read('--lavender', FALLBACK_PALETTE.lavender),
    cream: read('--cream', FALLBACK_PALETTE.cream),
    muted: read('--muted', FALLBACK_PALETTE.muted),
    dark: read('--dark', FALLBACK_PALETTE.dark),
  };
  return cssPaletteCache;
}
// useSyncExternalStore needs a stable snapshot reference and a server fallback; the cache above
// gives it both, and it replaces a setState-in-effect (which the react-hooks lint rule rejects).
const subscribeNoop = () => () => {};
function usePalette(): CssPalette {
  return useSyncExternalStore(subscribeNoop, readCssPalette, () => FALLBACK_PALETTE);
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
const readReducedMotion = () => window.matchMedia(REDUCED_MOTION_QUERY).matches;
function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
}

/** Smallest camera distance that frames the bounds at this aspect, clamped so a short scene (the
 * carts barely move vertically) doesn't get a macro lens and a wide one doesn't leave the set. */
export function fitDistance(b: SceneBounds, aspect: number): number {
  const halfH = Math.max(0.22, ((b.maxY - b.minY) / 2) * FIT_MARGIN);
  const halfW = Math.max(0.22, ((b.maxX - b.minX) / 2) * FIT_MARGIN);
  const tanV = Math.tan((FOV / 2) * Math.PI / 180);
  const tanH = tanV * Math.max(0.35, aspect);
  // The orbit keeps its polar angle, so the world-Y extent projects onto the camera's up axis at
  // cos(pitch) — see COS_PITCH.
  const dV = (halfH * COS_PITCH) / tanV;
  const dH = halfW / tanH;
  return Math.min(10, Math.max(1.6, Math.max(dV, dH)));
}

const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;

type ControlsLike = { target: THREE.Vector3; update: () => void };

/** Frames the scene and dollies in once. Runs before OrbitControls reads the camera each frame, so
 * the auto-rotation simply continues from wherever this leaves the radius. */
function CameraRig({ bounds }: { bounds: SceneBounds }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const size = useThree((s) => s.size);
  const aspect = size.width / Math.max(1, size.height);
  const target = useMemo(() => new THREE.Vector3((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0), [bounds]);
  const dist = useMemo(() => fitDistance(bounds, aspect), [bounds, aspect]);
  const intro = useRef(1);
  const fitted = useRef(false);

  useEffect(() => {
    const dir = new THREE.Vector3().subVectors(camera.position, target);
    if (dir.lengthSq() < 1e-6) dir.copy(DEFAULT_VIEW);
    dir.normalize();
    // Dolly in on the first fit only; a later resize should re-frame, not replay the entrance.
    intro.current = fitted.current ? 1 : 0;
    fitted.current = true;
    camera.position.copy(target).addScaledVector(dir, dist * (1 + INTRO_DOLLY * (1 - intro.current)));
    camera.lookAt(target);
    if (controls) {
      controls.target.copy(target);
      controls.update();
    }
  }, [dist, target, camera, controls]);

  useFrame((_, delta) => {
    if (intro.current >= 1) return;
    intro.current = Math.min(1, intro.current + delta / INTRO_SECONDS);
    const dir = new THREE.Vector3().subVectors(camera.position, target);
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();
    camera.position.copy(target).addScaledVector(dir, dist * (1 + INTRO_DOLLY * (1 - easeOutCubic(intro.current))));
    camera.lookAt(target);
  });
  return null;
}

/** Drives the clock from the render loop. It owns no state of its own: the clock belongs to
 * PhysicsStage, which advances it in the callback below, so this is just "call me every frame". */
function Playback({ onFrame }: { onFrame: (delta: number) => void }) {
  useFrame((_, delta) => onFrame(delta));
  return null;
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

/** Id of the body the trail and trajectory follow. */
function primaryBodyId(frameFn: (t: number) => { bodies: { id: string; role: string }[] }): string {
  const bodies = frameFn(0.5).bodies;
  return bodies.find((b) => b.role === 'primary')?.id ?? bodies[0]?.id ?? '';
}

export default function PhysicsStage({ hypothesis, showGhost = false, compact = false }: PhysicsStageProps) {
  const palette = usePalette();
  const reducedMotion = usePrefersReducedMotion();

  // Memoized: a fresh object each render would recompute every memo downstream in the renderer.
  const believedPalette = useMemo<ScenePalette>(
    () => ({
      primary: hypothesis === 'SOUND' ? palette.green : palette.yellow,
      secondary: palette.muted,
      ghost: palette.lavender,
      ground: palette.dark,
      groundIndoor: palette.cream,
    }),
    [hypothesis, palette],
  );
  const truePalette = useMemo<ScenePalette>(
    () => ({ primary: palette.lavender, secondary: palette.lavender, ghost: palette.lavender, ground: palette.dark, groundIndoor: palette.cream }),
    [palette],
  );

  const frameFn = useMemo(() => frameFor(hypothesis), [hypothesis]);
  const trueFrameFn = useMemo(() => trueFrameFor(hypothesis), [hypothesis]);
  const bounds = useMemo(() => scenarioBounds(scenarioFor(hypothesis)), [hypothesis]);
  const believedPath = useMemo(() => trajectoryFor(frameFn, primaryBodyId(frameFn)), [frameFn]);
  const truePath = useMemo(() => trajectoryFor(trueFrameFn, primaryBodyId(trueFrameFn)), [trueFrameFn]);
  const sceneLabel = sceneLabelFor(hypothesis);

  // Autoplay only when motion is allowed; reduced-motion users get a static preview with manual
  // scrub still available. An explicit press of Play is the user asking for motion, which the
  // preference is not meant to veto, so it is honoured either way.
  const clock = useRef<PlaybackClock>({ t: 0, playing: !reducedMotion, hold: 0 });
  const [playing, setPlaying] = useState(!reducedMotion);
  const rangeRef = useRef<HTMLInputElement>(null);

  const onTick = useCallback((t: number) => {
    // Direct DOM write: the scrubber tracks playback without a React render per frame.
    if (rangeRef.current) rangeRef.current.value = String(t);
  }, []);

  /** Frame-rate independent clock advance, clamped so a backgrounded tab returning after ten
   * seconds doesn't teleport the ball to the end of its arc. Loops with a hold at the end rather
   * than freezing on the last frame. */
  const advance = useCallback(
    (delta: number) => {
      const c = clock.current;
      if (!c.playing) return;
      const stepMs = Math.min(64, delta * 1000);
      if (c.t >= 1) {
        c.hold += stepMs;
        if (c.hold < HOLD_MS) return;
        c.hold = 0;
        c.t = 0;
      } else {
        c.t = Math.min(1, c.t + stepMs / DURATION_MS);
      }
      onTick(c.t);
    },
    [onTick],
  );

  function setPlay(next: boolean) {
    clock.current.playing = next;
    clock.current.hold = 0;
    setPlaying(next);
  }
  function togglePlay() {
    if (clock.current.t >= 1) clock.current.t = 0;
    setPlay(!clock.current.playing);
  }
  function restart() {
    clock.current.t = 0;
    clock.current.hold = 0;
    setPlay(!reducedMotion);
  }
  function scrub(e: React.ChangeEvent<HTMLInputElement>) {
    const next = Number(e.target.value);
    // Scrubbing is an explicit takeover: stop autoplay and let the trail reset itself on the jump.
    clock.current.t = next;
    clock.current.hold = 0;
    setPlay(false);
  }

  const label = `Showing: the "${labelFor(hypothesis)}" belief's predicted motion${showGhost ? ', with the true motion shown alongside it' : ''}.`;
  const canvasHeight = compact ? 260 : 420;

  return (
    <div className={'physics-stage ' + (compact ? 'compact' : '')}>
      <p className="physics-stage-scene-label">{sceneLabel}</p>
      <div className="physics-stage-canvas" style={{ height: canvasHeight, width: '100%', background: palette.cream }} aria-hidden="true">
        <Canvas shadows dpr={[1, 1.8]} camera={{ position: DEFAULT_VIEW.clone().multiplyScalar(fitDistance(bounds, 1.5)).toArray(), fov: FOV }}>
          <SceneRenderer frameFn={frameFn} palette={believedPalette} clock={clock} trail trajectory={believedPath} />
          {showGhost && <SceneRenderer frameFn={trueFrameFn} palette={truePalette} clock={clock} ghost trajectory={truePath} contactShadow={false} />}
          <Playback onFrame={advance} />
          <CameraRig bounds={bounds} />
          <OrbitControls
            makeDefault
            autoRotate
            autoRotateSpeed={0.45}
            enablePan={false}
            enableZoom={false}
            enableDamping
            dampingFactor={0.08}
            minPolarAngle={0.45}
            maxPolarAngle={1.4}
          />
        </Canvas>
      </div>

      <div className="physics-stage-controls">
        <button type="button" className="icon-button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button type="button" className="icon-button" onClick={restart} aria-label="Restart">
          <RotateCcw size={15} />
        </button>
        <input
          ref={rangeRef}
          type="range"
          min={0}
          max={1}
          step={0.005}
          defaultValue={0}
          onChange={scrub}
          aria-label="Scrub through the demonstration"
          style={{ flex: 1 }}
        />
      </div>

      {/* Visible + informational text: the animation alone must never be the only place this
          information lives (accessibility gap called out in review). */}
      <p className="physics-stage-label">{label}</p>
    </div>
  );
}
