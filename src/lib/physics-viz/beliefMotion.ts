// Pure physics-caricature module. Deliberately has ZERO React / three.js / DOM imports so it
// can be unit-tested standalone and never risks polluting the engine's dependency purity in the
// other direction (this imports the pack's ids for the coverage assertion; nothing imports this
// FROM src/lib/engine).
//
// Design contract (fix #2 from review): every curve for a given scenario is defined on a
// normalized t in [0,1] and MUST satisfy y(0) = 0 and y(1) = 0. This keeps every belief's
// ghost-vs-believed comparison on the same visual timeline, so a bent SHAPE reads as "this
// belief predicts different motion," not "the animation desynced." Shapes are caricatures chosen
// to match each misconception's PREDICTED ANSWER in newtonian.ts, not derived from a real
// differential equation — consistent with the app's own stated design that Gemini/visuals
// illustrate an authored belief model, not a physics engine.

import { newtonian as pack } from '../packs';

export type Scenario = 'toss' | 'drop';

export interface MotionSample {
  /** height above ground, arbitrary units, 0 = ground/hand height */
  y: number;
  /** signed vertical velocity, same units per unit t — used for ghost-arrow / debug only */
  vy: number;
}

export type MotionFn = (t: number) => MotionSample;

/** A hypothesis id that is not visually distinguishable in the current v1 scenarios. */
export interface UnsupportedEntry {
  reason: string;
}

const EPS = 1e-4;
const dydt = (f: (t: number) => number, t: number): number => (f(Math.min(1, t + EPS)) - f(Math.max(0, t - EPS))) / (2 * EPS);

function fromHeight(f: (t: number) => number): MotionFn {
  return (t) => ({ y: f(t), vy: dydt(f, t) });
}

// ---------------------------------------------------------------------------
// Scenario: TOSS (vertical throw, ignoring air resistance — matches the app's own demo prompt)
// ---------------------------------------------------------------------------

const H = 1; // reference apex height, arbitrary units

/** True kinematics: a clean parabola. Acceleration is constant and downward throughout,
 * including at the instant velocity crosses zero at the apex. */
const tossSound: MotionFn = fromHeight((t) => 4 * H * t * (1 - t));

/** 'used-up' — the internal "push" decays quickly, so the rise decelerates harder than gravity
 * alone would (an early, lower apex), then it falls under ordinary gravity for the remainder.
 * Both segments are true parabolas glued at the (earlier, lower) apex so vy is continuous. */
const tossUsedUp: MotionFn = fromHeight((t) => {
  const ta = 0.35; // apex arrives early: the "stored push" ran out sooner than real momentum would carry it
  const ha = H * 0.72; // and reaches a lower height, since it stopped rising sooner
  if (t <= ta) return ha * (1 - ((ta - t) / ta) ** 2); // eased rise reaching ha at t=ta with vy=0 there
  const fallT = (t - ta) / (1 - ta);
  return ha * (1 - fallT * fallT); // symmetric-style true fall back to 0 at t=1
});

/** 'sustaining' — believes a continuing upward force is needed while rising, so the object
 * decelerates much more slowly than gravity (looks like it's floating up), reaches a later and
 * higher apex, then drops sharply once that "force" is gone. */
const tossSustaining: MotionFn = fromHeight((t) => {
  const ta = 0.62;
  const ha = H * 1.35;
  if (t <= ta) return ha * (1 - ((ta - t) / ta) ** 2.6); // slow, floaty rise (high exponent = flatter near top)
  const fallT = (t - ta) / (1 - ta);
  return ha * (1 - fallT ** 1.6); // faster-than-parabolic drop once the "force" runs out
});

/** 'direction' — believes acceleration vanishes whenever velocity is zero, so the object HOVERS
 * at the apex for a beat before gravity "resumes." A flat spot in y(t) near the true apex, not a
 * longer total flight — the hover time is carved out of the ordinary rise/fall, not added to it. */
const tossDirection: MotionFn = fromHeight((t) => {
  const hoverStart = 0.42;
  const hoverEnd = 0.58;
  if (t < hoverStart) {
    const s = t / hoverStart;
    return H * (1 - (1 - s) ** 2); // ordinary-looking rise up to the hover
  }
  if (t <= hoverEnd) return H; // flat: "no velocity means no acceleration"
  const s = (t - hoverEnd) / (1 - hoverEnd);
  return H * (1 - s * s); // resumes falling, parabolic back to 0
});

/** 'velocity-force' — believes net force (and so acceleration) is proportional to speed rather
 * than constant. This produces an exponential-decay-flavoured approach to the apex (rounder,
 * more sluggish near turnaround) rather than a sharp parabolic peak, and a mirrored fall. */
const tossVelocityForce: MotionFn = fromHeight((t) => {
  const k = 5; // decay sharpness
  const shape = (s: number) => (1 - Math.exp(-k * s)) / (1 - Math.exp(-k)); // 0→1 easing, concave
  if (t <= 0.5) return H * shape(t / 0.5);
  return H * shape((1 - t) / 0.5);
});

const TOSS_MOTION: Record<string, MotionFn> = {
  SOUND: tossSound,
  'used-up': tossUsedUp,
  sustaining: tossSustaining,
  direction: tossDirection,
  'velocity-force': tossVelocityForce,
};

// ---------------------------------------------------------------------------
// Scenario: DROP (two balls released from rest — different concept family: fall/gravity/inertia)
// ---------------------------------------------------------------------------

/** True kinematics: both balls fall together regardless of mass. y here counts DOWN from release
 * height H to 0 (ground), so this is the mirror image of the toss parabola's falling half. */
const dropSound: MotionFn = fromHeight((t) => H * (1 - t * t));

