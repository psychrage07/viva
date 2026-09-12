// @vitest-environment node
// Drives the REAL SceneRenderer through @react-three/test-renderer and asserts on the transforms it
// wrote into the actual three.js scene graph — not on a re-implementation of them. WebGL itself is
// mocked, so shader compilation is not covered here (the GLSL is only exercised in a browser);
// body placement, the trail buffer, and the squash anchoring are.
import { describe, expect, it } from 'vitest';
import * as React from 'react';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import SceneRenderer, { type PlaybackClock } from '@/components/SceneRenderer';
import { DEFAULT_VIEW, FOV, fitDistance } from '@/components/PhysicsStage';
import { ALL_HYPOTHESES, BODY_RADIUS, frameFor, scenarioBounds, scenarioFor, trajectoryFor, trueFrameFor } from '@/lib/physics-viz/scenes';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const PALETTE = { primary: '#284c3a', secondary: '#72786d', ghost: '#ded5ed', ground: '#253e30', groundIndoor: '#f9f9f1' };
/** useFrame delta is in SECONDS, and advanceFrames passes its second argument straight through. */
const FRAME_S = 0.016;
const FRAME_MS = 16;
const DURATION_MS = 2400;
/** The real playback rate, so trail sampling sees the same per-frame motion the browser does. */
const DT_PER_FRAME = FRAME_MS / DURATION_MS;

const halfHeightOf = (shape?: string, h?: number) => (shape === 'box' ? (h ?? BODY_RADIUS * 2) / 2 : BODY_RADIUS);

interface Ctx {
  clock: { current: PlaybackClock };
  scene: THREE.Object3D;
  /** Run `frames` render frames, advancing the clock at the real playback rate. */
  play: (frames: number) => Promise<void>;
  setT: (t: number) => Promise<void>;
  trailGeometry: () => THREE.BufferGeometry;
  body: (id: string) => THREE.Object3D;
}

async function withScene(hypothesis: string, run: (ctx: Ctx) => Promise<void>, extra: Record<string, unknown> = {}) {
  const clock: { current: PlaybackClock } = { current: { t: 0, playing: true, hold: 0 } };
  const renderer = await ReactThreeTestRenderer.create(
    React.createElement(SceneRenderer, {
      frameFn: frameFor(hypothesis),
      palette: PALETTE,
      clock,
      trail: true,
      // ContactShadows needs a real render target, which the mock renderer does not provide.
      contactShadow: false,
      ...extra,
    }),
  );
  const scene = (renderer.scene as unknown as { instance: THREE.Object3D }).instance;
  const body = (id: string) => {
    const found = scene.getObjectByName(id);
    if (!found) throw new Error(`no rendered object named "${id}"`);
    return found;
  };
  const trailGeometry = () => {
    const group = scene.getObjectByName('motion-trail');
    if (!group) throw new Error('no motion trail in the scene');
    const mesh = group.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
    const geo = mesh?.geometry as THREE.BufferGeometry | undefined;
    if (!geo) throw new Error('motion trail has no geometry');
    return geo;
  };
  await run({
    clock,
    scene,
    body,
    trailGeometry,
    play: async (frames) => {
      for (let i = 0; i < frames; i++) {
        clock.current.t = Math.min(1, clock.current.t + DT_PER_FRAME);
        await renderer.advanceFrames(1, FRAME_S);
      }
    },
    setT: async (t) => {
      clock.current.t = t;
      await renderer.advanceFrames(1, FRAME_S);
    },
  });
}

