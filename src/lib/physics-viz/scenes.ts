// Pure scene-generation module. Zero React / three.js / DOM imports (same purity rule as before):
// every scene is expressed as data (a SceneFrame of bodies + optional arrows), and
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
// Design contract, unchanged: a SceneFrame is defined on normalized t in [0,1]. Where a scene has
// a single ball on a vertical flight (toss), y(0)=0 and y(1)=0 still hold for every hypothesis so
// beliefs stay comparable on one timeline. Other scenes (two bodies, a break event, a settle) use
// t=0..1 as "the whole demonstration," not literally a projectile's flight — documented per scene.
// All curves remain caricatures chosen to match each misconception's predicted probe answer, not
// derivations from a real differential equation — consistent with the app's stated design.

import { newtonian as pack } from '../packs';

export type Scenario = 'toss' | 'drop' | 'pairs' | 'circular' | 'surface' | 'friction';

export type Role = 'primary' | 'secondary' | 'ghost';

export interface SceneBody {
  id: string;
  role: Role;
  x: number;
  y: number;
  /** 0..1, used for a landing/impact squash effect; omit or 1 for no squash */
  scaleY?: number;
}
export interface SceneArrow {
  id: string;
  role: Role;
  x: number;
  y: number;
  dx: number;
  dy: number;
}
export interface SceneFrame {
  bodies: SceneBody[];
  arrows?: SceneArrow[];
  /** y-coordinate of the ground/surface line, in the same units as body y */
  groundY: number;
  /** loose visual mood, used by SceneRenderer to pick a background */
  mood: 'outdoor' | 'indoor' | 'space';
}
export type FrameFn = (t: number) => SceneFrame;

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

// ---------------------------------------------------------------------------
// TOSS — vertical throw, ignoring air resistance
// Covers: SOUND, used-up, sustaining, direction, velocity-force, impetus (6 of 13)
// ---------------------------------------------------------------------------

const H = 1;

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

const TOSS_IDS = Object.keys(tossHeight);
function tossFrame(id: string): FrameFn {
  const f = tossHeight[id];
  return (t) => {
    const tt = clamp01(t);
    const y = f(tt);
    // simple landing squash: compress vertically for the last ~6% of the flight
    const nearGround = tt > 0.94 || tt < 0.06;
    return {
      groundY: 0,
      mood: 'outdoor',
      bodies: [{ id: 'ball', role: id === 'SOUND' ? 'primary' : 'secondary', x: 0, y: y * 1.6, scaleY: nearGround ? 0.75 : 1 }],
    };
  };
}

// ---------------------------------------------------------------------------
// DROP — two balls released from rest (fall / gravity / inertia family)
// Covers: SOUND, mass-fall, no-motion, air-gravity (4 of 13; SOUND shared with toss)
// ---------------------------------------------------------------------------

const dropTrueFall = (t: number) => H * (1 - t * t);

const dropHeavy: Record<string, (t: number) => number> = {
  SOUND: dropTrueFall,
  // 'mass-fall': heavier accelerates faster — lands distinctly before t=1.
  'mass-fall': (t) => {
    const land = 0.72;
    if (t >= land) return 0;
    const s = t / land;
    return H * (1 - s * s);
  },
  // 'no-motion' / 'air-gravity': the object simply never falls (no continuing force to start it /
  // no air for gravity to act) — a flat, deliberately inert line for the whole window.
  'no-motion': () => H,
  'air-gravity': () => H,
};

