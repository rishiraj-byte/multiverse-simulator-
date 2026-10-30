import * as THREE from 'three';
import type { RealLayer, Category } from '../../data/layers';
import { chiTable, cosmoKey } from '../../data/layers';
import type { CosmoParams } from '../../sim/cosmology';
import type { Vec3 } from '../../sim/ephemeris';

// GPU-mapped point layers for real catalogues (up to millions of points).
// The vertex shader applies the same logarithmic map as MapView on the fly:
//   v = p − centre,  R = K · log10(1 + |v| / D0),  scene = (vx, vz, −vy) · R / |v|
// so travelling never touches the CPU-side arrays.

export interface Region { center: Vec3; radius: number }

interface Entry { layer: RealLayer; pos: Float32Array; points: THREE.Points; mat: THREE.ShaderMaterial; ckey: string }

const VERT = `
  attribute vec3 aColor;
  attribute float aSize;
  uniform vec3 uCenter;
  uniform vec3 uIsoC;
  uniform float uIsoR;
  uniform float uK;
  uniform float uD0;
  uniform float uPixelRatio;
  uniform float uSizeMul;
  varying vec3 vColor;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vColor = aColor;
    if (uIsoR > 0.0 && length(position - uIsoC) > uIsoR) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    vec3 v = position - uCenter;
    float d = length(v);
    float R = uK * log(1.0 + d / uD0) * 0.4342944819;
    vec3 m = d > 0.0 ? v * (R / d) : vec3(0.0);
    vec4 mv = modelViewMatrix * vec4(m.x, m.z, -m.y, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uSizeMul * uPixelRatio;
    #include <logdepthbuf_vertex>
  }`;
const FRAG = `
  uniform float uOpacity;
  varying vec3 vColor;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.0, length(c));
    gl_FragColor = vec4(vColor * a * uOpacity, a * uOpacity);
  }`;

export class RealLayerSet {
  readonly group = new THREE.Group();
  readonly entries = new Map<string, Entry>();
  private center: Vec3 = [0, 0, 0];
  private region: Region | null = null;

  private readonly K: number;
  private readonly D0: number;
  constructor(K: number, D0: number) { this.K = K; this.D0 = D0; }

  /** Add/remove layers to match the store; re-scale redshift distances to this universe's cosmology. Returns true if anything changed. */
  sync(layers: Map<string, RealLayer>, cosmo: CosmoParams): boolean {
    let changed = false;
    for (const [k, e] of this.entries) if (layers.get(k) !== e.layer) { this.remove(k); changed = true; }
    const ck = cosmoKey(cosmo);
    let chi: ((z: number) => number) | null = null;
    for (const [k, L] of layers) {
      const e = this.entries.get(k);
      if (e && (e.ckey === ck || !L.z)) continue;
      if (e) this.remove(k);
      let pos = L.pos;
      if (L.z && L.cosmoKey !== ck) {
        chi ??= chiTable(cosmo);
        pos = new Float32Array(L.pos.length);
        for (let i = 0; i < L.n; i++) {
          const x = L.pos[i * 3], y = L.pos[i * 3 + 1], z = L.pos[i * 3 + 2], d = Math.hypot(x, y, z);
          const s = d > 0 && isFinite(L.z[i]) ? chi(L.z[i]) / d : 1;
          pos[i * 3] = x * s; pos[i * 3 + 1] = y * s; pos[i * 3 + 2] = z * s;
        }
      }
      this.add(k, L, pos, ck);
      changed = true;
    }
    return changed;
  }

  private add(key: string, layer: RealLayer, pos: Float32Array, ckey: string) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(layer.rgb, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(layer.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uCenter: { value: new THREE.Vector3(...this.center) }, uIsoC: { value: new THREE.Vector3() }, uIsoR: { value: 0 },
        uK: { value: this.K }, uD0: { value: this.D0 }, uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uSizeMul: { value: 1 }, uOpacity: { value: layer.simulated ? 0.55 : 1 },
      },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = layer.simulated ? -2 : 1;
    this.group.add(points);
    this.entries.set(key, { layer, pos, points, mat, ckey });
    this.applyUniforms(this.entries.get(key)!);
  }