describe('rendered bodies stay on their surface', () => {
  it.each(ALL_HYPOTHESES)('%s never renders a grounded body below the ground', async (hypothesis) => {
    await withScene(hypothesis, async ({ body, setT }) => {
      let checked = 0;
      for (let i = 0; i <= 60; i++) {
        const t = i / 60;
        await setT(t);
        const frame = frameFor(hypothesis)(t);
        // `circular` is staged in free space and the `animate-normal` book passes through its shelf
        // on purpose; both are covered by their own assertions below.
        if (frame.ground === false) continue;
        for (const data of frame.bodies) {
          if (data.throughSurface) continue;
          const object = body(data.id);
          const bottom = object.position.y - halfHeightOf(data.shape, data.size?.h);
          expect(
            bottom,
            `${hypothesis}/${data.id} bottom ${bottom.toFixed(4)} is below ground ${frame.groundY} at t=${t.toFixed(3)}`,
          ).toBeGreaterThanOrEqual(frame.groundY - 1e-6);
          checked++;
        }
      }
      const hasGroundedBody = (() => {
        const frame = frameFor(hypothesis)(0.5);
        return frame.ground !== false && frame.bodies.some((b) => !b.throughSurface);
      })();
      if (hasGroundedBody) expect(checked, 'expected grounded bodies to check').toBeGreaterThan(10);
      else expect(checked).toBe(0);
    });
  });

  it('bounds the animate-normal sink instead of dropping the book out of the world', async () => {
    await withScene('animate-normal', async ({ body, setT }) => {
      const book = body('book');
      const half = halfHeightOf('box', 0.11);
      let lowest = Infinity;
      for (let i = 0; i <= 40; i++) {
        await setT(i / 40);
        lowest = Math.min(lowest, book.position.y - half);
      }
      // Authored as BOOK_SINK (0.26) below the shelf top, so the bottom stops at -(0.26 + half).
      // v2 sank it to -0.49, which is 3.5 radii and read as geometry falling out of the world.
      expect(lowest, `book sank to ${lowest.toFixed(3)}`).toBeGreaterThanOrEqual(-(0.26 + half) - 1e-6);
      expect(lowest, 'the book should visibly pass through the shelf').toBeLessThan(0);
    });
  });

  it('stages centrifugal in free space, with no floor to fall through', async () => {
    await withScene('centrifugal', async ({ scene }) => {
      // The scene declares no ground, so the renderer must not draw one for the capsule to clip.
      expect(frameFor('centrifugal')(0.5).ground).toBe(false);
      const floors: unknown[] = [];
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && (mesh.geometry as THREE.CircleGeometry)?.type === 'CircleGeometry' && mesh.rotation.x < -1) floors.push(mesh);
      });
      expect(floors, 'a free-space scene should have no ground disc').toHaveLength(0);
    });
  });
});

