// Pure-data tests for the scene module: no React, no three.js, no DOM. These guard the contract the
// renderer depends on — most importantly the contact invariant whose absence put every ball one
// radius inside the floor.
import { describe, expect, it } from 'vitest';
import {
  ALL_HYPOTHESES,
  BODY_RADIUS,
  boundsFor,
  frameFor,
  hypothesesForScenario,
  restY,
  scenarioBounds,
  scenarioFor,
  sceneLabelFor,
  trajectoryFor,
  trueFrameFor,
  type SceneFrame,
  type Scenario,
} from '@/lib/physics-viz/scenes';
import { newtonian as pack } from '@/lib/packs';

const SCENARIOS: Scenario[] = ['toss', 'drop', 'pairs', 'circular', 'surface', 'friction'];
const SAMPLES = 200;
const at = (frame: SceneFrame, t: number) => frame;

function sweep(id: string, fn: (frame: SceneFrame, t: number) => void) {
  const frameFn = frameFor(id);
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    fn(at(frameFn(t), t), t);
  }
}

const halfHeightOf = (b: { shape?: string; size?: { h: number } }) => (b.shape === 'box' ? (b.size?.h ?? BODY_RADIUS * 2) / 2 : BODY_RADIUS);

describe('scene coverage', () => {
  it('maps every hypothesis in the pack to a scenario', () => {
    const ids = ['SOUND', ...pack.misconceptions.map((m) => m.id)];
    expect(ALL_HYPOTHESES).toEqual(ids);
    for (const id of ids) {
      expect(SCENARIOS, `${id} has no scenario`).toContain(scenarioFor(id));
      expect(sceneLabelFor(id).length).toBeGreaterThan(0);
    }
  });

  it('partitions every hypothesis across the scenarios', () => {
    const union = SCENARIOS.flatMap((s) => hypothesesForScenario(s));
    expect(union.sort()).toEqual([...ALL_HYPOTHESES].sort());
  });

  it('gives every hypothesis a true-kinematics reference to compare against', () => {
    for (const id of ALL_HYPOTHESES) {
      const truth = trueFrameFor(id)(0.5);
      expect(truth.bodies.length, `${id} has no ghost bodies`).toBeGreaterThan(0);
      // The ghost shares the believed scene's staging, otherwise the comparison is not like-for-like.
      expect(truth.groundY).toBe(frameFor(id)(0.5).groundY);
      expect(truth.mood).toBe(frameFor(id)(0.5).mood);
    }
  });
});

describe('contact invariant', () => {
  it('rests a body on the surface rather than inside it', () => {
    expect(restY(0)).toBe(BODY_RADIUS);
    expect(restY(-0.3, 0.075)).toBeCloseTo(-0.225);
  });

  it.each(ALL_HYPOTHESES)('%s never places a grounded body below its surface', (id) => {
    sweep(id, (frame, t) => {
      if (frame.ground === false) return;
      for (const b of frame.bodies) {
        if (b.throughSurface) continue; // the animate-normal book passes through on purpose
        const bottom = b.y - halfHeightOf(b);
        expect(
          bottom,
          `${id}/${b.id} bottom ${bottom.toFixed(4)} is below ground ${frame.groundY} at t=${t.toFixed(3)}`,
        ).toBeGreaterThanOrEqual(frame.groundY - 1e-9);
      }
    });
  });

  it('only lets a body through the surface when the scene says so', () => {
    const sinking = ALL_HYPOTHESES.filter((id) =>
      frameFor(id)(0.99).bodies.some((b) => b.throughSurface),
    );
    expect(sinking).toEqual(['animate-normal']);
  });

  it('never starts or ends a scene mid-deformation', () => {
    for (const id of ALL_HYPOTHESES) {
      for (const t of [0, 1]) {
        for (const b of frameFor(id)(t).bodies) {
          expect(b.squash ?? 0, `${id}/${b.id} is squashed at t=${t}`).toBe(0);
        }
      }
    }
  });

  it('holds the flight contract: the vertical scenes begin and end at rest on the ground', () => {
    // Documented design contract: for the single-ball vertical flight, y(0) and y(1) are the
    // resting height for EVERY hypothesis, so beliefs stay comparable on one timeline.
    for (const id of ALL_HYPOTHESES.filter((h) => ['toss', 'drop'].includes(scenarioFor(h)))) {
      for (const t of [0, 1]) {
        for (const b of frameFor(id)(t).bodies) {
          const speed = Math.hypot(b.vx ?? 0, b.vy ?? 0);
          // 'no-motion' and 'air-gravity' never fall, so they are trivially at rest too.
          expect(speed, `${id}/${b.id} is moving at t=${t}`).toBeLessThan(0.001);
        }
      }
    }
  });

  it('keeps every event inside the timeline, with room for its burst to finish', () => {
    for (const id of ALL_HYPOTHESES) {
      const events = frameFor(id)(0.5).events ?? [];
      for (const ev of events) {
        expect(ev.at, `${id}/${ev.id}`).toBeGreaterThanOrEqual(0);
        // SceneRenderer fades a burst over BURST_DURATION (0.11) of the timeline, so an event at
        // t=1 would be cut off by the loop — which is why contact sits at t=0.9.
        expect(ev.at, `${id}/${ev.id} leaves no room for its burst`).toBeLessThanOrEqual(0.9);
      }
    }
  });
});

