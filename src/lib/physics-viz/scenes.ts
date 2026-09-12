// Pure scene-generation module. Zero React / three.js / DOM imports (same purity rule as before):
// every scene is expressed as data (a SceneFrame of bodies + optional arrows/events), and
// SceneRenderer.tsx is the only thing that turns that data into meshes. This module can be
// unit-tested standalone.
//
// v2: expands from 2 scenarios (toss, drop) covering 9 of 13 hypotheses to 6 scenarios covering
// all 13. The previous version left impetus, unequal-pairs, centrifugal, animate-normal, and
// rolling-friction as an explicit "unsupported" placeholder — reasonable as a v1 scope cut, but
// those five are NOT rare: impetus and sustaining are each the predicted wrong answer on 10 of
// the 28 probes, centrifugal on 4, animate-normal on 7, rolling-friction on 3, unequal-pairs on
// 4. A user will hit "not visualized" constantly. This version has a curve for every one.
//
// v3 (animation pass): the data contract grew the three things the renderer needs in order to
// animate instead of teleport bodies:
//   1. BODY_RADIUS lives HERE, not in the renderer. Every scene now places a body at
//      `groundY + halfHeight`, so a resting body touches the surface instead of sinking halfway
//      into it. Previously the renderer knew the radius (0.14) and this module did not, so every
//      grounded scene buried its body by exactly one radius, `rolling-friction` was buried for its
//      whole timeline, `animate-normal` ended 0.49 below the plane, and `centrifugal` ended 0.64
//      below it. The dev-time sweep at the bottom of this file asserts the invariant.
//   2. Bodies carry `vx`/`vy` derived from their own position curve, so motion stretch, trail
//      direction, and trail intensity can never disagree with the path that was drawn.
//   3. Moments worth marking (throw, landing, breaking through a surface) are authored as `events`
//      with a normalized time, so bursts are a pure function of `t` — they survive scrubbing
//      backwards, which a frame-counter particle system does not.
// Scenes also expose `scenarioBounds`, which is how the stage keeps every hypothesis of a scenario
// on ONE camera framing: the arcs stay comparable instead of each one auto-zooming to fit itself.
//
// Design contract, unchanged: a SceneFrame is defined on normalized t in [0,1]. Where a scene has
// a single ball on a vertical flight (toss), y(0)=rest and y(1)=rest still hold for every
// hypothesis so beliefs stay comparable on one timeline. Other scenes (two bodies, a break event,
// a settle) use t=0..1 as "the whole demonstration," not literally a projectile's flight —
// documented per scene. All curves remain caricatures chosen to match each misconception's
// predicted probe answer, not derivations from a real differential equation.

import { newtonian as pack } from '../packs';

export type Scenario = 'toss' | 'drop' | 'pairs' | 'circular' | 'surface' | 'friction';

export type Role = 'primary' | 'secondary' | 'ghost';

/** How bodies are drawn. A book that reads as a book makes the `surface` scene self-explanatory. */
export type BodyShape = 'sphere' | 'box' | 'cylinder';

/** Sphere radius / default body half-height, in scene units. THE single source of truth: the
 * renderer sizes its meshes from this and the scenes offset their contact points by it. */
export const BODY_RADIUS = 0.14;

export interface SceneBody {
  id: string;
  role: Role;
  x: number;
  /** center y, in the same units as x. Grounded bodies must satisfy y >= groundY + halfHeight. */
  y: number;
  shape?: BodyShape;
  /** full width/height/depth for box bodies, or diameter/height for cylinders; spheres use BODY_RADIUS */
  size?: { w: number; h: number; d: number };
  /** 0..1 contact compression. The renderer anchors the squash at the contact point, so this
   * reads as the body flattening against the surface rather than shrinking in mid-air. */
  squash?: number;
  /** 0..1 opacity; used to fade a body that has left the believable part of the scene */
  opacity?: number;
  /** Set when passing through the surface IS the point of the frame (the `animate-normal` book,
   * which the belief says the shelf cannot hold up). The renderer draws these with a transparent
   * surface and a fade; the contact-invariant sweep below skips them, so an accidental burial in
   * any other scene still fails loudly. */
  throughSurface?: boolean;
  /** roll angle in radians about the z axis (wheels) */
  spin?: number;
  /** velocity in scene units per unit t, derived from this body's own curve. Drives motion
   * stretch and trail intensity. */
  vx?: number;
  vy?: number;
}
export interface SceneArrow {
  id: string;
  role: Role;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** 'vector' (a force/velocity arrow, default), 'tether' (a constraint link), or 'missing'
   * (the force that this belief claims is NOT there — drawn dashed and hollow) */
  kind?: 'vector' | 'tether' | 'missing';
  /** 0..1 fade envelope, authored per frame so arrows ease in and out instead of popping */
  opacity?: number;
}
/** A moment in the timeline the renderer should mark with a burst. Being data (with a normalized
 * time) rather than a side effect is what makes bursts scrub-safe. */