describe('the whole arc stays inside the fitted camera', () => {
  it.each(ALL_HYPOTHESES)('%s never leaves the frustum', (hypothesis) => {
    const bounds = scenarioBounds(scenarioFor(hypothesis));
    // The compact stage in the probe phase is the worst case for a wide scene.
    const aspect = 360 / 260;
    const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 100);
    const target = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0);
    camera.position.copy(target).addScaledVector(DEFAULT_VIEW, fitDistance(bounds, aspect));
    camera.lookAt(target);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    let checked = 0;
    for (let i = 0; i <= 60; i++) {
      const frame = frameFor(hypothesis)(i / 60);
      for (const b of frame.bodies) {
        const half = halfHeightOf(b.shape, b.size?.h);
        for (const dy of [-half, half]) {
          const ndc = new THREE.Vector3(b.x, b.y + dy, 0).project(camera);
          const at = `${hypothesis}/${b.id} at t=${(i / 60).toFixed(2)}`;
          expect(Math.abs(ndc.y), `${at} leaves the frame vertically`).toBeLessThanOrEqual(1);
          expect(Math.abs(ndc.x), `${at} leaves the frame horizontally`).toBeLessThanOrEqual(1);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(60);
  });
});

describe('motion trail', () => {
  it('draws in flight, then retracts once the body is at rest', async () => {
    await withScene('SOUND', async ({ play, trailGeometry, setT }) => {
      const geo = trailGeometry();
      expect(geo.drawRange.count).toBe(0);

      await play(45); // rising, well before the apex
      const inFlight = geo.drawRange.count;
      expect(inFlight, 'the trail should have ribbon segments in flight').toBeGreaterThan(20);

      // Hold at the apex, where the ball is momentarily at rest: no new samples arrive, the old
      // ones age out, and the ribbon must vanish instead of freezing into a wedge.
      await setT(0.5);
      for (let i = 0; i < 60; i++) await setT(0.5);
      expect(geo.drawRange.count, 'the trail should retract once the body stops').toBe(0);
    });
  });

  it('clears rather than streaking when the timeline jumps backwards', async () => {
    await withScene('SOUND', async ({ play, setT, trailGeometry }) => {
      const geo = trailGeometry();
      await play(45);
      expect(geo.drawRange.count).toBeGreaterThan(20);
      await setT(0.08); // a scrub: the ball teleports, so the history must be dropped
      expect(geo.drawRange.count, 'a backwards scrub must not draw a straight streak').toBe(0);
    });
  });

  it('puts every ribbon vertex on the path the body actually took', async () => {
    await withScene('SOUND', async ({ play, clock, trailGeometry }) => {
      const geo = trailGeometry();
      const visitedY: number[] = [];
      await play(45);
      for (let i = 1; i <= 46; i++) visitedY.push(frameFor('SOUND')(Math.min(1, i * DT_PER_FRAME)).bodies[0].y);
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      // drawRange counts INDICES: six per quad, and the strip reuses two vertices per quad.
      const quads = geo.drawRange.count / 6;
      const vertices = quads + 1;
      expect(vertices, 'expected a usable ribbon').toBeGreaterThan(5);
      for (let i = 0; i < vertices; i++) {
        const vertex = i * 2; // two ribbon vertices share each centre point
        const y = pos.getY(vertex);
        expect(visitedY.some((v) => Math.abs(v - y) < 1e-4), `ribbon vertex y=${y.toFixed(4)} is not on the path`).toBe(true);
      }
    });
  });
});

describe('trajectory line and ghost overlay', () => {
  it('draws the sampled path without disturbing the motion', async () => {
    const frameFn = frameFor('SOUND');
    await withScene(
      'SOUND',
      async ({ body, setT }) => {
        await setT(0.5);
        // The path is decoration: the ball must still be exactly where the curve puts it.
        expect(body('ball').position.y).toBeCloseTo(frameFn(0.5).bodies[0].y, 6);
      },
      { trajectory: trajectoryFor(frameFn, 'ball', 24) },
    );
  });

  it('renders the true-motion ghost pass as see-through and unlit', async () => {
    await withScene(
      'SOUND',
      async ({ scene, body, setT }) => {
        await setT(0.5);
        expect(body('ball').position.y).toBeGreaterThan(0);
        // The ghost must not bring its own lights or sky into the shared stage.
        const lights: string[] = [];
        scene.traverse((o) => {
          if ((o as THREE.Light).isLight) lights.push(o.type);
        });
        expect(lights, 'the ghost pass should not add lights').toHaveLength(0);
        // And its materials must stay translucent, or the two arcs become indistinguishable.
        const opacities: number[] = [];
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh || !mesh.material) return;
          for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            const shader = m as THREE.ShaderMaterial;
            // Shader materials carry their alpha in a uniform, not in `opacity`.
            if (shader.uniforms?.uOpacity) continue;
            opacities.push((m as THREE.Material & { opacity: number }).opacity);
          }
        });
        expect(opacities.length).toBeGreaterThan(0);
        expect(Math.max(...opacities), 'ghost materials should stay see-through').toBeLessThan(0.6);
      },
      { ghost: true, trail: false, trajectory: trajectoryFor(trueFrameFor('SOUND'), 'ball', 24) },
    );
  });
});

describe('contact squash', () => {
  it('compresses on landing while the contact point stays planted', async () => {
    await withScene('SOUND', async ({ body, setT }) => {
      const ball = body('ball') as THREE.Group;
      const squash = ball.getObjectByName('squash') as THREE.Group;
      expect(squash).toBeTruthy();
      let deepest = 1;
      let bottomAtDeepest = 0;
      let lowest = Infinity;
      for (let i = 0; i <= 120; i++) {
        await setT(0.9 + i / 1200); // across the landing window
        const scaleY = squash.scale.y;
        // Lowest point of the sphere: body centre + squash offset - compressed radius.
        const bottom = ball.position.y + squash.position.y - BODY_RADIUS * scaleY;
        lowest = Math.min(lowest, bottom);
        if (scaleY < deepest) {
          deepest = scaleY;
          bottomAtDeepest = bottom;
        }
      }
      expect(deepest, 'the ball should visibly compress at contact').toBeLessThan(0.95);
      // The squash must be anchored at the contact point. If it were anchored at the centre (what
      // v2 did), the bottom would lift by BODY_RADIUS * (1 - deepest) at full compression.
      expect(
        Math.abs(bottomAtDeepest),
        `contact point sits ${bottomAtDeepest.toFixed(4)} off the ground at full compression`,
      ).toBeLessThan(0.002);
      expect(lowest, 'the contact point must never sink below the ground').toBeGreaterThanOrEqual(-1e-6);
    });
  });
});