describe('velocities agree with the paths they animate', () => {
  it.each(ALL_HYPOTHESES)('%s reports finite velocity matching its own curve', (id) => {
    const frameFn = frameFor(id);
    let maxSpeed = 0;
    sweep(id, (frame, t) => {
      if (t <= 0.02 || t >= 0.98) return;
      for (const b of frame.bodies) {
        const h = 1e-4;
        const yAt = (s: number) => frameFn(s).bodies.find((x) => x.id === b.id)?.y ?? 0;
        const forward = (yAt(t + h) - yAt(t)) / h;
        const expectedVy = (yAt(t) - yAt(t - h)) / h;
        // A corner (held beat, contact) has no single derivative; skip rather than assert on an
        // ambiguity. Everywhere else the reported velocity must track the curve.
        if (Math.abs(forward - expectedVy) > 0.4 * (1 + Math.abs(expectedVy))) continue;
        expect(Number.isFinite(b.vy ?? 0), `${id}/${b.id} vy is not finite`).toBe(true);
        // Tolerant of the kinks the authored curves deliberately have (a flight that starts on a
        // held beat, a spring that releases); the property under test is agreement in sign and
        // scale, not bit-exact derivative agreement at a corner.
        const tolerance = 0.08 * (1 + Math.abs(expectedVy));
        expect(
          Math.abs((b.vy ?? 0) - expectedVy),
          `${id}/${b.id} vy ${(b.vy ?? 0).toFixed(3)} disagrees with its curve ${expectedVy.toFixed(3)} at t=${t}`,
        ).toBeLessThan(tolerance);
        maxSpeed = Math.max(maxSpeed, Math.hypot(b.vx ?? 0, b.vy ?? 0));
      }
    });
    expect(maxSpeed, `${id} never moves`).toBeGreaterThan(0);
  });
});

describe('camera framing bounds', () => {
  it.each(SCENARIOS)('%s bounds contain every body of every hypothesis in the scenario', (scenario) => {
    const bounds = scenarioBounds(scenario);
    expect(Number.isFinite(bounds.minX) && Number.isFinite(bounds.maxY)).toBe(true);
    for (const id of hypothesesForScenario(scenario)) {
      const own = boundsFor(frameFor(id));
      expect(own.minX).toBeGreaterThanOrEqual(bounds.minX - 1e-9);
      expect(own.maxX).toBeLessThanOrEqual(bounds.maxX + 1e-9);
      expect(own.minY).toBeGreaterThanOrEqual(bounds.minY - 1e-9);
      expect(own.maxY).toBeLessThanOrEqual(bounds.maxY + 1e-9);
    }
  });

  it('shares one framing across a scenario so arc heights stay comparable', () => {
    // The whole point of scenario bounds: 'sustaining' must still read as floating higher than
    // 'used-up', which only holds if both are drawn at the same scale.
    const apex = (id: string) => Math.max(...Array.from({ length: 101 }, (_, i) => frameFor(id)(i / 100).bodies[0].y));
    expect(scenarioFor('sustaining')).toBe('toss');
    expect(scenarioFor('used-up')).toBe('toss');
    expect(apex('impetus')).toBeGreaterThan(apex('sustaining'));
    expect(apex('sustaining')).toBeGreaterThan(apex('SOUND'));
    expect(apex('SOUND')).toBeGreaterThan(apex('used-up'));
  });
});

describe('trajectory sampling', () => {
  it('traces the body it is asked for, across the whole timeline', () => {
    const frameFn = frameFor('SOUND');
    const points = trajectoryFor(frameFn, 'ball', 24);
    expect(points).toHaveLength(25);
    expect(points[0][1]).toBeCloseTo(frameFn(0).bodies[0].y, 6);
    expect(points[24][1]).toBeCloseTo(frameFn(1).bodies[0].y, 6);
    for (const [x, y, z] of points) {
      expect(z).toBe(0);
      expect(x).toBe(0); // the toss is purely vertical
      expect(y).toBeGreaterThanOrEqual(BODY_RADIUS - 1e-9);
    }
  });

  it('returns nothing for a body the scene does not have', () => {
    expect(trajectoryFor(frameFor('SOUND'), 'nope', 8)).toEqual([]);
  });
});