export interface SceneEvent {
  id: string;
  kind: 'launch' | 'impact' | 'breach';
  /** normalized time the event happens at */
  at: number;
  x: number;
  y: number;
  /** 0..1 relative strength; scales the burst radius and alpha */
  strength?: number;
}
export interface SceneBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
export interface SceneFrame {
  bodies: SceneBody[];
  arrows?: SceneArrow[];
  events?: SceneEvent[];
  /** y-coordinate of the ground/surface line, in the same units as body y */
  groundY: number;
  /** false for scenes staged in free space, where there is nothing to land on and drawing a floor
   * would only give bodies something to clip through (see `circular`) */
  ground?: boolean;
  /** loose visual mood, used by SceneRenderer to pick a background */
  mood: 'outdoor' | 'indoor' | 'space';
}
export type FrameFn = (t: number) => SceneFrame;

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Center y for a body of the given half-height resting ON the surface. */
export function restY(groundY: number, halfHeight: number = BODY_RADIUS): number {
  return groundY + halfHeight;
}

/** Raised-cosine bump: 1 at `at`, falling smoothly to 0 at +/- width. Used for every contact
 * envelope so squash and bursts ease instead of switching on a frame. */
function bump(t: number, at: number, width: number): number {
  const d = Math.abs(t - at) / width;
  return d >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * d));
}

/** Velocity of a 2D position curve, sampled from the SAME curve the renderer draws so stretch and
 * trail direction can never drift from the path.
 *
 * Backward-difference on purpose. Several scenes hold a beat before the motion starts (the flight
 * window opens at t=0.04) and stop dead on contact, so the curves have corners. A centred stencil
 * straddles those corners and reports speed before the body has moved — which the renderer would
 * draw as a stationary ball stretched along a direction it is not yet travelling. Looking backward
 * costs half a step of lag in the smooth regions, which is invisible, and never anticipates. */
function velocity(pos: (t: number) => [number, number], t: number): [number, number] {
  // Narrow on purpose: a wide stencil reaches back across a contact corner and reports a body that
  // is sitting on the ground as still falling, for about ten milliseconds after every landing.
  // These curves are closed-form, so the smaller step costs no numerical accuracy.
  const h = 0.0005;
  const t0 = clamp01(t - h);
  const span = t - t0;
  if (span <= 0) return [0, 0]; // t=0: nothing to look back at, so nothing is moving yet
  const [x0, y0] = pos(t0);
  const [x1, y1] = pos(t);
  return [(x1 - x0) / span, (y1 - y0) / span];
}

// ---------------------------------------------------------------------------
// TOSS — vertical throw, ignoring air resistance
// Covers: SOUND, used-up, sustaining, direction, velocity-force, impetus (6 of 13)
// ---------------------------------------------------------------------------

const H = 1;
/** Scene units of flight height per unit of the authored curve. Lower than v2's 1.6 because the
 * stage now frames the scene from `scenarioBounds` instead of a fixed camera — the relative arc
 * heights (which carry the pedagogy) are unchanged, they just fit the viewport. */
const TOSS_SCALE = 1.35;
const DROP_SCALE = 1.35;

