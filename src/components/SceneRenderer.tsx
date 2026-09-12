'use client';
// Generic scene renderer: reads the data-only SceneFrame contract from src/lib/physics-viz/scenes.ts
// and turns it into three.js meshes. This is deliberately the ONLY place (besides PhysicsStage.tsx)
// that imports three.js / @react-three/*, so scenes.ts stays a pure, unit-testable data module.
//
// v3 (animation pass) — why this file changed shape:
//
// 1. BODIES ARE POSITIONED IN useFrame, NOT IN REACT. v2 fed `frame={frameFor(h)(t)}` from a
//    requestAnimationFrame loop in PhysicsStage, which re-rendered the whole React tree ~60x/s to
//    move one sphere. Now the stage owns a mutable clock and this component advances the meshes
//    imperatively, so a frame is a handful of matrix writes instead of a reconciliation pass.
//
// 2. THE TRAIL IS HAND-ROLLED. drei's <Trail> was configured `width={2.5} length={6}`, which
//    becomes meshline `lineWidth = 0.1 * 2.5 = 0.25` world units against a ball 0.28 across — a
//    ribbon nearly twice the ball's own width. MeshLine's `setPoints(points, wcb)` callback only
//    scales *width*, so the ribbon had no alpha fade at all: a solid wedge that narrowed to a
//    point. It also never reset, so a scrub or restart drew a straight streak from the old
//    position to the new one, and it stayed frozen on screen after playback ended. The replacement
//    below is a camera-facing ribbon with a real alpha ramp, a soft outer halo standing in for
//    bloom, speed saturation so it retracts to nothing when the body stops, and a teleport guard
//    for scrubbing.
//
// 3. CONTACT IS AUTHORED, NOT GUESSED. Body size comes from BODY_RADIUS in scenes.ts, so a
//    grounded body sits on the surface instead of one radius inside it, and squash is anchored at
//    the contact point (v2's SquashGroup claimed to compress "around its own base" while scaling a
//    group whose origin was the body's centre, so the ball shrank in mid-air).
//
// 4. BURSTS COME FROM `frame.events`, which carry a normalized time. They are therefore a pure
//    function of `t` and survive scrubbing backwards — a frame-counted particle system does not.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { ContactShadows, Line, Sky, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { BODY_RADIUS, type FrameFn, type Role, type SceneArrow, type SceneBody, type SceneEvent, type SceneFrame } from '@/lib/physics-viz/scenes';

export interface ScenePalette {
  primary: string;
  secondary: string;
  ghost: string;
  ground: string;
  groundIndoor: string;
}

/** Shared playback clock. Mutable on purpose: the animation reads it inside useFrame so moving a
 * body never costs a React render. Owned by PhysicsStage. */
export interface PlaybackClock {
  t: number;
  playing: boolean;
  /** ms spent holding at the end of the timeline before looping */
  hold: number;
}
export type ClockRef = { current: PlaybackClock };

// --- motion tuning ---------------------------------------------------------
/** Scene units per unit t at which motion effects saturate. `impetus` peaks near 32 (its
 * (4t(1-t))^0.6 arc has a cusp at launch, so the derivative is unbounded) while `rolling-friction`
 * peaks near 0.75. A rational saturating curve keeps both readable instead of turning the fast one
 * into a 30x needle. */
const SPEED_REF = 2.6;
const saturate = (speed: number) => (speed <= 0 ? 0 : speed / (speed + SPEED_REF));
/** Longest stretch a body may reach along its direction of travel. Volume is kept laterally. */
const MAX_STRETCH = 1.5;
/** Deepest contact compression, as a fraction of the body's height. */
const MAX_SQUASH = 0.34;
/** Seconds for a body to ease in when its scene mounts. */
const APPEAR_SECONDS = 0.42;

// --- trail tuning ----------------------------------------------------------
const TRAIL_SAMPLES = 60;
const TRAIL_LIFE = 0.5;
/** Don't add a sample until the body has moved this far — keeps the ribbon smooth at slow speeds
 * instead of stacking coincident points into a blob. */
const TRAIL_MIN_STEP = 0.011;
/** A jump bigger than this means the timeline moved, not the body: drop the history rather than
 * draw a straight line across the scene. */
const TRAIL_TELEPORT = 0.28;
const TRAIL_CORE_WIDTH = 0.048;
const TRAIL_HALO_WIDTH = 0.19;

