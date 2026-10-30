import * as THREE from 'three';
import type { PhysicsParams } from '../sim/physics';
import type { Laws, Derived } from '../sim/laws';

export type Level = 'map' | 'universe' | 'galaxy' | 'system' | 'planet';
/** Zoom hierarchy (Backspace / breadcrumbs). 'universe' is the cosmic-expansion simulator, reached from the map. */
export const LEVEL_ORDER: Level[] = ['map', 'galaxy', 'system', 'planet'];
export const ALL_LEVELS: Level[] = ['map', 'universe', 'galaxy', 'system', 'planet'];

export interface InfoRow { k: string; v: string; tone?: 'good' | 'warn' | 'bad' }

/** Everything the HUD needs to show about a selected object. */
export interface SelectionInfo {
  id: string;
  name: string;
  kind: string;
  info: string;
  rows: InfoRow[];
  enterLabel: string | null;  // e.g. "Enter system" — null if not enterable
  travelLabel?: string;       // map: fly the viewpoint to this object
  editable: boolean;          // system-level dynamic body (mass / kick / delete)
  massSim?: number;
  isPlanet?: boolean;         // can receive a moon
}

export interface BodyListItem { id: string; name: string; kind: string; depth: number }

export interface LevelStats {
  rows: InfoRow[];
  bodies?: BodyListItem[];
  curve?: { r: number; total: number; baryon: number }[]; // galaxy rotation curve
  event?: string;
}

export interface FrameCtx {
  dtReal: number;
  simDt: number;          // signed: dtReal · timeWarp · (±1), 0 when paused
  physics: PhysicsParams;
  laws: Laws;
  derived: Derived;
  camera: THREE.PerspectiveCamera;
}

export interface LabelSpec { id: string; text: string; cls: string; pos: () => THREE.Vector3; visible?: () => boolean }

export interface View {
  readonly group: THREE.Group;
  update(ctx: FrameCtx): void;
  /** Screen-space pick → object id or null. */
  pick(ndcX: number, ndcY: number, camera: THREE.PerspectiveCamera, w: number, h: number): string | null;
  /** Write object position to out; return its visual radius, or null if it no longer exists. */
  target(id: string, out: THREE.Vector3): number | null;
  info(id: string): SelectionInfo | null;
  labels(): LabelSpec[];
  stats(physics: PhysicsParams): LevelStats;
  dispose(): void;
}

/** Free GPU resources under an object (skips textures flagged as shared). */
export function disposeTree(root: THREE.Object3D) {
  root.traverse((o: THREE.Object3D) => {
    const anyO = o as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
    anyO.geometry?.dispose();
    const mats = anyO.material ? (Array.isArray(anyO.material) ? anyO.material : [anyO.material]) : [];
    for (const m of mats) {
      for (const key of ['map', 'alphaMap', 'emissiveMap'] as const) {
        const tex = (m as unknown as Record<string, THREE.Texture | null | undefined>)[key];
        if (tex && !tex.userData.shared) tex.dispose();
      }
      m.dispose();
    }
  });
}

const _p = new THREE.Vector3();

/**
 * Pick the point nearest the cursor in screen space (within maxPx), preferring
 * nearer points on ties. O(N) projection — fine for ≤ 60k points on click.
 */
export function pickPoints(
  positions: Float32Array, count: number, matrixWorld: THREE.Matrix4,
  camera: THREE.PerspectiveCamera, ndcX: number, ndcY: number, w: number, h: number, maxPx = 12,
): number {
  let best = -1, bestScore = Infinity;
  const px = ((ndcX + 1) / 2) * w, py = ((1 - ndcY) / 2) * h;
  for (let i = 0; i < count; i++) {
    _p.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).applyMatrix4(matrixWorld);
    const depth = _p.distanceTo(camera.position);
    _p.project(camera);
    if (_p.z > 1 || _p.z < -1) continue;
    const sx = ((_p.x + 1) / 2) * w, sy = ((1 - _p.y) / 2) * h;
    const d = Math.hypot(sx - px, sy - py);
    if (d > maxPx) continue;
    const score = d + depth * 1e-4;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}

export function glowSprite(map: THREE.Texture, color: number, scale: number, opacity = 1): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  s.scale.setScalar(scale);
  return s;
}

export function pointsMaterial(map: THREE.Texture, size: number, opacity = 1): THREE.PointsMaterial {
  return new THREE.PointsMaterial({
    size, sizeAttenuation: true, vertexColors: true, map, transparent: true, opacity,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

export const fmtSigned = (x: number, d = 2) => (x >= 0 ? '+' : '') + x.toFixed(d);

/**
 * Points with per-point colour (aColor) and pixel size (aSize). Uses the renderer's
 * logarithmic depth buffer chunks so it composes with the rest of the scene.
 */
export function sizedPointsMaterial(opacity = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: opacity }, uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) } },
    vertexShader: `
      attribute vec3 aColor;
      attribute float aSize;
      uniform float uPixelRatio;
      varying vec3 vColor;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPixelRatio;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      uniform float uOpacity;
      varying vec3 vColor;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(c));
        gl_FragColor = vec4(vColor * a * uOpacity, a * uOpacity);
      }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
}