const tossHeight: Record<string, (t: number) => number> = {
  // True kinematics: a clean parabola, constant downward acceleration throughout.
  SOUND: (t) => 4 * H * t * (1 - t),

  // 'used-up': the internal "push" decays quickly — decelerates harder than gravity alone on the
  // rise (an early, lower apex), then falls under ordinary gravity for the remainder. Two true
  // parabolas glued at the apex so velocity is continuous there.
  'used-up': (t) => {
    const ta = 0.35, ha = H * 0.72;
    if (t <= ta) return ha * (1 - ((ta - t) / ta) ** 2);
    const f = (t - ta) / (1 - ta);
    return ha * (1 - f * f);
  },

  // 'sustaining': believes a continuing upward force is needed while rising, so it decelerates
  // far more slowly than gravity (floats up), reaches a later/higher apex, then drops sharply
  // once that "force" is gone.
  sustaining: (t) => {
    const ta = 0.62, ha = H * 1.35;
    if (t <= ta) return ha * (1 - ((ta - t) / ta) ** 2.6);
    const f = (t - ta) / (1 - ta);
    return ha * (1 - f ** 1.6);
  },

  // 'direction': believes acceleration vanishes whenever velocity is zero — a flat HOVER carved
  // out of the normal rise/fall around the true apex, not a longer total flight.
  direction: (t) => {
    const hs = 0.42, he = 0.58;
    if (t < hs) return H * (1 - (1 - t / hs) ** 2);
    if (t <= he) return H;
    const s = (t - he) / (1 - he);
    return H * (1 - s * s);
  },

  // 'velocity-force': believes force (and acceleration) is proportional to speed, not constant.
  // Produces an exponential-flavoured, rounder approach to the apex instead of a sharp peak.
  'velocity-force': (t) => {
    const k = 5;
    const shape = (s: number) => (1 - Math.exp(-k * s)) / (1 - Math.exp(-k));
    return t <= 0.5 ? H * shape(t / 0.5) : H * shape((1 - t) / 0.5);
  },

  // 'impetus': believes the thrower's force stays lodged in the ball and keeps acting alongside
  // gravity for the WHOLE flight (p07's predicted answer: "stored upward force still acts along
  // with gravity"), i.e. reduced effective downward acceleration throughout. Modeled as a taller,
  // flatter-topped arc (broader peak) rather than sustaining's asymmetric floaty-rise/steep-fall —
  // both "float," but impetus is symmetric while sustaining is lopsided, matching the different
  // wording of the two beliefs.
  impetus: (t) => {
    const ha = H * 1.5, p = 0.6; // p<1 flattens the peak while still returning to 0 at t=0,1
    return ha * (4 * t * (1 - t)) ** p;
  },
};

/** The flight occupies this slice of the timeline, leaving room at both ends for the body to be
 * visibly at rest. Contact has to land INSIDE the timeline: a squash centred on t=1 is a squash
 * that never recovers, and an impact burst at t=1 is cut off by the loop. v2 put landing at
 * t=0.985 while the ball only reached the surface at t=1, so it compressed 0.08 above the ground —
 * the same mid-air squash v2's centre-anchored scaling produced, one axis over. */
const FLIGHT_START = 0.04;
const FLIGHT_END = 0.9;
/** Maps the global timeline onto the flight's own 0..1. */
const flightTime = (t: number) => clamp01((t - FLIGHT_START) / (FLIGHT_END - FLIGHT_START));
/** Global timeline moment at which a given point of the flight happens. */
const flightAt = (s: number) => FLIGHT_START + s * (FLIGHT_END - FLIGHT_START);
/** Squash peaks exactly at contact and relaxes over this fraction of the timeline. v2 flipped a
 * boolean at t>0.94, which snapped the ball between two shapes on a single frame. */
const CONTACT_WIDTH = 0.05;

const TOSS_IDS = Object.keys(tossHeight);
function tossFrame(id: string): FrameFn {
  const f = tossHeight[id];
  // Launch is carried by the velocity-driven stretch, so nothing is authored for it here — a
  // thrown ball elongates, it does not flatten.
  const pos = (t: number): [number, number] => [0, restY(0) + f(flightTime(t)) * TOSS_SCALE];
  const landAt = flightAt(1);
  return (t) => {
    const tt = clamp01(t);
    const [x, y] = pos(tt);
    const [vx, vy] = velocity(pos, tt);
    return {
      groundY: 0,
      mood: 'outdoor',
      bodies: [{
        id: 'ball',
        role: id === 'SOUND' ? 'primary' : 'secondary',
        x,
        y,
        vx,
        vy,
        squash: bump(tt, landAt, CONTACT_WIDTH),
      }],
      events: [
        { id: 'launch', kind: 'launch', at: FLIGHT_START, x: 0, y: restY(0), strength: 0.85 },
        { id: 'land', kind: 'impact', at: landAt, x: 0, y: 0, strength: 1 },
      ],
    };
  };
}

// ---------------------------------------------------------------------------
// DROP — two balls released from rest (fall / gravity / inertia family)
// Covers: SOUND, mass-fall, no-motion, air-gravity (4 of 13; SOUND shared with toss)
// ---------------------------------------------------------------------------

const dropTrueFall = (t: number) => H * (1 - t * t);
/** When the heavy ball lands under 'mass-fall' — the whole point of the scene is that it lands
 * FIRST, so the landing burst is authored at that moment rather than at t=1. */