/** 'mass-fall' — believes a heavier object accelerates faster. Rendered on the "heavy" ball only;
 * the light ball still uses dropSound. Reaches the ground distinctly before t=1. */
const dropMassFallHeavy: MotionFn = fromHeight((t) => {
  const landT = 0.72; // lands early
  if (t >= landT) return 0;
  const s = t / landT;
  return H * (1 - s * s);
});

/** 'no-motion' — believes removing the throwing force stops an object immediately / prevents it
 * from starting. Rendered as: the ball simply does not fall — it stays at release height for the
 * whole window, a deliberately inert, slightly unsettling flat line. */
const dropNoMotion: MotionFn = fromHeight(() => H);

/** 'air-gravity' — believes gravity itself requires air to act. In this scenario (explicitly
 * staged as a vacuum/airless drop, matching probes p13/p20/p23), the belief predicts the ball
 * does not fall at all — visually identical in shape to no-motion, but the caption/label carries
 * the different WHY ("no air, so no gravity" vs "no continuing force, so no motion"). Kept as a
 * separate entry rather than aliased to dropNoMotion so future authors don't have to guess that
 * the ids are supposed to coincide. */
const dropAirGravity: MotionFn = fromHeight(() => H);

const DROP_MOTION: Record<string, MotionFn> = {
  SOUND: dropSound,
  'mass-fall': dropMassFallHeavy,
  'no-motion': dropNoMotion,
  'air-gravity': dropAirGravity,
};

// ---------------------------------------------------------------------------
// Resolution + total coverage
// ---------------------------------------------------------------------------

/** Ids whose motion prediction is treated as identical to correct kinematics for now — normalizes
 * the 'SOUND' magic string against the pack's own id space instead of relying on a fallthrough
 * that happens to look right (fix #4). Extend this set only when a hypothesis genuinely predicts
 * no visible deviation in a given scenario. */
const CORRECT_IN: Record<Scenario, Set<string>> = {
  toss: new Set(['SOUND']),
  drop: new Set(['SOUND']),
};

/** Ids not modeled in either v1 scenario, with the reason on record (fix #1: explicit, not a
 * silent fallthrough to correct physics). These are candidates for future scenario additions —
 * collision/pairs, circular motion, normal force, friction — none of which a toss or drop can
 * represent. */
const UNSUPPORTED: Record<string, UnsupportedEntry> = {
  impetus: { reason: "Attached to 'interaction' but predicts a sustained internal force with no clean visual distinction from used-up/sustaining at this fidelity — needs its own worked-out curve, not a placeholder." },
  'unequal-pairs': { reason: "Concept 'pairs' (Newton's third law) needs a two-body collision/interaction scenario; a single falling or thrown ball can't show it." },
  centrifugal: { reason: "Concept 'circular' needs a tether/orbit scenario." },
  'animate-normal': { reason: "Concept 'normal' needs a resting-object-on-a-surface scenario." },
  'rolling-friction': { reason: "Concept 'friction' needs a rolling/sliding-contact scenario." },
};

export interface ResolvedMotion {
  kind: 'motion';
  scenario: Scenario;
  fn: MotionFn;
}
export interface ResolvedUnsupported {
  kind: 'unsupported';
  reason: string;
}
export type Resolution = ResolvedMotion | ResolvedUnsupported;

/** Single entry point the component should call. Total over every id in the pack + 'SOUND' —
 * never falls through silently. */
export function resolveMotion(hypothesisId: string, scenario: Scenario): Resolution {
  if (CORRECT_IN[scenario].has(hypothesisId)) return { kind: 'motion', scenario, fn: scenario === 'toss' ? tossSound : dropSound };
  const table = scenario === 'toss' ? TOSS_MOTION : DROP_MOTION;
  if (table[hypothesisId]) return { kind: 'motion', scenario, fn: table[hypothesisId] };
  const unsupported = UNSUPPORTED[hypothesisId];
  if (unsupported) return { kind: 'unsupported', reason: unsupported.reason };
  // Should be unreachable if the dev-time assertion below passes; fail loud rather than rendering
  // a wrong-looking default.
  throw new Error(`resolveMotion: no entry (motion or unsupported) for hypothesis "${hypothesisId}" in scenario "${scenario}". Add one to beliefMotion.ts.`);
}

/** Which scenario best demonstrates a given hypothesis, for the scene switcher / future menu. */
export function scenarioFor(hypothesisId: string): Scenario | null {
  if (hypothesisId === 'SOUND' || TOSS_MOTION[hypothesisId]) return 'toss';
  if (DROP_MOTION[hypothesisId]) return 'drop';
  return null;
}

// Dev-time coverage assertion (fix #1): every hypothesis in the pack must resolve to something —
// a real curve or a recorded "unsupported" reason — for at least one scenario. Runs once at
// module load in development; a missing entry fails loudly instead of silently rendering SOUND's
// (correct) physics for a misconception, which would defeat the entire feature's purpose.
if (process.env.NODE_ENV !== 'production') {
  const allIds = ['SOUND', ...pack.misconceptions.map((m) => m.id)];
  for (const id of allIds) {
    const inToss = CORRECT_IN.toss.has(id) || Boolean(TOSS_MOTION[id]);
    const inDrop = CORRECT_IN.drop.has(id) || Boolean(DROP_MOTION[id]);
    const covered = inToss || inDrop || Boolean(UNSUPPORTED[id]);
    console.assert(covered, `[physics-viz] hypothesis "${id}" has no motion curve and no recorded UNSUPPORTED reason. Add one to beliefMotion.ts before shipping — a silent gap here would render a misconception as correct physics.`);
  }
}