  private remove(key: string) {
    const e = this.entries.get(key);
    if (!e) return;
    this.group.remove(e.points);
    e.points.geometry.dispose();
    e.mat.dispose();
    this.entries.delete(key);
  }

  private applyUniforms(e: Entry) {
    const u = e.mat.uniforms;
    (u.uCenter.value as THREE.Vector3).set(...this.center);
    if (this.region) { (u.uIsoC.value as THREE.Vector3).set(...this.region.center); u.uIsoR.value = this.region.radius; }
    else u.uIsoR.value = 0;
    // a region small enough to hold one object: draw it bigger so it is easy to find
    u.uSizeMul.value = this.region && this.region.radius < 5 ? 2.2 : 1;
  }

  setCenter(c: Vec3) { this.center = [...c] as Vec3; for (const e of this.entries.values()) this.applyUniforms(e); }
  setRegion(r: Region | null) { this.region = r; for (const e of this.entries.values()) this.applyUniforms(e); }

  setVisible(f: (L: RealLayer) => boolean) { for (const e of this.entries.values()) e.points.visible = f(e.layer); }

  position(key: string, i: number): Vec3 | null {
    const e = this.entries.get(key);
    if (!e || i < 0 || i >= e.layer.n) return null;
    return [e.pos[i * 3], e.pos[i * 3 + 1], e.pos[i * 3 + 2]];
  }

  inRegion(p: Vec3): boolean {
    const r = this.region;
    return !r || Math.hypot(p[0] - r.center[0], p[1] - r.center[1], p[2] - r.center[2]) <= r.radius;
  }

  /** Nearest visible point to the cursor (CSS px), using the same map as the shader. */
  pick(proj: (p: THREE.Vector3) => { x: number; y: number; ok: boolean }, px: number, py: number, maxPx: number): { key: string; i: number } | null {
    const v = new THREE.Vector3();
    const [cx, cy, cz] = this.center;
    const r = this.region;
    let best: { key: string; i: number } | null = null, bestScore = Infinity;
    for (const [key, e] of this.entries) {
      if (!e.points.visible) continue;
      const P = e.pos, n = e.layer.n;
      const bonus = e.layer.simulated ? 6 : 0; // prefer real objects over simulated markers
      for (let i = 0; i < n; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        if (r && Math.hypot(x - r.center[0], y - r.center[1], z - r.center[2]) > r.radius) continue;
        const vx = x - cx, vy = y - cy, vz = z - cz, d = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const k = d > 0 ? (this.K * Math.log10(1 + d / this.D0)) / d : 0;
        v.set(vx * k, vz * k, -vy * k);
        const s = proj(v);
        if (!s.ok) continue;
        const dd = Math.hypot(s.x - px, s.y - py);
        if (dd > maxPx) continue;
        const score = dd + bonus - Math.min(e.layer.size[i], 9) * 0.3;
        if (score < bestScore) { bestScore = score; best = { key, i }; }
      }
    }
    return best;
  }

  count(): number { let n = 0; for (const e of this.entries.values()) if (e.points.visible) n += e.layer.n; return n; }

  categories(): Set<Category> { return new Set([...this.entries.values()].map((e) => e.layer.category)); }

  dispose() { for (const k of [...this.entries.keys()]) this.remove(k); }
}

/** How much space "show only this" keeps around an object, by what it is (ly). */
export function regionRadiusFor(type: string, category: Category | null, sizeLy?: number): number {
  if (sizeLy && sizeLy > 0) return sizeLy / 2;
  const t = type.toLowerCase();
  if (t.includes('supercluster') || category === 'superclusters') return 1e8;
  if (t.includes('void') || t.includes('wall')) return 2e8;
  if (t.includes('galaxy cluster') || t.includes('proto-cluster')) return 7e6;    // Abell radius ≈ 2.1 Mpc
  if (t.includes('group')) return 3e6;
  if (t.includes('quasar')) return 1e6;
  if (category === 'galaxies' || t.includes('galaxy')) return 3e5;               // galaxy + satellites + inner halo
  if (t.includes('globular')) return 150;
  if (category === 'clusters' || t.includes('cluster') || t.includes('moving group')) return 60;
  if (category === 'nebulae' || t.includes('nebula') || t.includes('cloud') || t.includes('h ii') || t.includes('remnant')) return 30;
  return 0.02;                                                                     // a single star / planet / compact object
}