const MASS_FALL_LAND_AT = 0.72;

const dropHeavy: Record<string, (t: number) => number> = {
  SOUND: dropTrueFall,
  // 'mass-fall': heavier accelerates faster — lands distinctly before t=1.
  'mass-fall': (t) => {
    if (t >= MASS_FALL_LAND_AT) return 0;
    const s = t / MASS_FALL_LAND_AT;
    return H * (1 - s * s);
  },
  // 'no-motion' / 'air-gravity': the object simply never falls (no continuing force to start it /
  // no air for gravity to act) — a flat, deliberately inert line for the whole window.
  'no-motion': () => H,
  'air-gravity': () => H,
};

const DROP_X = 0.45;
function dropFrame(id: string): FrameFn {
  const heavyFn = dropHeavy[id];
  // The light ball always falls correctly — it's the control.
  const posLight = (t: number): [number, number] => [-DROP_X, restY(0) + dropTrueFall(flightTime(t)) * DROP_SCALE];
  const posHeavy = (t: number): [number, number] => [DROP_X, restY(0) + heavyFn(flightTime(t)) * DROP_SCALE];
  const landsEarly = id === 'mass-fall';
  const lightLandAt = flightAt(1);
  const heavyLandAt = flightAt(landsEarly ? MASS_FALL_LAND_AT : 1);
  // Typed explicitly: a conditional spread inside an array literal widens `kind` to `string`,
  // which no longer satisfies the SceneEvent union.
  const events: SceneEvent[] = [{ id: 'light-land', kind: 'impact', at: lightLandAt, x: -DROP_X, y: 0, strength: 0.8 }];
  // 'no-motion' / 'air-gravity' never land, so there is nothing to mark — the absence of a burst is
  // itself the point of those two beliefs.
  if (id !== 'no-motion' && id !== 'air-gravity') {
    events.push({ id: 'heavy-land', kind: 'impact', at: heavyLandAt, x: DROP_X, y: 0, strength: 1 });
  }
  return (t) => {
    const tt = clamp01(t);
    const [lx, ly] = posLight(tt);
    const [hx, hy] = posHeavy(tt);
    const [lvx, lvy] = velocity(posLight, tt);
    const [hvx, hvy] = velocity(posHeavy, tt);
    return {
      groundY: 0,
      mood: 'space', // staged as the vacuum/airless drop matching probes p13/p20/p23
      bodies: [
        { id: 'light', role: 'ghost', x: lx, y: ly, vx: lvx, vy: lvy, squash: bump(tt, lightLandAt, CONTACT_WIDTH) * 0.8 },
        {
          id: 'heavy',
          role: id === 'SOUND' ? 'primary' : 'secondary',
          x: hx,
          y: hy,
          vx: hvx,
          vy: hvy,
          squash: bump(tt, heavyLandAt, CONTACT_WIDTH) * 0.8,
        },
      ],
      events,
    };
  };
}

// ---------------------------------------------------------------------------
// PAIRS — two carts pushed apart by a released spring (Newton's third law)
// Covers: SOUND, unequal-pairs (2 of 13)
// t=0..1 is the whole push-apart-and-glide demonstration, not a projectile flight.
// ---------------------------------------------------------------------------

// True physics: equal & opposite impulses regardless of mass, so a 1:3 mass ratio cart pair
// separates in an exact 3:1 distance ratio (lighter cart travels 3x as far in the same time).
const PAIRS_MASS_RATIO = 3;
const PAIRS_GROUND_Y = -0.3;
const CART = { w: 0.24, h: 0.15, d: 0.17 };
/** Window during which the spring is pushing, i.e. the only time the interaction pair exists. */
const PAIRS_PUSH: [number, number] = [0.5, 0.66];