// --- arrow tuning ----------------------------------------------------------
const ARROW_HEAD = 0.085;
const ARROW_RADIUS = 0.017;

/** Burst length in normalized t: 0.11 of a 2.4s scene is ~260ms, long enough to read. */
const BURST_DURATION = 0.11;

const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
const smoothstep01 = (x: number) => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};

function colorFor(role: Role, palette: ScenePalette): string {
  if (role === 'primary') return palette.primary;
  if (role === 'ghost') return palette.ghost;
  return palette.secondary;
}

/** Scenes are allowed to add or drop arrows partway through the timeline (`circular` drops the
 * tether the moment it breaks), so the set of things to build is the union over the timeline, not
 * whatever happens to exist at one sample. Static properties are identical for a given id. */
function unionOver<T extends { id: string }>(frameFn: FrameFn, pick: (f: SceneFrame) => T[] | undefined, samples = 9): T[] {
  const byId = new Map<string, T>();
  for (let i = 0; i <= samples; i++) {
    for (const item of pick(frameFn(i / samples)) ?? []) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// Motion trail
// ---------------------------------------------------------------------------

export interface MotionTrailHandle {
  /** Feed one frame of motion. `intensity` is 0..1 and gates the whole ribbon. */
  sample(x: number, y: number, intensity: number, dt: number): void;
  clear(): void;
}

const TRAIL_VERT = /* glsl */ `
  attribute float aSide;
  attribute float aAlpha;
  attribute float aWidth;
  uniform float uWidth;
  varying float vAlpha;
  varying float vSide;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Expand perpendicular to the view direction, in view space: the ribbon always faces the
    // camera, so it reads as a streak of light rather than a sheet of paper seen edge-on.
    mv.x += aSide * uWidth * aWidth;
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha;
    vSide = aSide;
  }
`;

const TRAIL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uSoft;
  varying float vAlpha;
  varying float vSide;
  void main() {
    // uSoft=1 feathers the ribbon across its own width (the halo); uSoft=0 keeps a crisp core.
    float edge = mix(1.0, pow(max(0.0, 1.0 - abs(vSide)), 1.7), uSoft);
    float a = vAlpha * uOpacity * edge;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

const MotionTrail = forwardRef<MotionTrailHandle, { color: string; additive?: boolean }>(function MotionTrail({ color, additive = false }, ref) {
  const positions = useRef(new Float32Array(TRAIL_SAMPLES * 3));
  const intensities = useRef(new Float32Array(TRAIL_SAMPLES));
  const ages = useRef(new Float32Array(TRAIL_SAMPLES));
  const count = useRef(0);
  const last = useRef({ x: NaN, y: NaN });

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_SAMPLES * 2 * 3), 3));
    g.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(TRAIL_SAMPLES * 2), 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(TRAIL_SAMPLES * 2), 1));
    g.setAttribute('aWidth', new THREE.BufferAttribute(new Float32Array(TRAIL_SAMPLES * 2), 1));
    const index = new Uint16Array((TRAIL_SAMPLES - 1) * 6);
    for (let i = 0; i < TRAIL_SAMPLES - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      index.set([a, c, b, b, c, d], i * 6);
    }
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.setDrawRange(0, 0);
    return g;
  }, []);

  const coreMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: TRAIL_VERT,
        fragmentShader: TRAIL_FRAG,
        uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0.8 }, uSoft: { value: 0 }, uWidth: { value: TRAIL_CORE_WIDTH } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    [color, additive],
  );
  const haloMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: TRAIL_VERT,
        fragmentShader: TRAIL_FRAG,
        uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0.22 }, uSoft: { value: 1 }, uWidth: { value: TRAIL_HALO_WIDTH } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    [color, additive],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      coreMaterial.dispose();
      haloMaterial.dispose();
    },
    [geometry, coreMaterial, haloMaterial],
  );

  useImperativeHandle(
    ref,
    () => ({
      clear() {
        count.current = 0;
        last.current = { x: NaN, y: NaN };
        geometry.setDrawRange(0, 0);
      },
      sample(x, y, intensity, dt) {
        // Snapshot the previous sample BEFORE overwriting it: the distance test below is what
        // decides whether this frame contributes a point at all.
        const prevX = last.current.x;
        const prevY = last.current.y;
        const fresh = !Number.isFinite(prevX) || !Number.isFinite(prevY);
        const step = fresh ? Infinity : Math.hypot(x - prevX, y - prevY);
        const jumped = fresh || step > TRAIL_TELEPORT;
        last.current = { x, y };

        if (jumped) {
          count.current = 0;
        } else {
          for (let i = 0; i < count.current; i++) ages.current[i] += dt;
        }

        // Age out the tail, so a body that has come to rest loses its streak instead of parking a
        // frozen wedge where it stopped.
        let live = 0;
        for (let i = 0; i < count.current; i++) {
          if (ages.current[i] > TRAIL_LIFE) continue;
          if (live !== i) {
            positions.current.copyWithin(live * 3, i * 3, i * 3 + 3);
            intensities.current[live] = intensities.current[i];
            ages.current[live] = ages.current[i];
          }
          live++;
        }
        count.current = live;

        if (!jumped && step >= TRAIL_MIN_STEP && intensity > 0.02) {
          if (count.current >= TRAIL_SAMPLES) count.current = TRAIL_SAMPLES - 1;
          // Shift the history down and insert the newest sample at the head.
          positions.current.copyWithin(3, 0, count.current * 3);
          intensities.current.copyWithin(1, 0, count.current);
          ages.current.copyWithin(1, 0, count.current);
          positions.current[0] = x;
          positions.current[1] = y;
          positions.current[2] = 0;
          intensities.current[0] = intensity;
          ages.current[0] = 0;
          count.current += 1;
        }

        const n = count.current;
        const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
        const side = geometry.getAttribute('aSide') as THREE.BufferAttribute;
        const alpha = geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
        const width = geometry.getAttribute('aWidth') as THREE.BufferAttribute;
        for (let i = 0; i < n; i++) {
          const u = n <= 1 ? 0 : i / (n - 1); // 0 at the head, 1 at the oldest surviving sample
          const life = Math.max(0, 1 - ages.current[i] / TRAIL_LIFE);
          const a = intensities.current[i] * life * life;
          // Taper the tail to a point; a blunt end reads as a ribbon cut with scissors.
          const taper = Math.pow(1 - u, 1.4);
          const o = i * 2;
          const px = positions.current[i * 3], py = positions.current[i * 3 + 1], pz = positions.current[i * 3 + 2];
          pos.setXYZ(o, px, py, pz);
          pos.setXYZ(o + 1, px, py, pz);
          side.setX(o, -1);
          side.setX(o + 1, 1);
          alpha.setX(o, a);
          alpha.setX(o + 1, a);
          width.setX(o, taper);
          width.setX(o + 1, taper);
        }
        pos.needsUpdate = true;
        side.needsUpdate = true;
        alpha.needsUpdate = true;
        width.needsUpdate = true;
        geometry.setDrawRange(0, Math.max(0, (n - 1) * 6));
      },
    }),
    [geometry],
  );

  return (
    <group name="motion-trail">
      <mesh geometry={geometry} material={haloMaterial} frustumCulled={false} renderOrder={4} />
      <mesh geometry={geometry} material={coreMaterial} frustumCulled={false} renderOrder={5} />
    </group>
  );
});

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

