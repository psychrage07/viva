// @vitest-environment node
// Shader contract tests. This sandbox has no GPU and no browser, so the GLSL is never compiled by a
// driver here. These tests get as close as that allows: they take the shader source the REAL
// SceneRenderer hands to three.js, resolve its `#include`s against three's actual ShaderChunk table,
// prepend the declarations three injects, and parse the result as GLSL ES 1.0.
//
// They also cross-check the two failure modes a syntax parse cannot see, both of which fail
// silently in WebGL rather than loudly:
//   - an attribute the vertex shader reads but the geometry never supplies (renders nothing)
//   - a uniform the shader reads but the material never defines (defaults to 0 — e.g. uWidth = 0
//     is a zero-width, invisible ribbon, not an error)
import { describe, expect, it } from 'vitest';
import * as React from 'react';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { parse } from '@shaderfrog/glsl-parser';
import SceneRenderer, { type PlaybackClock } from '@/components/SceneRenderer';
import { frameFor } from '@/lib/physics-viz/scenes';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const PALETTE = { primary: '#284c3a', secondary: '#72786d', ghost: '#ded5ed', ground: '#253e30', groundIndoor: '#f9f9f1' };

/** The declarations three's WebGLProgram prepends to a ShaderMaterial. Anything the shader uses
 * from this list is legitimately undeclared in the source we author. */
const VERT_PREFIX = /* glsl */ `
precision highp float;
precision highp int;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
// GLSL ES 1.0 built-ins. A driver predeclares these; the parser does not, so without them every
// shader would report gl_Position as undefined and drown the real findings.
vec4 gl_Position;
float gl_PointSize;
`;

const FRAG_PREFIX = /* glsl */ `
precision highp float;
precision highp int;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
vec4 gl_FragColor;
vec4 gl_FragCoord;
bool gl_FrontFacing;
vec2 gl_PointCoord;
// Functions three generates into the program prefix rather than the chunk table. The bodies vary
// with the renderer's tone-mapping/colour-space settings; the signatures the chunks call do not.
vec4 linearToOutputTexel( vec4 value ) { return value; }
vec3 toneMapping( vec3 color ) { return color; }
`;

/** Attributes three declares for every ShaderMaterial, so they need not be in the geometry check
 * unless the geometry actually uses them. */
const THREE_BUILTIN_ATTRIBUTES = new Set(['position', 'normal', 'uv', 'uv1', 'uv2', 'uv3', 'color', 'tangent', 'skinIndex', 'skinWeight', 'instanceMatrix']);
const GLSL_BUILTINS = /^(gl_|texture2D|texture|mix|clamp|pow|max|min|smoothstep|abs|length|normalize|sin|cos|dot|vec2|vec3|vec4|mat3|mat4|float|int|bool|discard)/;

function resolveIncludes(source: string): string {
  return source.replace(/#include\s+<([a-z0-9_]+)>/g, (_match, name: string) => {
    const chunk = (THREE.ShaderChunk as Record<string, string | undefined>)[name];
    // A typo'd include name is a hard build failure in three, so fail the test the same way.
    if (chunk === undefined) throw new Error(`unresolved shader include: <${name}>`);
    return chunk;
  });
}

const declaredNames = (source: string, keyword: 'attribute' | 'uniform'): string[] => {
  const names: string[] = [];
  const re = new RegExp(`^\\s*${keyword}\\s+(?:lowp\\s+|mediump\\s+|highp\\s+)?[A-Za-z0-9_]+\\s+([A-Za-z0-9_]+)`, 'gm');
  for (const match of source.matchAll(re)) names.push(match[1]);
  return names;
};

/** Parses one stage and returns the identifiers the parser could not resolve. The parser does
 * full scope analysis but reports problems as warnings rather than throwing, so a syntax-only
 * check would happily accept a shader that reads an attribute nobody declared — which in WebGL
 * renders as nothing at all, with no error anywhere. */
function parseAndCollectUndefined(prefix: string, source: string): string[] {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    parse(prefix + resolveIncludes(source));
  } finally {
    console.warn = original;
  }
  return warnings.filter((w) => /undefined variable|undeclared function/.test(w));
}

const usedIdentifiers = (source: string): Set<string> => {
  const body = source.replace(/^\s*(attribute|uniform|varying)\s+[^;]+;/gm, '');
  const ids = new Set<string>();
  for (const match of body.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) ids.add(match[0]);
  return ids;
};

interface ShaderPair {
  name: string;
  material: THREE.ShaderMaterial;
  geometry: THREE.BufferGeometry;
}