function pairsFrame(id: string): FrameFn {
  // 'unequal-pairs' believes the heavier cart exerts the larger force on the lighter one — caricatured
  // here as an EXAGGERATED split (5:1 instead of the true 3:1): the "stronger" heavy cart barely
  // moves, and the "victim" light cart is flung disproportionately far. This is an illustrative
  // amplification of the belief's flavor, not a rigorous derivation — the belief is actually about
  // which force claim is true, not a distinct kinematic prediction, so some artistic license is
  // taken to make the misconception visibly legible, as this module's design already accepts.
  const ratio = id === 'unequal-pairs' ? 5 : PAIRS_MASS_RATIO;
  // Each cart rests on the surface at its OWN half-height: the heavy cart is taller, so a shared
  // rest y would sink it into the floor by exactly the height difference.
  const lightCart = CART;
  const heavyCart = { w: CART.w * 1.7, h: CART.h * 1.25, d: CART.d };
  const lightY = restY(PAIRS_GROUND_Y, lightCart.h / 2);
  const heavyY = restY(PAIRS_GROUND_Y, heavyCart.h / 2);
  // Arrow lengths for the action/reaction pair. Third law says equal; the misconception says not.
  const lightArrow = id === 'unequal-pairs' ? 0.18 : 0.26;
  const heavyArrow = id === 'unequal-pairs' ? 0.34 : 0.26;
  // One source of truth for the cart positions, so the finite-difference velocity is taken from
  // exactly the curve that gets drawn.
  const spreadAt = (s: number) => (s < PAIRS_PUSH[0] ? 0 : ((s - PAIRS_PUSH[0]) / (1 - PAIRS_PUSH[0])) * 0.9);
  const posLight = (s: number): [number, number] => [-spreadAt(s) * ratio * 0.22, lightY];
  const posHeavy = (s: number): [number, number] => [spreadAt(s) * 0.22, heavyY];
  return (t) => {
    const tt = clamp01(t);
    const [lx, ly] = posLight(tt);
    const [hx, hy] = posHeavy(tt);
    const [lvx, lvy] = velocity(posLight, tt);
    const [hvx, hvy] = velocity(posHeavy, tt);
    // Fade the force pair in and out with the push window so it never appears mid-glide.
    const push = Math.min(bump(tt, (PAIRS_PUSH[0] + PAIRS_PUSH[1]) / 2, (PAIRS_PUSH[1] - PAIRS_PUSH[0]) / 2), 1);
    return {
      groundY: PAIRS_GROUND_Y,
      mood: 'indoor',
      bodies: [
        { id: 'light', role: id === 'SOUND' ? 'primary' : 'secondary', x: lx, y: ly, size: lightCart, shape: 'box', vx: lvx, vy: lvy },
        { id: 'heavy', role: id === 'SOUND' ? 'primary' : 'secondary', x: hx, y: hy, size: heavyCart, shape: 'box', vx: hvx, vy: hvy },
      ],
      arrows: [
        { id: 'on-light', role: id === 'SOUND' ? 'primary' : 'secondary', x: lx - lightCart.w * 0.5, y: ly, dx: -lightArrow, dy: 0, opacity: push },
        { id: 'on-heavy', role: id === 'SOUND' ? 'primary' : 'secondary', x: hx + heavyCart.w * 0.5, y: hy, dx: heavyArrow, dy: 0, opacity: push },
      ],
    };
  };
}

// ---------------------------------------------------------------------------
// CIRCULAR — a tethered object let go mid-circle
// Covers: SOUND, centrifugal (2 of 13)
// t=0..0.5 circles; the tether "breaks" at t=0.5; t=0.5..1 shows what happens after.
// Staged in free space with `ground: false`: v2 drew a floor at y=-1 that the released capsule
// flew straight through (ending 0.64 below the plane), which read as a rendering bug.
// ---------------------------------------------------------------------------

const CIRCULAR_R = 0.6;
const CIRCULAR_RELEASE_AT = 0.5;
const CIRCULAR_REACH = 0.9;