const GROUND_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GROUND_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uEdge;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0; // 0 at the centre, 1 at the rim
    // v2 drew a hard-edged 6x6 plane floating in the scene. This fades the disc into the
    // background, and the faint rings give the eye a sense of scale without becoming a grid.
    float disc = smoothstep(1.0, 0.26, r);
    float rings = 0.5 + 0.5 * sin(r * 30.0);
    float detail = mix(1.0, 0.95 + rings * 0.05, smoothstep(0.85, 0.05, r));
    float a = disc * uOpacity * detail;
    if (a < 0.003) discard;
    gl_FragColor = vec4(mix(uColor, uEdge, smoothstep(0.1, 0.95, r)), a);
    #include <colorspace_fragment>
  }
`;

function SoftGround({ groundY, color, edge, opacity }: { groundY: number; color: string; edge: string; opacity: number }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: GROUND_VERT,
        fragmentShader: GROUND_FRAG,
        uniforms: { uColor: { value: new THREE.Color(color) }, uEdge: { value: new THREE.Color(edge) }, uOpacity: { value: opacity } },
        transparent: true,
        depthWrite: false,
      }),
    [color, edge, opacity],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, groundY, 0]} material={material} renderOrder={-2}>
      <circleGeometry args={[3.4, 72]} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

interface BodyRig {
  body: SceneBody;
  color: string;
  /** half-height used for base-anchored squash */
  halfHeight: number;
}

function BodyMesh({ body, color, ghost }: { body: SceneBody; color: string; ghost: boolean }) {
  const size = body.size ?? { w: BODY_RADIUS * 2, h: BODY_RADIUS * 2, d: BODY_RADIUS * 2 };
  if (ghost) {
    // The true-motion reference is deliberately see-through: it shares the stage with the believed
    // motion, and two solid balls on near-identical arcs are impossible to tell apart.
    return (
      <>
        <mesh>
          <sphereGeometry args={[BODY_RADIUS, 24, 24]} />
          <meshStandardMaterial color={color} transparent opacity={0.14} roughness={0.9} depthWrite={false} />
        </mesh>
        <mesh>
          <sphereGeometry args={[BODY_RADIUS * 1.004, 16, 10]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.45} depthWrite={false} />
        </mesh>
      </>
    );
  }
  if (body.shape === 'box') {
    return (
      <mesh castShadow>
        <boxGeometry args={[size.w, size.h, size.d]} />
        <meshPhysicalMaterial color={color} roughness={0.42} metalness={0.02} clearcoat={0.35} clearcoatRoughness={0.5} />
      </mesh>
    );
  }
  if (body.shape === 'cylinder') {
    return (
      // A wheel reads as a wheel on its side, with its roll axis facing the camera.
      <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[BODY_RADIUS, BODY_RADIUS, size.d * 0.55, 28]} />
        <meshPhysicalMaterial color={color} roughness={0.36} metalness={0.05} clearcoat={0.4} clearcoatRoughness={0.4} />
      </mesh>
    );
  }
  return (
    <mesh castShadow>
      <sphereGeometry args={[BODY_RADIUS, 32, 32]} />
      <meshPhysicalMaterial color={color} roughness={0.26} metalness={0.04} clearcoat={0.7} clearcoatRoughness={0.2} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Arrows
// ---------------------------------------------------------------------------

function ArrowMesh({ color, kind }: { color: string; kind: 'vector' | 'tether' | 'missing' }) {
  return (
    <group>
      <mesh name="shaft" position={[0.5, 0, 0]}>
        <boxGeometry args={[1, ARROW_RADIUS * (kind === 'tether' ? 0.7 : 1), ARROW_RADIUS]} />
        <meshStandardMaterial color={color} transparent roughness={0.5} depthWrite={false} />
      </mesh>
      {kind !== 'tether' && (
        <mesh name="head" position={[1, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[ARROW_HEAD * 0.42, ARROW_HEAD, 14]} />
          {kind === 'missing' ? (
            // Hollow head: the force this belief claims is NOT there.
            <meshBasicMaterial color={color} wireframe transparent depthWrite={false} />
          ) : (
            <meshStandardMaterial color={color} transparent roughness={0.45} />
          )}
        </mesh>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Event bursts
// ---------------------------------------------------------------------------

function BurstMesh({ color }: { color: string }) {
  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <mesh name="ring">
        <ringGeometry args={[0.84, 1, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh name="flash">
        <circleGeometry args={[1, 40]} />
        <meshBasicMaterial color={color} transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

/** Per-body handles plus the materials whose opacity this component drives, with the opacity each
 * was authored at — a ghost body is built translucent, so blindly writing `opacity = 1` would make
 * the reference pass solid again. */
interface BodyHandles {
  root: THREE.Group;
  stretch: THREE.Group;
  squash: THREE.Group;
  spin: THREE.Group;
  materials: { material: THREE.Material & { opacity: number }; base: number }[];
}

export interface SceneRendererProps {
  /** Curve this scene animates along. Sampled every frame rather than handed a single frame. */
  frameFn: FrameFn;
  palette: ScenePalette;
  clock: ClockRef;
  /** Dimmer true-kinematics pass drawn alongside the believed motion. */
  ghost?: boolean;
  /** Draw the motion trail; only meaningful for the believed pass. */
  trail?: boolean;
  /** Sampled world path drawn under the motion so the whole arc is visible at once. */
  trajectory?: [number, number, number][];
  /** Soft grounding shadow; off for free-space scenes and for the ghost pass. */
  contactShadow?: boolean;
}

export default function SceneRenderer({ frameFn, palette, clock, ghost = false, trail = false, trajectory, contactShadow = true }: SceneRendererProps) {
  // The palette the believed pass and the ghost pass each draw with.
  const effective = useMemo(
    () => (ghost ? { ...palette, primary: palette.ghost, secondary: palette.ghost } : palette),
    [ghost, palette],
  );

  // Timeline-invariant parts of the contract, resolved once per scene.
  const contract = useMemo(() => {
    const probe = frameFn(0.5);
    return {
      bodies: probe.bodies,
      arrows: unionOver<SceneArrow>(frameFn, (f) => f.arrows),
      events: unionOver<SceneEvent>(frameFn, (f) => f.events),
      groundY: probe.groundY,
      hasGround: probe.ground !== false,
      mood: probe.mood,
      // A scene where a body passes through the surface on purpose needs that surface see-through,
      // otherwise the body disappears behind an opaque floor and the moment reads as a glitch.
      translucentGround: probe.bodies.some((b) => b.throughSurface),
    };
  }, [frameFn]);

  const rigs = useMemo<BodyRig[]>(
    () =>
      contract.bodies.map((body) => ({
        body,
        color: colorFor(body.role, effective),
        halfHeight: body.shape === 'box' ? (body.size?.h ?? BODY_RADIUS * 2) / 2 : BODY_RADIUS,
      })),
    [contract, effective],
  );
  const primary = rigs.find((r) => r.body.role === 'primary') ?? rigs[0];
  const additive = !ghost && contract.mood === 'space';

  const trailRef = useRef<MotionTrailHandle>(null);
  const bodies = useRef(new Map<string, BodyHandles>());
  const arrows = useRef(new Map<string, { group: THREE.Group; shaft: THREE.Object3D | null; head: THREE.Object3D | null; materials: (THREE.Material & { opacity: number })[] }>());
  const bursts = useRef(new Map<string, { group: THREE.Group; ring: THREE.MeshBasicMaterial | null; flash: THREE.MeshBasicMaterial | null }>());
  const lastT = useRef(clock.current.t);
  const appear = useRef(0);

  useEffect(() => {
    // A new scene is a new timeline; nothing from the previous one may linger.
    trailRef.current?.clear();
    lastT.current = clock.current.t;
    appear.current = 0;
  }, [frameFn, clock]);

  useFrame((_, delta) => {
    const dt = Math.min(0.05, delta);
    const t = clock.current.t;
    const scrubbed = t < lastT.current - 1e-4;
    lastT.current = t;
    appear.current = Math.min(1, appear.current + dt / APPEAR_SECONDS);
    const intro = easeOutCubic(appear.current);

    const frame = frameFn(t);

    for (const rig of rigs) {
      const h = bodies.current.get(rig.body.id);
      const b = frame.bodies.find((x) => x.id === rig.body.id);
      if (!h || !b) continue;

      h.root.position.set(b.x, b.y, 0);
      h.root.visible = intro > 0.01;

      const speed = Math.hypot(b.vx ?? 0, b.vy ?? 0);
      const vx = b.vx ?? 0;
      const vy = b.vy ?? 0;
      if (speed > 0.05) {
        // Elongate along the direction of travel: a fast body should look fast, not just blurred.
        const s = 1 + (MAX_STRETCH - 1) * saturate(speed);
        h.stretch.rotation.z = Math.atan2(vy, vx) - Math.PI / 2;
        h.stretch.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
      } else {
        h.stretch.rotation.z = 0;
        h.stretch.scale.set(1, 1, 1);
      }

      // Base-anchored squash: the contact point stays planted while the body compresses, and it
      // bulges sideways to keep its volume. Scaling about the centre just made the ball shrink.
      const k = 1 - MAX_SQUASH * Math.min(1, b.squash ?? 0);
      h.squash.scale.set(1 / k, k, 1 / Math.sqrt(k));
      h.squash.position.y = rig.halfHeight * (k - 1);

      if (b.spin !== undefined) h.spin.rotation.z = b.spin;

      const opacity = (b.opacity ?? 1) * intro;
      for (const m of h.materials) m.material.opacity = m.base * opacity;
    }

    for (const a of contract.arrows) {
      const h = arrows.current.get(a.id);
      if (!h) continue;
      const live = (frame.arrows ?? []).find((x) => x.id === a.id);
      if (!live) {
        // Dropped from the timeline (the tether snapping) — hide rather than freeze in place.
        h.group.visible = false;
        continue;
      }
      const len = Math.hypot(live.dx, live.dy);
      const opacity = (live.opacity ?? 1) * intro;
      h.group.visible = opacity > 0.02 && len > 0.001;
      h.group.position.set(live.x, live.y, 0);
      h.group.rotation.z = Math.atan2(live.dy, live.dx);
      const kind = live.kind ?? 'vector';
      if (h.shaft) {
        // Scale only the shaft's length so the head keeps its proportions.
        const usable = Math.max(0.001, len - (kind === 'tether' ? 0 : ARROW_HEAD));
        h.shaft.scale.set(usable, 1, 1);
        h.shaft.position.x = usable / 2;
      }
      if (h.head) h.head.position.x = len;
      for (const m of h.materials) m.opacity = opacity;
    }

    for (const ev of contract.events) {
      const h = bursts.current.get(ev.id);
      if (!h) continue;
      const strength = ev.strength ?? 1;
      if (t < ev.at || appear.current < 0.2) {
        h.group.visible = false;
        continue;
      }
      // Progress derives from t, so scrubbing backwards replays the burst instead of leaving a
      // spent ring on the floor.
      const p = Math.min(1, (t - ev.at) / BURST_DURATION);
      const fade = (1 - p) ** 1.6;
      h.group.visible = fade > 0.01;
      h.group.position.set(ev.x, ev.y + 0.004, 0);
      const reach = ev.kind === 'launch' ? 0.42 : 0.95;
      const scale = (0.16 + reach * easeOutCubic(p)) * (0.6 + strength * 0.6);
      if (h.ring) h.ring.opacity = fade * 0.5 * strength;
      if (h.flash) h.flash.opacity = Math.max(0, 1 - p * 2.2) * 0.26 * strength;
      h.group.scale.setScalar(scale);
    }

    if (trail && primary) {
      const b = frame.bodies.find((x) => x.id === primary.body.id);
      if (b) {
        const speed = Math.hypot(b.vx ?? 0, b.vy ?? 0);
        // Squared, so the streak only really shows up where the motion is worth following.
        const intensity = saturate(speed) ** 1.4 * intro;
        if (scrubbed) trailRef.current?.clear();
        trailRef.current?.sample(b.x, b.y, intensity, dt);
      }
    }
  });

  // Ref callbacks are cached per id in a memo, not a ref: they are read while rendering, and a
  // fresh closure every render would make React detach and re-attach each ref, re-reading the
  // authored material opacity from a body mid-fade and locking the faded value in as the new
  // "authored" one.
  type GroupCallback = (g: THREE.Group | null) => void;
  const bodyCallbacks = useMemo(() => new Map<string, GroupCallback>(), []);
  const arrowCallbacks = useMemo(() => new Map<string, GroupCallback>(), []);
  const burstCallbacks = useMemo(() => new Map<string, GroupCallback>(), []);
  const cached = (map: Map<string, GroupCallback>, id: string, make: (id: string) => GroupCallback) => {
    let cb = map.get(id);
    if (!cb) {
      cb = make(id);
      map.set(id, cb);
    }
    return cb;
  };

  const makeBodyCollector = (id: string) => (root: THREE.Group | null) => {
    if (!root) {
      bodies.current.delete(id);
      return;
    }
    const materials: { material: THREE.Material & { opacity: number }; base: number }[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.material) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if ('opacity' in m) materials.push({ material: m as THREE.Material & { opacity: number }, base: (m as THREE.Material & { opacity: number }).opacity });
      }
    });
    bodies.current.set(id, {
      root,
      stretch: (root.getObjectByName('stretch') as THREE.Group) ?? root,
      squash: (root.getObjectByName('squash') as THREE.Group) ?? root,
      spin: (root.getObjectByName('spin') as THREE.Group) ?? root,
      materials,
    });
  };

  const makeArrowCollector = (id: string) => (group: THREE.Group | null) => {
    if (!group) {
      arrows.current.delete(id);
      return;
    }
    const materials: (THREE.Material & { opacity: number })[] = [];
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.material) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if ('opacity' in m) materials.push(m as THREE.Material & { opacity: number });
      }
    });
    arrows.current.set(id, {
      group,
      shaft: group.getObjectByName('shaft') ?? null,
      head: group.getObjectByName('head') ?? null,
      materials,
    });
  };

  const makeBurstCollector = (id: string) => (group: THREE.Group | null) => {
    if (!group) {
      bursts.current.delete(id);
      return;
    }
    const mat = (name: string) => {
      const mesh = group.getObjectByName(name) as THREE.Mesh | undefined;
      return (mesh?.material as THREE.MeshBasicMaterial | undefined) ?? null;
    };
    bursts.current.set(id, { group, ring: mat('ring'), flash: mat('flash') });
  };

  return (
    <>
      {!ghost && (
        <>
          <Background mood={contract.mood} palette={palette} />
          <ambientLight intensity={contract.mood === 'space' ? 0.5 : 0.62} />
          <directionalLight position={[2.5, 4, 2]} intensity={contract.mood === 'space' ? 0.55 : 1.05} />
          {/* Cool fill from the opposite side, so the shadowed half of a body keeps its shape. */}
          <directionalLight position={[-3, 1.4, -1.5]} intensity={0.3} color="#cfe0ea" />
          {/* Rim light in the scene's own accent: this is what separates a body from its backdrop. */}
          <directionalLight position={[-1.2, 2.2, -3]} intensity={0.75} color={palette.primary} />
        </>
      )}

      {/* Only the believed pass draws the floor: both passes share one staging (the ghost is
          authored with the same groundY), so a second translucent disc would just double up and
          muddy the ground the comparison is meant to be read against. */}
      {contract.hasGround && !ghost && (
        <SoftGround
          groundY={contract.groundY}
          color={contract.mood === 'indoor' ? palette.groundIndoor : palette.ground}
          edge={palette.ground}
          opacity={contract.translucentGround ? 0.3 : contract.mood === 'space' ? 0.45 : 0.85}
        />
      )}

      {contract.hasGround && contactShadow && !ghost && (
        <ContactShadows
          position={[0, contract.groundY + 0.002, 0]}
          scale={4.4}
          resolution={256}
          blur={2.6}
          far={2.4}
          opacity={contract.translucentGround ? 0.18 : 0.4}
          color={palette.ground}
          frames={Infinity}
        />
      )}

      {trajectory && trajectory.length > 1 && (
        <Line
          points={trajectory}
          color={ghost ? palette.ghost : palette.primary}
          lineWidth={ghost ? 1 : 1.4}
          dashed
          dashSize={0.055}
          gapSize={0.045}
          transparent
          opacity={ghost ? 0.34 : 0.22}
        />
      )}

      {rigs.map((rig) => (
        <group key={rig.body.id} name={rig.body.id} ref={cached(bodyCallbacks, rig.body.id, makeBodyCollector)}>
          <group name="stretch">
            <group name="squash">
              <group name="spin">
                <BodyMesh body={rig.body} color={rig.color} ghost={ghost} />
              </group>
            </group>
          </group>
        </group>
      ))}

      {trail && primary && <MotionTrail ref={trailRef} color={primary.color} additive={additive} />}

      {contract.arrows.map((a) => (
        <group key={a.id} ref={cached(arrowCallbacks, a.id, makeArrowCollector)}>
          <ArrowMesh color={colorFor(a.role, effective)} kind={a.kind ?? 'vector'} />
        </group>
      ))}

      {!ghost &&
        contract.events.map((ev) => (
          <group key={ev.id} ref={cached(burstCallbacks, ev.id, makeBurstCollector)}>
            <BurstMesh color={ev.kind === 'breach' ? palette.secondary : palette.primary} />
          </group>
        ))}
    </>
  );
}

function Background({ mood, palette }: { mood: SceneFrame['mood']; palette: ScenePalette }) {
  if (mood === 'outdoor') {
    return <Sky distance={450} sunPosition={[1, 0.4, 0.2]} turbidity={6} rayleigh={0.55} />;
  }
  if (mood === 'space') {
    return (
      <>
        <color attach="background" args={[palette.ground]} />
        <Stars radius={50} depth={20} count={900} factor={2.4} fade speed={0.4} />
      </>
    );
  }
  return (
    <>
      <color attach="background" args={[palette.groundIndoor]} />
      <hemisphereLight args={[palette.groundIndoor, palette.ground, 0.5]} />
    </>
  );
}