/** Renders a scene and pairs every custom ShaderMaterial with the geometry it draws. */
async function collectShaders(hypothesis: string): Promise<ShaderPair[]> {
  const clock: { current: PlaybackClock } = { current: { t: 0.35, playing: true, hold: 0 } };
  const renderer = await ReactThreeTestRenderer.create(
    React.createElement(SceneRenderer, {
      frameFn: frameFor(hypothesis),
      palette: PALETTE,
      clock,
      trail: true,
      contactShadow: false,
    }),
  );
  await renderer.advanceFrames(2, 0.016);
  const scene = (renderer.scene as unknown as { instance: THREE.Object3D }).instance;
  const pairs: ShaderPair[] = [];
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!(material as THREE.ShaderMaterial).isShaderMaterial) continue;
      // A RawShaderMaterial gets no three prefix at all, so these checks would not apply to it.
      if ('isRawShaderMaterial' in material) continue;
      pairs.push({ name: mesh.parent?.name ?? mesh.name ?? mesh.type, material: material as THREE.ShaderMaterial, geometry: mesh.geometry as THREE.BufferGeometry });
    }
  });
  return pairs;
}

describe('custom shaders', () => {
  it('are found at all, so this suite cannot pass vacuously', async () => {
    const pairs = await collectShaders('SOUND');
    const names = pairs.map((p) => p.material.type).sort();
    expect(pairs.length, 'expected the trail ribbons and the ground disc').toBeGreaterThanOrEqual(3);
    expect(names.length).toBe(pairs.length);
  });

  it.each(['SOUND', 'mass-fall', 'animate-normal'])('%s: every stage parses as valid GLSL', async (hypothesis) => {
    const pairs = await collectShaders(hypothesis);
    expect(pairs.length).toBeGreaterThan(0);
    for (const { name, material } of pairs) {
      expect(() => parse(VERT_PREFIX + resolveIncludes(material.vertexShader)), `${name} vertex shader`).not.toThrow();
      expect(() => parse(FRAG_PREFIX + resolveIncludes(material.fragmentShader)), `${name} fragment shader`).not.toThrow();
    }
  });

  it.each(['SOUND', 'mass-fall', 'animate-normal'])('%s: no stage reads an identifier it never declared', async (hypothesis) => {
    const pairs = await collectShaders(hypothesis);
    expect(pairs.length).toBeGreaterThan(0);
    for (const { name, material } of pairs) {
      expect(parseAndCollectUndefined(VERT_PREFIX, material.vertexShader), `${name} (${hypothesis}) vertex shader`).toEqual([]);
      expect(parseAndCollectUndefined(FRAG_PREFIX, material.fragmentShader), `${name} (${hypothesis}) fragment shader`).toEqual([]);
    }
  });

  it('supply every attribute the vertex shader reads', async () => {
    for (const hypothesis of ['SOUND', 'mass-fall', 'animate-normal']) {
      for (const { name, material, geometry } of await collectShaders(hypothesis)) {
        for (const attribute of declaredNames(material.vertexShader, 'attribute')) {
          if (THREE_BUILTIN_ATTRIBUTES.has(attribute)) continue;
          expect(
            geometry.getAttribute(attribute),
            `${name} (${hypothesis}): vertex shader reads "${attribute}" but the geometry has [${Object.keys(geometry.attributes).join(', ')}]`,
          ).toBeDefined();
        }
      }
    }
  });

  it('define every uniform either stage reads', async () => {
    for (const hypothesis of ['SOUND', 'mass-fall', 'animate-normal']) {
      for (const { name, material } of await collectShaders(hypothesis)) {
        const declared = new Set([...declaredNames(material.vertexShader, 'uniform'), ...declaredNames(material.fragmentShader, 'uniform')]);
        const used = new Set([...usedIdentifiers(material.vertexShader), ...usedIdentifiers(material.fragmentShader)]);
        const supplied = new Set(Object.keys(material.uniforms));
        for (const uniform of declared) {
          // A uniform that is declared but never supplied silently defaults to 0 — for uWidth that
          // is an invisible ribbon, and for uOpacity an invisible ground.
          expect(supplied.has(uniform), `${name} (${hypothesis}): declares uniform "${uniform}" but the material does not define it`).toBe(true);
        }
        for (const identifier of used) {
          if (!identifier.startsWith('u') && !identifier.startsWith('U')) continue;
          if (GLSL_BUILTINS.test(identifier)) continue;
          if (!declared.has(identifier)) continue;
          expect(supplied.has(identifier), `${name} (${hypothesis}): uses uniform "${identifier}" that is not in material.uniforms`).toBe(true);
        }
        // And the reverse: a uniform the material animates but no shader reads is dead weight that
        // suggests a rename went half-done.
        for (const uniform of supplied) {
          expect(declared.has(uniform), `${name} (${hypothesis}): material defines uniform "${uniform}" that neither shader declares`).toBe(true);
        }
      }
    }
  });

  it('keep the trail ribbon wide enough to see and the ground opaque enough to read', async () => {
    for (const { name, material } of await collectShaders('SOUND')) {
      if (name !== 'motion-trail') continue;
      const width = material.uniforms.uWidth.value as number;
      const opacity = material.uniforms.uOpacity.value as number;
      expect(width, `${name} uWidth`).toBeGreaterThan(0);
      expect(opacity, `${name} uOpacity`).toBeGreaterThan(0);
    }
  });
});