function circularFrame(id: string): FrameFn {
  const pos = (t: number): [number, number] => {
    if (t <= CIRCULAR_RELEASE_AT) {
      const angle = (t / CIRCULAR_RELEASE_AT) * Math.PI * 1.5; // three-quarter turn before release
      return [CIRCULAR_R * Math.cos(angle), CIRCULAR_R * Math.sin(angle)];
    }
    const angleAtRelease = Math.PI * 1.5;
    const px = CIRCULAR_R * Math.cos(angleAtRelease);
    const py = CIRCULAR_R * Math.sin(angleAtRelease);
    const s = (t - CIRCULAR_RELEASE_AT) / (1 - CIRCULAR_RELEASE_AT);
    if (id === 'centrifugal') {
      // believed: a real outward force keeps flinging it straight out from the center
      return [px + (px / CIRCULAR_R) * s * CIRCULAR_REACH, py + (py / CIRCULAR_R) * s * CIRCULAR_REACH];
    }
    // true: moves off tangentially in a straight line at the velocity it had at release
    return [px + -Math.sin(angleAtRelease) * s * CIRCULAR_REACH, py + Math.cos(angleAtRelease) * s * CIRCULAR_REACH];
  };
  return (t) => {
    const tt = clamp01(t);
    const [x, y] = pos(tt);
    const [vx, vy] = velocity(pos, tt);
    const tethered = tt <= CIRCULAR_RELEASE_AT;
    return {
      groundY: -1,
      ground: false,
      mood: 'space',
      bodies: [{ id: 'capsule', role: id === 'SOUND' ? 'primary' : 'secondary', x, y, vx, vy }],
      arrows: tethered
        ? [
            // the tether is the inward force; while it holds, that is the only thing bending the path
            { id: 'tether', role: 'ghost', x: 0, y: 0, dx: x, dy: y, kind: 'tether', opacity: 0.9 },
            { id: 'inward', role: id === 'SOUND' ? 'primary' : 'secondary', x, y, dx: -x * 0.42, dy: -y * 0.42, opacity: 1 },
          ]
        : id === 'centrifugal'
          ? [{ id: 'outward', role: 'secondary', x, y, dx: (x / Math.hypot(x, y)) * 0.34, dy: (y / Math.hypot(x, y)) * 0.34, opacity: 1 }]
          : [],
      events: [{ id: 'release', kind: 'breach', at: CIRCULAR_RELEASE_AT, x: CIRCULAR_R * Math.cos(Math.PI * 1.5), y: CIRCULAR_R * Math.sin(Math.PI * 1.5), strength: 0.8 }],
    };
  };
}

// ---------------------------------------------------------------------------
// SURFACE — a book resting on a shelf
// Covers: SOUND, animate-normal (2 of 13)
// ---------------------------------------------------------------------------

const BOOK = { w: 0.34, h: 0.11, d: 0.24 };
/** How far the book sinks on the 'animate-normal' belief. Deliberately shallow: it has to read as
 * "the shelf did not hold it," not as geometry falling out of the world. v2 sank it 0.49 below
 * the plane, which is 4.5 book half-heights and simply looked broken. */
const BOOK_SINK = 0.26;
/** The book drops in and settles, so even the correct belief has something to watch. */
const BOOK_SETTLE_AT = 0.16;

function surfaceFrame(id: string): FrameFn {
  const settle = restY(0, BOOK.h / 2);
  const pos = (t: number): [number, number] => {
    if (id !== 'animate-normal') {
      // small damped drop-and-settle onto the shelf
      const s = t / BOOK_SETTLE_AT;
      return [0, s >= 1 ? settle : settle + (1 - s) ** 2 * 0.12];
    }
    if (t < BOOK_SETTLE_AT) return [0, settle + (1 - t / BOOK_SETTLE_AT) ** 2 * 0.12];
    const s = (t - BOOK_SETTLE_AT) / (1 - BOOK_SETTLE_AT);
    return [0, settle - BOOK_SINK * (s * s * (3 - 2 * s))]; // smoothstep sink, no linear crawl
  };
  return (t) => {
    const tt = clamp01(t);
    const [x, y] = pos(tt);
    const [vx, vy] = velocity(pos, tt);
    const sinking = id === 'animate-normal';
    // once it is through the shelf it is leaving the believable scene; fade rather than clip
    const through = sinking ? Math.min(1, Math.max(0, (settle - y) / BOOK_SINK)) : 0;
    return {
      groundY: 0,
      mood: 'indoor',
      bodies: [{
        id: 'book',
        role: id === 'SOUND' ? 'primary' : 'secondary',
        x,
        y,
        vx,
        vy,
        shape: 'box',
        size: BOOK,
        squash: bump(tt, BOOK_SETTLE_AT, 0.09) * 0.35,
        opacity: sinking ? 1 - through * 0.55 : 1,
        throughSurface: sinking,
      }],
      arrows: id === 'SOUND'
        ? [{ id: 'support', role: 'primary', x: 0, y: 0, dx: 0, dy: 0.34, opacity: bump(tt, BOOK_SETTLE_AT, 0.1) * 0.35 + 0.65 }]
        : [
            // the normal force this belief says cannot exist — drawn hollow so its absence is the
            // visible claim, not a missing decoration
            { id: 'no-support', role: 'ghost', x: 0, y: 0, dx: 0, dy: 0.34, kind: 'missing', opacity: 0.45 + through * 0.4 },
          ],
      events: sinking ? [{ id: 'breach', kind: 'breach', at: BOOK_SETTLE_AT + 0.06, x: 0, y: 0, strength: 0.7 }] : [],
    };
  };
}

