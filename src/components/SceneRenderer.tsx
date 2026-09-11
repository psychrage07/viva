'use client';
// Generic scene renderer: reads a data-only SceneFrame (bodies + optional arrows) produced by
// src/lib/physics-viz/scenes.ts and turns it into three.js meshes. This is deliberately the ONLY
// place (besides PhysicsStage.tsx) that imports three.js / @react-three/*, so scenes.ts can stay a
// pure, unit-testable data module. Adding scenario #7 later is a change to scenes.ts, not to this
// file — this component doesn't know or care what a "toss" or "circular" scene means, it just
// draws bodies, arrows, a ground plane, and a background driven by `frame.mood`.
import { useMemo } from 'react';
import { Line, Sky, Sparkles, Stars, Trail } from '@react-three/drei';
import type { Role, SceneFrame } from '@/lib/physics-viz/scenes';

export interface ScenePalette {
  primary: string;
  secondary: string;
  ghost: string;
  ground: string;
  groundIndoor: string;
}

const BODY_RADIUS = 0.14;

function colorFor(role: Role, palette: ScenePalette): string {
  if (role === 'primary') return palette.primary;
  if (role === 'ghost') return palette.ghost;
  return palette.secondary;
}

/** Compresses a mesh vertically around its own base (not its center) so a "squash" reads as
 * contact with the ground rather than the whole sphere shrinking in place. */
function SquashGroup({ scaleY, children }: { scaleY: number; children: React.ReactNode }) {
  return <group scale={[1, scaleY, 1]}>{children}</group>;
}

function Body({ id, role, x, y, scaleY, palette, withTrail }: { id: string; role: Role; x: number; y: number; scaleY?: number; palette: ScenePalette; withTrail: boolean }) {
  const color = colorFor(role, palette);
  const mesh = (
    <mesh castShadow receiveShadow={false}>
      <sphereGeometry args={[BODY_RADIUS, 24, 24]} />
      <meshStandardMaterial color={color} roughness={0.45} metalness={0.05} />
    </mesh>
  );
  const positioned = (
    <group position={[x, y, 0]} key={id}>
      <SquashGroup scaleY={scaleY ?? 1}>{mesh}</SquashGroup>
    </group>
  );
  if (withTrail && role === 'primary') {
    return (
      <Trail width={2.5} length={6} color={color} attenuation={(t) => t * t}>
        {positioned}
      </Trail>
    );
  }
  return positioned;
}

function Arrow({ role, x, y, dx, dy, palette }: { role: Role; x: number; y: number; dx: number; dy: number; palette: ScenePalette }) {
  const color = colorFor(role, palette);
  const angle = Math.atan2(dy, dx);
  const tipX = x + dx;
  const tipY = y + dy;
  const points = useMemo<[number, number, number][]>(() => [[x, y, 0], [tipX, tipY, 0]], [x, y, tipX, tipY]);
  return (
    <group>
      <Line points={points} color={color} lineWidth={2} />
      <mesh position={[tipX, tipY, 0]} rotation={[0, 0, angle - Math.PI / 2]}>
        <coneGeometry args={[0.035, 0.09, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}

function Ground({ groundY, color }: { groundY: number; color: string }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, groundY, 0]} receiveShadow>
      <planeGeometry args={[6, 6]} />
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
  );
}

function LaunchSparkles({ x, y, t, color }: { x: number; y: number; t: number; color: string }) {
  const active = t <= 0.08 || t >= 0.92;
  if (!active) return null;
  return (
    <group position={[x, y, 0]}>
      <Sparkles count={12} scale={0.4} size={3} speed={0.3} color={color} />
    </group>
  );
}

function Background({ mood, palette }: { mood: SceneFrame['mood']; palette: ScenePalette }) {
  if (mood === 'outdoor') {
    return <Sky distance={450} sunPosition={[1, 0.4, 0.2]} />;
  }
  if (mood === 'space') {
    return (
      <>
        <color attach="background" args={[palette.ground]} />
        <Stars radius={50} depth={20} count={800} factor={2} fade />
      </>
    );
  }
  return (
    <>
      <color attach="background" args={[palette.groundIndoor]} />
      <hemisphereLight args={[palette.groundIndoor, palette.ground, 0.4]} />
    </>
  );
}

export interface SceneRendererProps {
  frame: SceneFrame;
  palette: ScenePalette;
  trail?: boolean;
  /** current normalized timeline position, only needed to gate the launch/landing sparkles */
  t?: number;
  /** render everything at reduced opacity-equivalent (dimmer material) for a ghost overlay pass */
  dim?: boolean;
}

export default function SceneRenderer({ frame, palette, trail = false, t = 0, dim = false }: SceneRendererProps) {
  const groundColor = frame.mood === 'indoor' ? palette.groundIndoor : palette.ground;
  const effectivePalette = dim
    ? { ...palette, primary: palette.ghost, secondary: palette.ghost }
    : palette;
  const primaryBody = frame.bodies.find((b) => b.role === 'primary');

  return (
    <>
      <Background mood={frame.mood} palette={palette} />
      <ambientLight intensity={frame.mood === 'space' ? 0.35 : 0.55} />
      <directionalLight
        position={[2.5, 4, 2]}
        intensity={frame.mood === 'space' ? 0.5 : 0.9}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={0.5}
        shadow-camera-far={10}
        shadow-camera-left={-2}
        shadow-camera-right={2}
        shadow-camera-top={2}
        shadow-camera-bottom={-2}
      />
      <Ground groundY={frame.groundY} color={groundColor} />
      {frame.bodies.map((b) => (
        <Body key={b.id} id={b.id} role={b.role} x={b.x} y={b.y} scaleY={b.scaleY} palette={effectivePalette} withTrail={trail && !dim} />
      ))}
      {(frame.arrows ?? []).map((a) => (
        <Arrow key={a.id} role={a.role} x={a.x} y={a.y} dx={a.dx} dy={a.dy} palette={effectivePalette} />
      ))}
      {trail && !dim && primaryBody && (
        <LaunchSparkles x={primaryBody.x} y={primaryBody.y} t={t} color={effectivePalette.primary} />
      )}
    </>
  );
}