function dropFrame(id: string): FrameFn {
  const heavyFn = dropHeavy[id];
  return (t) => {
    const tt = clamp01(t);
    const lightY = dropTrueFall(tt) * 1.6; // light ball always falls correctly — it's the control
    const heavyY = heavyFn(tt) * 1.6;
    return {
      groundY: 0,
      mood: 'space', // staged as the vacuum/airless drop matching probes p13/p20/p23
      bodies: [
        { id: 'light', role: 'ghost', x: -0.45, y: lightY },
        { id: 'heavy', role: id === 'SOUND' ? 'primary' : 'secondary', x: 0.45, y: heavyY },
      ],
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

function pairsFrame(id: string): FrameFn {
  // 'unequal-pairs' believes the heavier cart exerts the larger force on the lighter one — caricatured
  // here as an EXAGGERATED split (5:1 instead of the true 3:1): the "stronger" heavy cart barely
  // moves, and the "victim" light cart is flung disproportionately far. This is an illustrative
  // amplification of the belief's flavor, not a rigorous derivation — the belief is actually about
  // which force claim is true, not a distinct kinematic prediction, so some artistic license is
  // taken to make the misconception visibly legible, as this module's design already accepts.
  const ratio = id === 'unequal-pairs' ? 5 : PAIRS_MASS_RATIO;
  return (t) => {
    const tt = clamp01(t);
    const ease = tt < 0.5 ? 0 : (tt - 0.5) / 0.5; // spring holds until t=0.5, then release-and-glide
    const spread = ease * 0.9;
    return {
      groundY: -0.3,
      mood: 'indoor',
      bodies: [
        { id: 'light', role: id === 'SOUND' ? 'primary' : 'secondary', x: -spread * ratio * 0.22, y: 0 },
        { id: 'heavy', role: id === 'SOUND' ? 'primary' : 'secondary', x: spread * 0.22, y: 0 },
      ],
    };
  };
}

// ---------------------------------------------------------------------------
// CIRCULAR — a tethered object let go mid-circle
// Covers: SOUND, centrifugal (2 of 13)
// t=0..0.5 circles; the tether "breaks" at t=0.5; t=0.5..1 shows what happens after.
// ---------------------------------------------------------------------------

function circularFrame(id: string): FrameFn {
  return (t) => {
    const tt = clamp01(t);
    const R = 0.6;
    let x: number, y: number;
    if (tt <= 0.5) {
      const angle = (tt / 0.5) * Math.PI * 1.5; // three-quarter turn before release
      x = R * Math.cos(angle);
      y = R * Math.sin(angle);
    } else {
      const angleAtRelease = Math.PI * 1.5;
      const px = R * Math.cos(angleAtRelease), py = R * Math.sin(angleAtRelease);
      const s = (tt - 0.5) / 0.5;
      if (id === 'centrifugal') {
        // believed: a real outward force keeps flinging it straight out from the center
        const rx = px / R, ry = py / R; // outward unit vector
        x = px + rx * s * 0.9;
        y = py + ry * s * 0.9;
      } else {
        // true: moves off tangentially in a straight line at the velocity it had at release
        const tx = -Math.sin(angleAtRelease), ty = Math.cos(angleAtRelease); // tangent unit vector
        x = px + tx * s * 0.9;
        y = py + ty * s * 0.9;
      }
    }
    return {
      groundY: -1,
      mood: 'space',
      bodies: [{ id: 'capsule', role: id === 'SOUND' ? 'primary' : 'secondary', x, y }],
    };
  };
}

// ---------------------------------------------------------------------------
// SURFACE — a book resting on a shelf
// Covers: SOUND, animate-normal (2 of 13)
// ---------------------------------------------------------------------------

function surfaceFrame(id: string): FrameFn {
  return (t) => {
    const tt = clamp01(t);
    const y = id === 'animate-normal' ? 0.4 - tt * 0.75 : 0.4; // sinks through an "unsupportive" surface
    return {
      groundY: 0,
      mood: 'indoor',
      bodies: [{ id: 'book', role: id === 'SOUND' ? 'primary' : 'secondary', x: 0, y }],
      arrows: id === 'SOUND' ? [{ id: 'support', role: 'primary', x: 0, y: 0, dx: 0, dy: 0.3 }] : [],
    };
  };
}

// ---------------------------------------------------------------------------
// FRICTION — a driven wheel accelerating forward without slipping
// Covers: SOUND, rolling-friction (2 of 13)
// ---------------------------------------------------------------------------

function frictionFrame(id: string): FrameFn {
  return (t) => {
    const tt = clamp01(t);
    const x = id === 'rolling-friction' ? -0.5 + Math.sin(tt * Math.PI * 8) * 0.03 : -0.5 + tt * 1.0; // spins in place vs. net forward progress
    return {
      groundY: -0.2,
      mood: 'outdoor',
      bodies: [{ id: 'wheel', role: id === 'SOUND' ? 'primary' : 'secondary', x, y: -0.2 }],
      arrows: [{ id: 'friction', role: id === 'SOUND' ? 'primary' : 'secondary', x, y: -0.2, dx: id === 'rolling-friction' ? -0.25 : 0.25, dy: 0 }],
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

// Dev-time coverage assertion: every hypothesis in the pack must have an entry in SCENARIO_FOR.
// Unlike v1, there is no "unsupported" escape hatch anymore — a missing entry here is a bug, not
// an accepted scope cut, because the fallback (`?? 'toss'` with hypothesisId not in TOSS_IDS,
// which then renders 'SOUND' physics) would silently show a misconception as correct — exactly
// the failure mode this assertion exists to catch.
if (process.env.NODE_ENV !== 'production') {
  const allIds = ['SOUND', ...pack.misconceptions.map((m) => m.id)];
  for (const id of allIds) {
    console.assert(id in SCENARIO_FOR, `[physics-viz] hypothesis "${id}" has no scenario mapping in SCENARIO_FOR. Every hypothesis must map to a real scenario now — there is no unsupported fallback in v2.`);
  }
}