// ---------------------------------------------------------------------------
// FRICTION — a driven wheel accelerating forward without slipping
// Covers: SOUND, rolling-friction (2 of 13)
// ---------------------------------------------------------------------------

const FRICTION_GROUND_Y = -0.2;
const WHEEL_START = -0.5;
const WHEEL_TRAVEL = 1.0;

function frictionFrame(id: string): FrameFn {
  const y = restY(FRICTION_GROUND_Y);
  const pos = (t: number): [number, number] =>
    id === 'rolling-friction'
      ? [WHEEL_START + Math.sin(t * Math.PI * 8) * 0.03, y] // spins in place, no net progress
      : [WHEEL_START + t * WHEEL_TRAVEL, y];
  return (t) => {
    const tt = clamp01(t);
    const [x, wheelY] = pos(tt);
    const [vx, vy] = velocity(pos, tt);
    // rolling without slipping ties spin to travel; spinning in place is the misconception's tell
    const spin = id === 'rolling-friction' ? tt * Math.PI * 14 : (x - WHEEL_START) / BODY_RADIUS;
    return {
      groundY: FRICTION_GROUND_Y,
      mood: 'outdoor',
      bodies: [{ id: 'wheel', role: id === 'SOUND' ? 'primary' : 'secondary', x, y: wheelY, shape: 'cylinder', vx, vy, spin }],
      arrows: [{ id: 'friction', role: id === 'SOUND' ? 'primary' : 'secondary', x, y: wheelY, dx: id === 'rolling-friction' ? -0.25 : 0.25, dy: 0 }],
    };
  };
}

// ---------------------------------------------------------------------------
// Resolution — total over all 13 hypotheses, no unsupported case remains
// ---------------------------------------------------------------------------

const SCENARIO_FOR: Record<string, Scenario> = {
  SOUND: 'toss', // marquee default when nothing distinguishing has been observed yet
  'used-up': 'toss',
  sustaining: 'toss',
  direction: 'toss',
  'velocity-force': 'toss',
  impetus: 'toss',
  'mass-fall': 'drop',
  'no-motion': 'drop',
  'air-gravity': 'drop',
  'unequal-pairs': 'pairs',
  centrifugal: 'circular',
  'animate-normal': 'surface',
  'rolling-friction': 'friction',
};

export function scenarioFor(hypothesisId: string): Scenario {
  return SCENARIO_FOR[hypothesisId] ?? 'toss';
}

export function frameFor(hypothesisId: string): FrameFn {
  const scenario = scenarioFor(hypothesisId);
  switch (scenario) {
    case 'toss': return tossFrame(TOSS_IDS.includes(hypothesisId) ? hypothesisId : 'SOUND');
    case 'drop': return dropFrame(hypothesisId in dropHeavy ? hypothesisId : 'SOUND');
    case 'pairs': return pairsFrame(hypothesisId);
    case 'circular': return circularFrame(hypothesisId);
    case 'surface': return surfaceFrame(hypothesisId);
    case 'friction': return frictionFrame(hypothesisId);
  }
}

/** True-kinematics reference for the ghost overlay, in the same scenario as the given hypothesis. */
export function trueFrameFor(hypothesisId: string): FrameFn {
  const scenario = scenarioFor(hypothesisId);
  switch (scenario) {
    case 'toss': return tossFrame('SOUND');
    case 'drop': return dropFrame('SOUND');
    case 'pairs': return pairsFrame('SOUND');
    case 'circular': return circularFrame('SOUND');
    case 'surface': return surfaceFrame('SOUND');
    case 'friction': return frictionFrame('SOUND');
  }
}

/** Every hypothesis that renders under this scenario, including the sound-understanding reference. */
export function hypothesesForScenario(scenario: Scenario): string[] {
  return ['SOUND', ...pack.misconceptions.map((m) => m.id)].filter((id) => scenarioFor(id) === scenario);
}

/** Tight bounds of one scene over the whole timeline, including the radius of what is drawn, so
 * the stage frames the artwork rather than the centre points. */
export function boundsFor(frameFn: FrameFn, samples: number = 36): SceneBounds {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i <= samples; i++) {
    const frame = frameFn(i / samples);
    for (const b of frame.bodies) {
      const halfH = b.shape === 'box' ? (b.size?.h ?? BODY_RADIUS * 2) / 2 : BODY_RADIUS;
      const halfW = b.shape === 'box' ? (b.size?.w ?? BODY_RADIUS * 2) / 2 : BODY_RADIUS;
      minX = Math.min(minX, b.x - halfW);
      maxX = Math.max(maxX, b.x + halfW);
      minY = Math.min(minY, b.y - halfH);
      maxY = Math.max(maxY, b.y + halfH);
    }
    for (const a of frame.arrows ?? []) {
      minX = Math.min(minX, a.x, a.x + a.dx);
      maxX = Math.max(maxX, a.x, a.x + a.dx);
      minY = Math.min(minY, a.y, a.y + a.dy);
      maxY = Math.max(maxY, a.y, a.y + a.dy);
    }
  }
  return { minX, maxX, minY, maxY };
}

const scenarioBoundsCache = new Map<Scenario, SceneBounds>();

/** Framing bounds shared by EVERY hypothesis of a scenario. One camera per scenario is the point:
 * if each hypothesis auto-fit itself, 'sustaining' would zoom out and 'used-up' zoom in, and the
 * thing the scene exists to show — that one arc floats higher than the other — would disappear. */
export function scenarioBounds(scenario: Scenario): SceneBounds {
  const cached = scenarioBoundsCache.get(scenario);
  if (cached) return cached;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const id of hypothesesForScenario(scenario)) {
    const b = boundsFor(frameFor(id));
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY);
    maxY = Math.max(maxY, b.maxY);
  }
  const bounds = { minX, maxX, minY, maxY };
  scenarioBoundsCache.set(scenario, bounds);
  return bounds;
}

/** Sampled world path of one body, for the soft trajectory line the stage draws under the motion. */
export function trajectoryFor(frameFn: FrameFn, bodyId: string, samples: number = 48): [number, number, number][] {
  const points: [number, number, number][] = [];
  for (let i = 0; i <= samples; i++) {
    const body = frameFn(i / samples).bodies.find((b) => b.id === bodyId);
    if (body) points.push([body.x, body.y, 0]);
  }
  return points;
}

/** One human-readable line per scenario, shown above the controls so a user understands what
 * they're looking at now that there are 6 scenes instead of 1. */
const SCENARIO_LABEL: Record<Scenario, string> = {
  toss: 'Scene: a ball tossed straight up, ignoring air resistance',
  drop: 'Scene: two balls released from rest in an airless tube',
  pairs: 'Scene: two carts pushed apart by a released spring',
  circular: 'Scene: a tethered object released mid-circle',
  surface: 'Scene: a book resting on a shelf',
  friction: 'Scene: a driven wheel accelerating without slipping',
};

export function sceneLabelFor(hypothesisId: string): string {
  return SCENARIO_LABEL[scenarioFor(hypothesisId)];
}

export const ALL_HYPOTHESES: string[] = ['SOUND', ...pack.misconceptions.map((m) => m.id)];

// Dev-time coverage assertion: every hypothesis in the pack must have an entry in SCENARIO_FOR.
// Unlike v1, there is no "unsupported" escape hatch anymore — a missing entry here is a bug, not
// an accepted scope cut, because the fallback (`?? 'toss'` with hypothesisId not in TOSS_IDS,
// which then renders 'SOUND' physics) would silently show a misconception as correct — exactly
// the failure mode this assertion exists to catch.
//
// The second sweep asserts the contact invariant the renderer depends on: no body is ever below
// its surface. It catches a new scene that forgets `restY()` before anyone sees a ball half-buried
// in the floor.
if (process.env.NODE_ENV !== 'production') {
  for (const id of ALL_HYPOTHESES) {
    console.assert(id in SCENARIO_FOR, `[physics-viz] hypothesis "${id}" has no scenario mapping in SCENARIO_FOR. Every hypothesis must map to a real scenario now — there is no unsupported fallback in v2.`);
    const fn = frameFor(id);
    for (let i = 0; i <= 100; i++) {
      const frame = fn(i / 100);
      if (frame.ground === false) continue;
      for (const b of frame.bodies) {
        if (b.throughSurface) continue; // the animate-normal book passes through on purpose
        const halfH = b.shape === 'box' ? (b.size?.h ?? BODY_RADIUS * 2) / 2 : BODY_RADIUS;
        console.assert(
          b.y + halfH >= frame.groundY - 1e-9,
          `[physics-viz] "${id}" body "${b.id}" is ${(frame.groundY - (b.y + halfH)).toFixed(3)} below the surface at t=${(i / 100).toFixed(2)}. Scenes must place grounded bodies with restY().`,
        );
      }
    }
  }
}
