import * as THREE from 'three';
import type { View, FrameCtx, LabelSpec, SelectionInfo, LevelStats, InfoRow } from '../common';
import { disposeTree, sizedPointsMaterial } from '../common';
import type { PhysicsParams } from '../../sim/physics';
import { Rng, hashSeed } from '../../sim/rng';
import {
  julianDate, dateFromJD, heliocentric, moonGeocentric, eclToEq, eqToGalactic, fromRaDec, toRaDec, fmtRA, fmtDec,
  keplerHelio, PLANET_IDS, AU_LY, gmstDeg, type Vec3,
} from '../../sim/ephemeris';
import { liveStore, ago, comovingFromLuminosity, type LiveEvent } from '../../data/live';
import { CATALOG, KIND_LABEL, CMB_DIPOLE, CMB_COLD_SPOT, type CatObj } from '../../sim/skycatalog';
import { comovingDistanceLy, particleHorizonLy, lookbackGyr, zAtComovingLy, LY_PER_MPC, MPC_PER_UNIT, type CosmoParams } from '../../sim/cosmology';
import { generateGalaxy, placeNamedStars, updateGalaxy, starClass, MILKY_WAY, MW_NAMED, type GalaxyParams } from '../../sim/galaxy';
import { galaxyName, TYPE_LIST, type UniverseField } from '../../sim/universe';
import { solarSystem } from '../../sim/systems';
import { kelvinToHex, CLASS_INFO } from '../../sim/astro';
import { fmtTime } from '../../sim/laws';
import type { StarEntry } from './GalaxyView';
import { RealLayerSet, regionRadiusFor } from './RealLayers';
import { dataStore } from '../../data/store';
import { CATEGORY_LABEL, bprpToTeff, type Category, type RealLayer } from '../../data/layers';
import type { CatKind } from '../../sim/skycatalog';

// ─────────────────────────────────────────────────────────────────────────────
// Logarithmic map of the observable universe, centred on any point.
// Every object sits at its REAL direction and REAL distance d from the viewpoint;
// only the radius is compressed:  R = K · log10(1 + d / D0).
// So the Solar System, nearby stars, the Milky Way, the Local Group, superclusters,
// the cosmic web and the CMB all fit in one sphere, with directions exact.
// Positions are in light-years, galactic Cartesian frame (x → Galactic Centre,
// y → l = 90°, z → north galactic pole); scene axes = (x, z, −y).
// Distances to far objects are COMOVING (where they are "now"), not light-travel.
// ─────────────────────────────────────────────────────────────────────────────

export const MAP_K = 60;
export const MAP_D0 = 1e-6; // ly (~9.5 million km, inside Mercury's orbit)
export const mapRadius = (dLy: number) => MAP_K * Math.log10(1 + dLy / MAP_D0);
export const mapInverse = (R: number) => MAP_D0 * (Math.pow(10, R / MAP_K) - 1);

const DAYS_PER_SIM_S = 1;

export type MapAction =
  | { kind: 'galaxy'; index: number }
  | { kind: 'galaxyDef'; key: number; params: GalaxyParams }
  | { kind: 'star'; entry: StarEntry }
  | { kind: 'preset'; id: string }
  | { kind: 'solar'; bodyId?: string }
  | { kind: 'nucleus' }
  | { kind: 'host'; name: string; layerKey: string }
  | { kind: 'none' };

interface Layer {
  key: string;
  n: number;
  real: Float64Array;   // ly, galactic xyz
  disp: Float32Array;
  col: Float32Array;
  size: Float32Array;
  points: THREE.Points;
}

interface Marker { id: string; name: string; kind: string; real: Vec3; disp: THREE.Vector3; layer: 'cat' | 'sol' | 'real' | 'live'; obj?: CatObj; live?: LiveEvent; distLy: number; scale: number; cat?: Category | null; rl?: { key: string; i: number } }

/** "Show only this": a region of space around one object, or one kind of object across the whole universe. */
export type Isolation =
  | { kind: 'region'; id: string; label: string; center: Vec3; radius: number }
  | { kind: 'category'; cat: Category; label: string };

export interface SearchHit { id: string; name: string; kind: string; group: string; distLy: number }

const CATKIND_CAT: Record<CatKind, Category | null> = {
  star: 'stars', nebula: 'nebulae', cluster: 'clusters', blackhole: 'blackholes', galaxy: 'galaxies', group: 'groups', galaxycluster: 'groups',
  supercluster: 'superclusters', void: 'superclusters', wall: 'superclusters', quasar: 'quasars', highz: 'galaxies', probe: null, field: null,
};

/** Motion arrows. Values: Planck 2018 (CMB dipole); Kogut et al. 1993 (Local Group); Kashlinsky et al. 2008–10 (dark flow, disputed). */
const FLOWS = [
  { id: 'cmb', l: CMB_DIPOLE.l, b: CMB_DIPOLE.b, len: 1.2e8, color: 0xffd27f, label: 'Our motion vs the CMB · 370 km/s',
    info: 'The microwave background is 3.36 mK hotter in this direction because the Sun moves at 369.8 ± 0.1 km/s toward galactic (l, b) = (264.02°, 48.25°) relative to the CMB rest frame (Planck 2018). The arrow shows direction only; its length is not a distance.' },
  { id: 'lg', l: 276, b: 30, len: 1.2e8, color: 0x8fd8ff, label: 'Local Group vs the CMB · ≈ 627 km/s',
    info: 'After removing the Sun’s orbit in the Milky Way and the Milky Way’s motion in the Local Group, the whole Local Group moves at ≈ 627 ± 22 km/s toward (l, b) ≈ (276°, 30°) (Kogut et al. 1993) — pulled by the Great Attractor and Shapley Supercluster and pushed by the under-dense Dipole Repeller (Hoffman et al. 2017). Direction only.' },
  { id: 'dark', l: 283, b: 12, len: 2.6e9, color: 0xff7f9f, label: 'Dark flow (claimed, disputed)',
    info: 'Kashlinsky et al. (2008–2010) reported that galaxy clusters out to ≳ 800 Mpc share a bulk flow of roughly 600–1000 km/s toward (l, b) ≈ (283°, 12°), measured with the kinematic Sunyaev–Zel’dovich effect, and suggested it is caused by structure beyond the observable universe. Planck (2014) found no significant bulk flow, so it is unconfirmed and most cosmologists doubt it. Shown for reference only.' },
] as const;

function strHash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
const normName = (s: string) => s.toLowerCase().replace(/^name\s+/, '').replace(/^messier\s*/, 'm').replace(/[\s_*'’.\-()]/g, '').replace(/^(m|ngc|ic|ugc|pgc|eso|ddo|hd|hip|abell)0+(?=\d)/, '$1');

const SPEC_TEMP: Record<string, number> = { O: 38000, B: 18000, A: 8750, F: 6750, G: 5600, K: 4450, M: 3200 };
const KIND_COLOR: Record<string, number> = {
  galaxy: 0xbcd0ff, group: 0xffd88a, galaxycluster: 0xffc46a, supercluster: 0xc9a0ff, void: 0x6a6a8a, wall: 0x7fe0e8,
  quasar: 0xff7fe0, highz: 0xff6a5a, blackhole: 0xff9a5c, nebula: 0xff9ad5, cluster: 0xa8d0ff, probe: 0x7fffa0, field: 0xffffff,
};

function hexRGB(c: number): [number, number, number] { return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]; }
function eqRealLy(raDeg: number, decDeg: number, ly: number): Vec3 {
  const g = eqToGalactic(fromRaDec(raDeg, decDeg));
  return [g[0] * ly, g[1] * ly, g[2] * ly];
}
function eclAUtoGalLy(v: Vec3): Vec3 {
  const g = eqToGalactic(eclToEq(v));
  return [g[0] * AU_LY, g[1] * AU_LY, g[2] * AU_LY];
}
export function fmtLy(ly: number): string {
  if (ly < 0.01) {
    const au = ly / AU_LY;
    return au < 0.1 ? `${Math.round(au * 1.495978707e8).toLocaleString('en-US')} km` : `${au < 100 ? au.toFixed(2) : Math.round(au).toLocaleString('en-US')} AU`;
  }
  if (ly < 1e3) return `${ly < 10 ? ly.toFixed(2) : ly.toFixed(0)} ly`;
  if (ly < 1e6) return `${(ly / 1e3).toFixed(ly < 1e4 ? 2 : 1)} thousand ly`;
  if (ly < 1e9) return `${(ly / 1e6).toFixed(ly < 1e7 ? 2 : 0)} million ly`;
  return `${(ly / 1e9).toFixed(2)} billion ly`;
}

export class MapView implements View {
  readonly group = new THREE.Group();
  /** Viewpoint (real position, ly). The Sun is the origin. */
  center: Vec3 = [0, 0, 0];
  jd = julianDate(new Date());
  labelsVersion = 0;
  /** Set by the engine each frame (normal or fisheye projection → CSS pixels). */
  projector: ((p: THREE.Vector3) => { x: number; y: number; ok: boolean }) | null = null;
  camDist = 300;

  private layers = new Map<string, Layer>();
  private markers: Marker[] = [];
  private markerIndex = new Map<string, Marker>();
  private orbitLines: { line: THREE.Line; real: Float64Array }[] = [];
  private rings: { line: THREE.LineLoop; d: number; label: string; pos: THREE.Vector3 }[] = [];
  private cmb: THREE.Mesh;
  private horizon: THREE.Mesh;
  private dirty = true;
  private cosmoKey = '';

  private cmbStyle = '';
  private cmbField: Float32Array | null = null; // μK per vertex (without dipole)
  private labelSet = new Set<string>();
  private universe: UniverseField;
  private mwField: ReturnType<typeof generateGalaxy>;
  private mwSolIdx = -1;
  private webIdx: Int32Array = new Int32Array(0); // layer index → universe field index
  private solarIds: string[] = [];
  private smallBodies: { id: string; name: string; el: { a: number; e: number; i: number; w: number; O: number; M0: number } }[] = [];
  private travel: { from: Vec3; to: Vec3; eps: number; t: number; dur: number } | null = null;
  private horizonLy = 46.1e9;
  private lsLy = 45.2e9;
  private dawnLy = 35.7e9;
  private physics: PhysicsParams | null = null;
  private real = new RealLayerSet(MAP_K, MAP_D0);
  private dataVersion = -1;
  private iso: Isolation | null = null;
  private baseSizes = new Map<string, Float32Array>();
  private pointCats = new Map<string, (Category | null)[]>();
  /** Live view: locked to the real clock and to observed data only. */
  live = false;
  private liveVersion = -1;
  private liveLayer!: Layer;
  private liveIds: string[] = [];
  private skyCache = new Map<string, number>();
  private lastSolarTick = 0;
  private flows: { id: string; line: THREE.Line; real: Float64Array; tip: THREE.Vector3; label: string; info: string }[] = [];

  constructor(universe: UniverseField, cosmo: CosmoParams) {
    this.universe = universe;
    this.mwField = generateGalaxy(MILKY_WAY, 1);
    const named = placeNamedStars(this.mwField, MW_NAMED);
    for (const [idx, n] of named) if (n.id === 'sol') this.mwSolIdx = idx;
    updateGalaxy(this.mwField, 0); // recompute positions now that the named stars (incl. the Sun) are placed

    this.buildSolar();
    this.buildOrbits();
    this.buildSmallBodyClouds();
    this.buildNeighbourhood();
    this.buildMilkyWay();
    this.buildStructures(cosmo);
    this.buildWeb(cosmo);
    this.buildRings();
    this.buildFlows();
    this.liveLayer = this.makeLayer('live', 256);
    this.group.add(this.real.group);
    this.cmb = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 80), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false }));
    this.cmb.renderOrder = -10;
    this.group.add(this.cmb);
    this.horizon = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.MeshBasicMaterial({ color: 0x9a92d9, wireframe: true, transparent: true, opacity: 0.05, depthWrite: false }));
    this.group.add(this.horizon);
    this.setCosmology(cosmo);
    this.colorCMB(false, 'deep', 0.35);
    this.remap();
  }

  // ───────────────────────── construction ─────────────────────────

  private makeLayer(key: string, n: number, opacity = 1): Layer {
    const l: Layer = {
      key, n, real: new Float64Array(n * 3), disp: new Float32Array(n * 3), col: new Float32Array(n * 3), size: new Float32Array(n),
      points: new THREE.Points(new THREE.BufferGeometry(), sizedPointsMaterial(opacity)),
    };
    l.points.geometry.setAttribute('position', new THREE.BufferAttribute(l.disp, 3));
    l.points.geometry.setAttribute('aColor', new THREE.BufferAttribute(l.col, 3));
    l.points.geometry.setAttribute('aSize', new THREE.BufferAttribute(l.size, 1));
    l.points.frustumCulled = false;
    this.layers.set(key, l);
    this.group.add(l.points);
    return l;
  }

  private buildSolar() {
    const sol = solarSystem();
    for (const b of sol.bodies) if (b.kepler) this.smallBodies.push({ id: b.id, name: b.name, el: b.kepler });
    this.solarIds = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', ...this.smallBodies.map((s) => s.id)];
    const L = this.makeLayer('solar', this.solarIds.length);
    const colors: Record<string, number> = { sun: 0xffe2a0, mercury: 0xb8aaa0, venus: 0xf2dca0, earth: 0x6fb0ff, moon: 0xd8d8d0, mars: 0xff8a5c, jupiter: 0xf0c890, saturn: 0xf0dca8, uranus: 0xa8e8ee, neptune: 0x7f9fff };
    const sizes: Record<string, number> = { sun: 22, jupiter: 9, saturn: 8.5, earth: 7.5, venus: 7, mars: 6.5, uranus: 6.5, neptune: 6.5, mercury: 5.5, moon: 5 };
    this.solarIds.forEach((id, i) => {
      const c = hexRGB(colors[id] ?? 0xc9b8a8);
      L.col.set(c, i * 3);
      L.size[i] = sizes[id] ?? 4.5;
      const name = id === 'sun' ? 'Sun' : id === 'earth' ? 'Earth' : id === 'moon' ? 'Moon' : sol.bodies.find((b) => b.id === id)?.name ?? id;
      const m: Marker = { id: `sol:${id}`, name, kind: id === 'sun' ? 'Star' : id === 'moon' ? 'Moon' : this.smallBodies.some((s) => s.id === id) ? 'Dwarf planet / small body' : 'Planet', real: [0, 0, 0], disp: new THREE.Vector3(), layer: 'sol', distLy: 0, scale: id === 'sun' ? 2e-4 : 3e-5 };
      this.markers.push(m);
      this.markerIndex.set(m.id, m);
    });
    this.updateSolar();
  }

  private updateSolar() {
    const L = this.layers.get('solar')!;
    const earthEcl = heliocentric('earth', this.jd);
    const pos = (id: string): Vec3 => {
      if (id === 'sun') return [0, 0, 0];
      if (id === 'earth') return eclAUtoGalLy(earthEcl);
      if (id === 'moon') {
        const m = moonGeocentric(this.jd); // equatorial AU
        const g = eqToGalactic(m), e = eclAUtoGalLy(earthEcl);
        return [e[0] + g[0] * AU_LY, e[1] + g[1] * AU_LY, e[2] + g[2] * AU_LY];
      }
      if ((PLANET_IDS as readonly string[]).includes(id)) return eclAUtoGalLy(heliocentric(id, this.jd));
      const sb = this.smallBodies.find((s) => s.id === id)!;
      const k = sb.el;
      return eclAUtoGalLy(keplerHelio(k.a, k.e, k.i, k.w, k.O, k.M0, this.jd));
    };
    this.solarIds.forEach((id, i) => {
      const p = pos(id);
      L.real[i * 3] = p[0]; L.real[i * 3 + 1] = p[1]; L.real[i * 3 + 2] = p[2];
      const m = this.markerIndex.get(`sol:${id}`)!;
      m.real = p;
      m.distLy = Math.hypot(p[0], p[1], p[2]);
    });
    this.remapLayer(L);
    for (const m of this.markers) if (m.layer === 'sol') this.mapPoint(m.real, m.disp);
  }

  private buildOrbits() {
    const T = this.jd;
    const sample = (fn: (jd: number) => Vec3, periodDays: number, n = 256) => {
      const real = new Float64Array(n * 3);
      for (let k = 0; k < n; k++) { const p = eclAUtoGalLy(fn(T + (periodDays * k) / n)); real.set(p, k * 3); }
      return real;
    };
    const periods: Record<string, number> = { mercury: 87.969, venus: 224.701, earth: 365.256, mars: 686.98, jupiter: 4332.59, saturn: 10759.22, uranus: 30688.5, neptune: 60182 };
    for (const id of [...PLANET_IDS.slice(0, 2), 'earth', ...PLANET_IDS.slice(2)]) {
      this.addOrbit(sample((jd) => heliocentric(id, jd), periods[id]), id === 'earth' ? 0x6fb0ff : 0x8642ff);
    }
    for (const sb of this.smallBodies) {
      const k = sb.el;
      this.addOrbit(sample((jd) => keplerHelio(k.a, k.e, k.i, k.w, k.O, k.M0, jd), 365.25 * Math.pow(k.a, 1.5), 512), 0x5a5a8a);
    }
  }

  private addOrbit(real: Float64Array, color: number) {
    const n = real.length / 3;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }));
    line.frustumCulled = false;
    this.group.add(line);
    this.orbitLines.push({ line, real });
  }

  /** Asteroid belt, Kuiper belt and Oort cloud at their real distances (illustrative samples). */
  private buildSmallBodyClouds() {
    const rng = new Rng(4242);
    const nMain = 2500, nKuiper = 3000, nOort = 5000;
    const L = this.makeLayer('belts', nMain + nKuiper + nOort, 0.7);
    let i = 0;
    const put = (eclAU: Vec3, c: [number, number, number], s: number) => {
      L.real.set(eclAUtoGalLy(eclAU), i * 3); L.col.set(c, i * 3); L.size[i] = s; i++;
    };
    for (let k = 0; k < nMain; k++) {
      const a = rng.range(2.1, 3.3), t = rng.range(0, Math.PI * 2), inc = rng.gauss() * 0.12;
      put([a * Math.cos(t), a * Math.sin(t), a * Math.sin(inc)], [0.7, 0.62, 0.55], 1.6);
    }
    for (let k = 0; k < nKuiper; k++) {
      const a = rng.chance(0.25) ? 39.4 + rng.gauss() * 0.4 : rng.range(42, 48), t = rng.range(0, Math.PI * 2), inc = rng.gauss() * 0.12;
      put([a * Math.cos(t), a * Math.sin(t), a * Math.sin(inc)], [0.55, 0.65, 0.85], 1.6);
    }
    for (let k = 0; k < nOort; k++) {
      const r = rng.logRange(2000, 100000), u = rng.range(-1, 1), t = rng.range(0, Math.PI * 2), s = Math.sqrt(1 - u * u);
      put([r * s * Math.cos(t), r * s * Math.sin(t), r * u], [0.45, 0.55, 0.75], 1.4);
    }
  }

  /** Sample of the solar neighbourhood (real local density ≈ 0.14 stars / pc³; spectral mix ≈ 75 % M dwarfs). */
  private buildNeighbourhood() {
    const rng = new Rng(1729);
    const n = 2500;
    const L = this.makeLayer('local', n);
    for (let i = 0; i < n; i++) {
      const r = 6 + 300 * Math.cbrt(rng.next()), u = rng.range(-1, 1), t = rng.range(0, Math.PI * 2), s = Math.sqrt(1 - u * u);
      L.real.set([r * s * Math.cos(t), r * s * Math.sin(t), r * u * 0.6], i * 3);
      const cls = 'MMMMMMKKGFA'[Math.floor(rng.next() * 11)];
      L.col.set(hexRGB(kelvinToHex(SPEC_TEMP[cls])).map((v) => v * 0.8) as [number, number, number], i * 3);
      L.size[i] = cls === 'M' ? 1.6 : 2.2;
    }
    // catalog stars, clusters & nearby objects (markers)
    const cat = CATALOG.filter((o) => o.ly !== undefined && o.ly < 1e5 && o.kind !== 'probe' && o.kind !== 'galaxy');
    const C = this.makeLayer('catNear', cat.length);
    this.pointCats.set('catNear', cat.map((o) => CATKIND_CAT[o.kind]));
    cat.forEach((o, i) => {
      const p = eqRealLy(o.ra, o.dec, o.ly!);
      C.real.set(p, i * 3);
      const t = o.kind === 'star' ? SPEC_TEMP[o.spec?.[0] ?? 'G'] ?? 5600 : 0;
      C.col.set(hexRGB(t ? kelvinToHex(t) : KIND_COLOR[o.kind] ?? 0xffffff), i * 3);
      C.size[i] = o.kind === 'star' ? Math.min(Math.max(10 - 1.4 * (o.mag ?? 5), 4), 14) : 7;
      this.addCatMarker(o, p);
    });
  }

  private addCatMarker(o: CatObj, p: Vec3) {
    const m: Marker = { id: `cat:${o.id}`, name: o.name, kind: KIND_LABEL[o.kind], real: p, disp: new THREE.Vector3(), layer: 'cat', obj: o, cat: CATKIND_CAT[o.kind], distLy: Math.hypot(...p), scale: Math.max((o.sizeLy ?? 0) / 2, Math.hypot(...p) * 1e-3, 1e-5) };
    this.markers.push(m);
    this.markerIndex.set(m.id, m);
  }

  /** The Milky Way, seen from the Sun's real position 8.2 kpc from the centre. */
  private buildMilkyWay() {
    const f = this.mwField;
    const extra = f.youngCount;
    const L = this.makeLayer('mw', f.count + extra, 0.9);
    const KPC_LY = 3261.56;
    const s = this.mwSolIdx;
    const sx = f.positions[s * 3], sy = f.positions[s * 3 + 1], sz = f.positions[s * 3 + 2];
    const th = Math.atan2(sz, sx);
    // galactic axes in the galaxy's scene frame (derived in galaxy.ts: rotation is clockwise from +y = NGP)
    const xg = [-Math.cos(th), 0, -Math.sin(th)], yg = [-Math.sin(th), 0, Math.cos(th)];
    const put = (i: number, px: number, py: number, pz: number) => {
      const vx = (px - sx) * f.unitKpc * KPC_LY, vy = (py - sy) * f.unitKpc * KPC_LY, vz = (pz - sz) * f.unitKpc * KPC_LY;
      L.real[i * 3] = vx * xg[0] + vz * xg[2];
      L.real[i * 3 + 1] = vx * yg[0] + vz * yg[2];
      L.real[i * 3 + 2] = vy;
    };
    for (let i = 0; i < f.count; i++) {
      put(i, f.positions[i * 3], f.positions[i * 3 + 1], f.positions[i * 3 + 2]);
      L.col[i * 3] = f.colors[i * 3] * 0.8; L.col[i * 3 + 1] = f.colors[i * 3 + 1] * 0.8; L.col[i * 3 + 2] = f.colors[i * 3 + 2] * 0.8;
      L.size[i] = i === s ? 0 : 1.7;
    }
    for (let j = 0; j < extra; j++) {
      const i = f.count + j;
      put(i, f.youngPositions[j * 3], f.youngPositions[j * 3 + 1], f.youngPositions[j * 3 + 2]);
      L.col.set([f.youngColors[j * 3], f.youngColors[j * 3 + 1], f.youngColors[j * 3 + 2]], i * 3);
      L.size[i] = 2.2;
    }
    // the Sun's own sim star sits exactly at the origin: hide it; the real Sun is in the solar layer
    // drop procedural stars closer than the real neighbourhood sample covers
    for (let i = 0; i < f.count + extra; i++) {
      if (Math.hypot(L.real[i * 3], L.real[i * 3 + 1], L.real[i * 3 + 2]) < 300) L.size[i] = 0;
    }
  }

  /** Galaxies, clusters, superclusters and walls at their real positions (members around them are procedural). */
  private buildStructures(cosmo: CosmoParams) {
    const far = CATALOG.filter((o) => (o.ly === undefined || o.ly >= 1e5 || o.kind === 'galaxy' || o.kind === 'probe'));
    const rng = new Rng(777);
    const members: { p: Vec3; c: [number, number, number]; s: number }[] = [];
    const M = this.makeLayer('catFar', far.length);
    this.pointCats.set('catFar', far.map((o) => CATKIND_CAT[o.kind]));
    far.forEach((o, i) => {
      const ly = o.ly ?? comovingDistanceLy(o.z ?? 0, cosmo);
      const p = eqRealLy(o.ra, o.dec, ly);
      M.real.set(p, i * 3);
      M.col.set(hexRGB(KIND_COLOR[o.kind] ?? 0xffffff), i * 3);
      M.size[i] = o.kind === 'galaxy' ? Math.min(Math.max(12 - 0.8 * (o.mag ?? 9), 5), 11) : o.kind === 'supercluster' ? 10 : o.kind === 'probe' ? 6 : 8;
      this.addCatMarker(o, p);
      const size = o.sizeLy ?? 0;
      const add = (n: number, spread: (k: number) => Vec3, c: number, s: number) => {
        for (let k = 0; k < n; k++) { const q = spread(k); members.push({ p: [p[0] + q[0], p[1] + q[1], p[2] + q[2]], c: hexRGB(c).map((v) => v * (0.5 + rng.next() * 0.5)) as [number, number, number], s }); }
      };
      const gauss3 = (sig: number): Vec3 => [rng.gauss() * sig, rng.gauss() * sig, rng.gauss() * sig];
      if (o.kind === 'galaxycluster') add(160, () => gauss3(size / 4), 0xffd8a0, 2.2);
      else if (o.kind === 'supercluster') {
        // filaments radiating from the core
        const arms = Array.from({ length: 7 }, () => { const u = rng.range(-1, 1), t = rng.range(0, 6.283), s = Math.sqrt(1 - u * u); return [s * Math.cos(t), s * Math.sin(t), u]; });
        add(420, () => { const a = rng.pick(arms), r = rng.next() * size / 2; const j = gauss3(size / 30); return [a[0] * r + j[0], a[1] * r + j[1], a[2] * r + j[2]]; }, 0xd8c0ff, 2);
      } else if (o.kind === 'wall') {
        if (o.id === 'sloanwall') add(700, () => { const q = eqRealLy(rng.range(140, 225), rng.range(-4, 6), rng.range(0.95e9, 1.1e9)); return [q[0] - p[0], q[1] - p[1], q[2] - p[2]]; }, 0x9fe8f0, 2);
        else if (o.id === 'cfa2wall') add(600, () => { const q = eqRealLy(rng.range(135, 255), rng.range(20, 40), rng.range(2.8e8, 3.6e8)); return [q[0] - p[0], q[1] - p[1], q[2] - p[2]]; }, 0x9fe8f0, 2);
        else add(400, () => { const q = eqRealLy(o.ra + rng.gauss() * 25, o.dec + rng.gauss() * 18, ly * (1 + rng.gauss() * 0.08)); return [q[0] - p[0], q[1] - p[1], q[2] - p[2]]; }, 0x6fa8b0, 1.6);
      }
    });
    const S = this.makeLayer('members', members.length, 0.8);
    members.forEach((m, i) => { S.real.set(m.p, i * 3); S.col.set(m.c, i * 3); S.size[i] = m.s; });
  }

  /** Procedural cosmic web (the simulator's universe field), cut off where galaxies had not yet formed. */
  private buildWeb(cosmo: CosmoParams) {
    const f = this.universe;
    const lyPerUnit = MPC_PER_UNIT * LY_PER_MPC;
    this.dawnLy = comovingDistanceLy(20, cosmo);
    // z(χ) lookup for colouring, built from this universe's cosmology
    const zs = [0, 0.05, 0.1, 0.2, 0.4, 0.6, 1, 1.5, 2, 3, 5, 8, 12, 16, 20];
    const ds = zs.map((z) => comovingDistanceLy(z, cosmo));
    const zFast = (ly: number) => {
      for (let k = 0; k < zs.length - 1; k++) if (ly <= ds[k + 1]) return zs[k] + ((ly - ds[k]) / (ds[k + 1] - ds[k])) * (zs[k + 1] - zs[k]);
      return 20;
    };
    const keep: number[] = [];
    for (let i = 4; i < f.count; i++) { // 0–3 are the named galaxies, placed for real above
      const d = Math.hypot(f.comoving[i * 3], f.comoving[i * 3 + 1], f.comoving[i * 3 + 2]) * lyPerUnit;
      if (d > 3e8 && d < this.dawnLy) keep.push(i);
    }
    const L = this.makeLayer('web', keep.length, 0.95);
    this.webIdx = Int32Array.from(keep);
    keep.forEach((gi, i) => {
      L.real[i * 3] = f.comoving[gi * 3] * lyPerUnit;
      L.real[i * 3 + 1] = f.comoving[gi * 3 + 1] * lyPerUnit;
      L.real[i * 3 + 2] = f.comoving[gi * 3 + 2] * lyPerUnit;
      const d = Math.hypot(L.real[i * 3], L.real[i * 3 + 1], L.real[i * 3 + 2]);
      const z = Math.max(zFast(d), 0);
      // cosmological redshift reddens and dims distant galaxies (colour shift indicative only)
      const red = Math.min(z / 6, 1), dim = 1 / (1 + z) ** 0.6;
      L.col[i * 3] = (f.colors[gi * 3] * (1 - red) + red) * dim;
      L.col[i * 3 + 1] = f.colors[gi * 3 + 1] * (1 - red * 0.7) * dim;
      L.col[i * 3 + 2] = f.colors[gi * 3 + 2] * (1 - red) * dim;
      L.size[i] = 2.6;
    });
  }

  private buildRings() {
    const list: [number, string][] = [[AU_LY, '1 AU'], [100 * AU_LY, '100 AU'], [1, '1 light-year'], [100, '100 ly'], [1e4, '10 000 ly'], [1e6, '1 million ly'], [1e8, '100 million ly'], [1e10, '10 billion ly']];
    for (const [d, label] of list) {
      const n = 128, geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0x9a92d9, transparent: true, opacity: 0.06, depthWrite: false }));
      line.frustumCulled = false;
      this.group.add(line);
      this.rings.push({ line, d, label, pos: new THREE.Vector3() });
    }
  }

  private buildFlows() {
    for (const f of FLOWS) {
      const dir = fromGalacticVec(f.l, f.b), n = 72;
      const real = new Float64Array(n * 3);
      for (let k = 1; k < n; k++) { const d = AU_LY * Math.pow(f.len / AU_LY, (k - 1) / (n - 2)); real.set([dir[0] * d, dir[1] * d, dir[2] * d], k * 3); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: f.color, transparent: true, opacity: 0.75, depthWrite: false, depthTest: false }));
      line.frustumCulled = false;
      this.group.add(line);
      this.flows.push({ id: `flow:${f.id}`, line, real, tip: new THREE.Vector3(), label: `→ ${f.label}`, info: f.info });
    }
  }

  // ───────────────────────── mapping ─────────────────────────

  private mapPoint(p: Vec3 | Float64Array, out: THREE.Vector3, o = 0) {
    const vx = p[o] - this.center[0], vy = p[o + 1] - this.center[1], vz = p[o + 2] - this.center[2];
    const d = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (d < 1e-15) { out.set(0, 0, 0); return; }
    const k = mapRadius(d) / d;
    out.set(vx * k, vz * k, -vy * k);
  }

  private remapLayer(L: Layer) {
    const cx = this.center[0], cy = this.center[1], cz = this.center[2];
    const r = L.real, o = L.disp;
    for (let i = 0; i < L.n; i++) {
      const vx = r[i * 3] - cx, vy = r[i * 3 + 1] - cy, vz = r[i * 3 + 2] - cz;
      const d = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const k = d < 1e-15 ? 0 : (MAP_K * Math.log10(1 + d / MAP_D0)) / d;
      o[i * 3] = vx * k; o[i * 3 + 1] = vz * k; o[i * 3 + 2] = -vy * k;
    }
    (L.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  private remap() {
    for (const L of this.layers.values()) this.remapLayer(L);
    for (const m of this.markers) this.mapPoint(m.real, m.disp);
    const v = new THREE.Vector3();
    for (const o of this.orbitLines) {
      const arr = (o.line.geometry.getAttribute('position') as THREE.BufferAttribute);
      for (let k = 0; k < o.real.length / 3; k++) { this.mapPoint(o.real, v, k * 3); arr.setXYZ(k, v.x, v.y, v.z); }
      arr.needsUpdate = true;
    }
    for (const f of this.flows) {
      const arr = f.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < arr.count; k++) { this.mapPoint(f.real, v, k * 3); arr.setXYZ(k, v.x, v.y, v.z); }
      arr.needsUpdate = true;
      f.tip.set(arr.getX(arr.count - 1), arr.getY(arr.count - 1), arr.getZ(arr.count - 1));
    }
    this.real.setCenter(this.center);
    for (const r of this.rings) {
      const R = mapRadius(r.d), arr = r.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < arr.count; k++) { const t = (k / arr.count) * Math.PI * 2; arr.setXYZ(k, R * Math.cos(t), 0, R * Math.sin(t)); }
      arr.needsUpdate = true;
      r.pos.set(R * Math.SQRT1_2, 0, R * Math.SQRT1_2);
    }
    this.dirty = false;
  }

  setCosmology(p: CosmoParams) {
    const key = `${p.H0}:${p.omegaM}:${p.omegaL}:${p.gMult ?? 1}`;
    if (key === this.cosmoKey) return;
    this.cosmoKey = key;
    this.dataVersion = -1; // redshift distances of real catalogues depend on the cosmology
    this.horizonLy = particleHorizonLy(p);
    this.lsLy = comovingDistanceLy(1090, p);
    this.cmb.scale.setScalar(mapRadius(this.lsLy));
    this.horizon.scale.setScalar(mapRadius(this.horizonLy));
  }

  /** Statistically CMB-like anisotropies (NOT the real Planck map) + optional real dipole and Cold Spot. */
  colorCMB(dipole: boolean, palette: string, brightness: number, realOnly = false) {

    this.cmbStyle = `${dipole && !realOnly ? dipole : this.physics?.mapDipole ?? dipole}:${palette}:${brightness.toFixed(3)}:${realOnly}`;
    const geo = this.cmb.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    if (!this.cmbField) {
      const rng = new Rng(2725);
      const waves = Array.from({ length: 360 }, () => {
        const u = rng.range(-1, 1), t = rng.range(0, 6.283), s2 = Math.sqrt(1 - u * u);
        const ell = Math.round(rng.logRange(4, 90));
        return { n: [s2 * Math.cos(t), s2 * Math.sin(t), u], k: ell, ph: rng.range(0, 6.283), a: 1 / Math.sqrt(ell) };
      });
      const cold = fromGalacticVec(CMB_COLD_SPOT.l, CMB_COLD_SPOT.b);
      const vals = new Float32Array(pos.count);
      let sum2 = 0;
      for (let i = 0; i < pos.count; i++) {
        const gx = pos.getX(i), gy = -pos.getZ(i), gz = pos.getY(i); // scene → galactic
        let v = 0;
        for (const w of waves) v += w.a * Math.cos(w.k * (gx * w.n[0] + gy * w.n[1] + gz * w.n[2]) + w.ph);
        vals[i] = v; sum2 += v * v;
      }
      const rms = Math.sqrt(sum2 / pos.count) || 1;
      for (let i = 0; i < pos.count; i++) {
        const gx = pos.getX(i), gy = -pos.getZ(i), gz = pos.getY(i);
        vals[i] = (vals[i] / rms) * 70; // anisotropy rms ≈ 70 μK at sub-degree resolution
        if (gx * cold[0] + gy * cold[1] + gz * cold[2] > Math.cos((5 * Math.PI) / 180)) vals[i] -= 70;
      }
      this.cmbField = vals;
    }
    const dip = fromGalacticVec(CMB_DIPOLE.l, CMB_DIPOLE.b);
    const col = new Float32Array(pos.count * 3);
    const range = dipole ? 3500 : 300;
    for (let i = 0; i < pos.count; i++) {
      let uK = realOnly ? 0 : this.cmbField[i]; // live view: only the measured dipole, not the illustrative pattern
      if (dipole) uK += CMB_DIPOLE.amplitudeUK * (pos.getX(i) * dip[0] + -pos.getZ(i) * dip[1] + pos.getY(i) * dip[2]);
      const c = cmbColor(Math.max(-1, Math.min(1, uK / range)), palette);
      col[i * 3] = c[0] * brightness; col[i * 3 + 1] = c[1] * brightness; col[i * 3 + 2] = c[2] * brightness;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }

  // ───────────────────────── frame ─────────────────────────

  update(ctx: FrameCtx) {
    const p = ctx.physics;
    this.physics = p;
    this.setCosmology({ H0: p.H0, omegaM: p.omegaM, omegaL: p.omegaL, gMult: p.gMult });
    const style = `${p.mapDipole}:${p.cmbPalette}:${p.cmbBrightness.toFixed(3)}`;
    if (`${style}:${this.live}` !== this.cmbStyle) this.colorCMB(p.mapDipole || this.live, p.cmbPalette, p.cmbBrightness, this.live);
    if (this.live) {
      // real clock: positions for this very moment
      const now = performance.now();
      if (now - this.lastSolarTick > 250) { this.lastSolarTick = now; this.jd = julianDate(new Date()); this.updateSolar(); }
    } else if (ctx.simDt !== 0) { this.jd += ctx.simDt * DAYS_PER_SIM_S; this.updateSolar(); }
    this.updateStarEpoch();
    if (liveStore.version !== this.liveVersion) this.syncLive();
    this.updateLive(p);
    if (this.travel) {
      const t = this.travel;
      t.t = Math.min(t.t + ctx.dtReal / t.dur, 1);
      const s = t.t < 0.5 ? 4 * t.t ** 3 : 1 - (-2 * t.t + 2) ** 3 / 2;
      const D = Math.hypot(t.to[0] - t.from[0], t.to[1] - t.from[1], t.to[2] - t.from[2]);
      const r = D * Math.pow(t.eps / Math.max(D, 1e-30), s); // log-uniform approach
      const u = D > 0 ? [(t.to[0] - t.from[0]) / D, (t.to[1] - t.from[1]) / D, (t.to[2] - t.from[2]) / D] : [0, 0, 0];
      this.center = [t.to[0] - u[0] * r, t.to[1] - u[1] * r, t.to[2] - u[2] * r];
      this.dirty = true;
      if (t.t >= 1) this.travel = null;
    }
    if (dataStore.version !== this.dataVersion) this.syncData();
    if (this.dirty) this.remap();
    const show = (k: string, on: boolean) => { const L = this.layers.get(k); if (L) L.points.visible = on; };
    const iso = this.iso, catMode = iso?.kind === 'category', proc = !catMode;
    const made = proc && !this.live; // procedural layers never appear in the live view
    show('solar', proc); show('belts', proc && p.mapSolar); show('local', made && p.mapStars); show('catNear', p.mapStars || catMode);
    show('mw', made && p.mapMilkyWay); show('catFar', p.mapGalaxies || catMode); show('members', made && p.mapStructures); show('web', made && p.mapWeb);
    show('live', proc && p.mapLive);
    const sunIn = !iso || (iso.kind === 'region' && Math.hypot(...iso.center) <= iso.radius);
    for (const o of this.orbitLines) o.line.visible = p.mapSolar && sunIn;
    for (const r of this.rings) r.line.visible = p.mapRings;
    for (const f of this.flows) f.line.visible = p.mapFlows && !iso && !(this.live && f.id === 'flow:dark');
    this.real.setVisible((L) => (L.simulated ? p.mapSimulated && !this.live : p.mapReal) && (!catMode || L.category === (iso as { cat: Category }).cat));
    this.cmb.visible = p.mapCMB && !iso;
    const inside = this.camDist < this.cmb.scale.x;
    (this.cmb.material as THREE.MeshBasicMaterial).opacity = inside ? 1 : 0.25;
    this.updateLabelSet();
  }

  /** Move the viewpoint through real space (direction in scene axes, distance in ly). */
  travelBy(dir: THREE.Vector3, ly: number) {
    this.travel = null;
    this.center = [this.center[0] + dir.x * ly, this.center[1] - dir.z * ly, this.center[2] + dir.y * ly];
    this.dirty = true;
  }

  /** Real distance scale represented by a display radius (what "zoom level" means here). */
  scaleAt(R: number) { return mapInverse(R); }

  flyTo(id: string): number | null {
    const t = this.targetOf(id);
    if (!t) return null;
    const eps = Math.max(t.scale, 1e-7);
    this.travel = { from: [...this.center] as Vec3, to: t.real, eps, t: 0, dur: 2.8 };
    return eps;
  }

  resetCenter() { this.travel = { from: [...this.center] as Vec3, to: [0, 0, 0], eps: 1e-9, t: 0, dur: 2.2 }; }
  isAtSun() { return Math.hypot(...this.center) < 1e-7; }

  private targetOf(id: string): { real: Vec3; scale: number } | null {
    const m = this.markerIndex.get(id);
    if (m) return { real: m.real, scale: m.scale };
    if (id.startsWith('live:')) return null;
    if (id.startsWith('rl:')) {
      const r = parseRl(id), p = this.real.position(r.key, r.i), L = this.real.entries.get(r.key)?.layer;
      if (!p || !L) return null;
      const d = Math.hypot(...p);
      return { real: p, scale: Math.max(regionRadiusFor(L.types[r.i], L.category) * 0.3, d * 1e-3, 1e-5) };
    }
    if (id.startsWith('flow:')) return null;
    const L = id.startsWith('web:') ? this.layers.get('web') : id.startsWith('mw:') ? this.layers.get('mw') : null;
    if (!L) return null;
    const i = Number(id.split(':')[1]);
    return { real: [L.real[i * 3], L.real[i * 3 + 1], L.real[i * 3 + 2]], scale: id.startsWith('web:') ? 5e4 : 0.5 };
  }

  // ───────────────────────── View interface ─────────────────────────

  pick(nx: number, ny: number, cam: THREE.PerspectiveCamera, w: number, h: number): string | null {
    const px = ((nx + 1) / 2) * w, py = ((1 - ny) / 2) * h;
    const proj = this.projector ?? ((v: THREE.Vector3) => { const q = v.clone().project(cam); return { x: ((q.x + 1) / 2) * w, y: ((1 - q.y) / 2) * h, ok: q.z < 1 }; });
    let best: string | null = null, bestD = 16;
    for (const m of this.markers) {
      if (!this.markerVisible(m)) continue;
      const s = proj(m.disp);
      if (!s.ok) continue;
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < bestD) { bestD = d; best = m.id; }
    }
    if (best) return best;
    const hit = this.real.pick(proj, px, py, 10);
    if (hit) return `rl:${hit.key}:${hit.i}`;
    const v = new THREE.Vector3();
    for (const [key, prefix, lim] of [['web', 'web', 9], ['mw', 'mw', 6]] as const) {
      const L = this.layers.get(key);
      if (!L || !L.points.visible) continue;
      let bi = -1, bd: number = lim;
      for (let i = 0; i < L.n; i++) {
        if (L.size[i] === 0) continue;
        v.set(L.disp[i * 3], L.disp[i * 3 + 1], L.disp[i * 3 + 2]);
        const s = proj(v);
        if (!s.ok) continue;
        const d = Math.hypot(s.x - px, s.y - py);
        if (d < bd) { bd = d; bi = i; }
      }
      if (bi >= 0) return `${prefix}:${bi}`;
    }
    return null;
  }

  target(id: string, out: THREE.Vector3): number | null {
    const f = this.flows.find((x) => x.id === id);
    if (f) { out.copy(f.tip); return 1; }
    const m = this.markerIndex.get(id);
    if (m) { out.copy(m.disp); return 1.2; }
    const t = this.targetOf(id);
    if (!t) return null;
    this.mapPoint(t.real, out);
    return 1;
  }

  private passesIso(m: Marker): boolean {
    const iso = this.iso;
    if (!iso) return true;
    if (iso.kind === 'category') return m.cat === iso.cat;
    return m.id === iso.id || Math.hypot(m.real[0] - iso.center[0], m.real[1] - iso.center[1], m.real[2] - iso.center[2]) <= iso.radius;
  }

  private markerVisible(m: Marker): boolean {
    const p = this.physics;
    if (!p) return true;
    if (!this.passesIso(m)) return false;
    if (m.layer === 'real') { const e = this.real.entries.get(m.rl!.key); return !!e && e.points.visible; }
    if (m.layer === 'live') return p.mapLive && m.live!.kind !== 'flare' && this.liveValid(m.live!);
    if (m.layer === 'sol') return true;
    if (m.obj?.kind === 'probe' && liveStore.events.has('sc:-31')) return false; // the live position replaces the fixed one
    if (this.iso) return true;
    const k = m.obj!.kind;
    if (k === 'star' || k === 'cluster' || k === 'nebula' || k === 'blackhole') return m.distLy < 1e5 ? p.mapStars : true;
    return p.mapGalaxies;
  }

  private infoRows(real: Vec3, extra: InfoRow[] = []): InfoRow[] {
    const dSun = Math.hypot(...real);
    const rows: InfoRow[] = [];
    rows.push({ k: 'Distance from the Sun', v: fmtLy(dSun) });
    if (!this.isAtSun()) rows.push({ k: 'Distance from viewpoint', v: fmtLy(Math.hypot(real[0] - this.center[0], real[1] - this.center[1], real[2] - this.center[2])) });
    if (dSun > 1e-9) {
      const eq = galToEq(real);
      const rd = toRaDec(eq);
      rows.push({ k: 'Sky position (RA, Dec)', v: `${fmtRA(rd.ra)}  ${fmtDec(rd.dec)}` });
      let l = Math.atan2(real[1], real[0]) * 57.29578; if (l < 0) l += 360;
      rows.push({ k: 'Galactic l, b', v: `${l.toFixed(1)}°, ${(Math.asin(real[2] / dSun) * 57.29578).toFixed(1)}°` });
    }
    return [...rows, ...extra];
  }

  info(id: string): SelectionInfo | null {
    const cosmo = this.cosmoParams();
    if (id.startsWith('live:')) return this.liveInfo(id);
    if (id.startsWith('rl:')) return this.realInfo(id);
    if (id.startsWith('flow:')) {
      const f = this.flows.find((x) => x.id === id);
      return f ? { id, name: f.label.replace('→ ', ''), kind: id === 'flow:dark' ? 'Claimed bulk flow (unconfirmed)' : 'Measured motion', info: f.info, rows: [], enterLabel: null, editable: false } : null;
    }
    const m = this.markerIndex.get(id);
    if (m && m.layer === 'sol') {
      const bodyId = id.slice(4);
      const earth = this.markerIndex.get('sol:earth')!.real;
      const fromEarth = Math.hypot(m.real[0] - earth[0], m.real[1] - earth[1], m.real[2] - earth[2]);
      const rows = this.infoRows(m.real, bodyId === 'earth' ? [] : [
        { k: 'Distance from Earth', v: fmtLy(fromEarth) },
        { k: 'Light takes', v: fmtTime(fromEarth * 3.15576e7) },
      ]);
      rows.push({ k: 'Date (positions)', v: dateFromJD(this.jd).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' });
      if (bodyId === 'sun') {
        const fl = liveStore.list('flare')[0];
        if (liveStore.solar.xray) rows.push({ k: 'X-ray level now (GOES)', v: liveStore.solar.xray });
        if (fl) rows.push({ k: 'Latest flare', v: `${fl.name.replace(' solar flare', '')} · ${ago(fl.time)}` });
      }
      return {
        id, name: m.name, kind: m.kind,
        info: bodyId === 'sun' ? 'Our star. Everything in this map is placed by its real direction and distance from here; only the radius is compressed logarithmically.'
          : bodyId === 'moon' || (PLANET_IDS as readonly string[]).includes(bodyId) || bodyId === 'earth' ? 'Real position for the date shown (JPL approximate elements; Moon from Schlyter’s theory).'
          : 'Real orbital elements; current position along the orbit is illustrative.',
        rows, enterLabel: 'Open the Solar System', travelLabel: 'Fly here', editable: false,
      };
    }
    if (m && m.obj) {
      const o = m.obj;
      const extra: InfoRow[] = [];
      if (o.z !== undefined && o.ly === undefined) {
        extra.push({ k: 'Redshift z', v: o.z.toFixed(o.z < 1 ? 4 : 2) });
        extra.push({ k: 'Light left it', v: `${lookbackGyr(o.z, cosmo).toFixed(2)} billion years ago` });
        extra.push({ k: 'Distance type', v: 'Comoving (where it is now)' });
      } else if (o.ly && o.ly > 1e-3) extra.push({ k: 'Light left it', v: fmtTime(o.ly * 3.15576e7) + ' ago' });
      if (o.mag !== undefined) extra.push({ k: 'Apparent magnitude', v: o.mag.toFixed(2) + (o.mag <= 6 ? ' (naked eye)' : '') });
      if (o.spec) extra.push({ k: o.kind === 'star' ? 'Spectral type' : 'Type', v: o.spec });
      if (o.sizeLy) extra.push({ k: 'Size', v: fmtLy(o.sizeLy) + ' across' });
      return {
        id, name: o.name, kind: KIND_LABEL[o.kind], info: o.note, rows: this.infoRows(m.real, extra),
        enterLabel: this.actionLabel(this.action(id)), travelLabel: 'Fly here', editable: false,
      };
    }
    if (id.startsWith('web:')) {
      const i = Number(id.slice(4)), gi = this.webIdx[i];
      const L = this.layers.get('web')!;
      const real: Vec3 = [L.real[i * 3], L.real[i * 3 + 1], L.real[i * 3 + 2]];
      const d = Math.hypot(...real), z = zAtComovingLy(d, cosmo);
      return {
        id, name: galaxyName(gi, this.universe.params.seed), kind: `Procedural ${TYPE_LIST[this.universe.types[gi]]} galaxy`,
        info: 'A stand-in for the ~10¹¹–10¹² real galaxies: the cosmic web here is procedural (filaments and voids with realistic scales), cut off where galaxies had not formed yet (z ≈ 20).',
        rows: this.infoRows(real, [
          { k: 'Redshift z', v: z.toFixed(z < 1 ? 3 : 2) },
          { k: 'Light left it', v: `${lookbackGyr(z, cosmo).toFixed(2)} billion years ago` },
        ]),
        enterLabel: 'Enter galaxy', travelLabel: 'Fly here', editable: false,
      };
    }
    if (id.startsWith('mw:')) {
      const i = Number(id.slice(3));
      const L = this.layers.get('mw')!;
      const real: Vec3 = [L.real[i * 3], L.real[i * 3 + 1], L.real[i * 3 + 2]];
      const young = i >= this.mwField.count;
      const cls = young ? 'B' : starClass(this.mwField, i);
      const ci = CLASS_INFO[cls];
      return {
        id, name: young ? 'Young OB association' : `MW-${i.toString(36).toUpperCase()}`, kind: `${cls}-type star (procedural Milky Way)`,
        info: `Main-sequence ${cls} star, ${ci.tMin.toLocaleString('en-US')}–${ci.tMax.toLocaleString('en-US')} K. The Milky Way’s overall shape, size and the Sun’s position in it are real; individual stars beyond the catalogued ones are procedural.`,
        rows: this.infoRows(real, [{ k: 'Light left it', v: fmtTime(Math.hypot(...real) * 3.15576e7) + ' ago' }]),
        enterLabel: young ? null : 'Visit its planets', travelLabel: 'Fly here', editable: false,
      };
    }
    return null;
  }

  private actionLabel(a: MapAction): string | null {
    switch (a.kind) {
      case 'galaxy': case 'galaxyDef': return 'Enter galaxy';
      case 'star': return 'Visit its planets';
      case 'preset': return 'Open this system';
      case 'solar': return 'Open the Solar System';
      case 'nucleus': return 'Approach the black hole';
      case 'host': return 'Open its real orbits';
      default: return null;
    }
  }

  /** What "Enter" does for an object. */
  action(id: string): MapAction {
    if (id.startsWith('rl:')) return this.realAction(id);
    if (id.startsWith('sol:')) return { kind: 'solar', bodyId: id.slice(4) };
    if (id.startsWith('web:')) return { kind: 'galaxy', index: this.webIdx[Number(id.slice(4))] };
    if (id.startsWith('mw:')) {
      const i = Number(id.slice(3));
      if (i >= this.mwField.count) return { kind: 'none' };
      return { kind: 'star', entry: { seed: hashSeed(MILKY_WAY.seed, i, 0x57a2), name: `MW-${i.toString(36).toUpperCase()}`, cls: starClass(this.mwField, i) } };
    }
    const o = this.markerIndex.get(id)?.obj;
    if (!o) return { kind: 'none' };
    if (o.id === 'sgra') return { kind: 'nucleus' };
    if (o.preset) return { kind: 'preset', id: o.preset };
    if (o.galaxy) {
      if (o.galaxy.index !== undefined) return { kind: 'galaxy', index: o.galaxy.index };
      const key = 100000 + (hashSeed(o.id.length, o.id.charCodeAt(0), o.id.charCodeAt(o.id.length - 1)) % 100000);
      return { kind: 'galaxyDef', key, params: { ...MILKY_WAY, seed: hashSeed(key), name: o.name, type: o.galaxy.type, radiusKpc: o.galaxy.radiusKpc, massScale: o.galaxy.massScale, bulgeFrac: o.galaxy.type === 'irregular' ? 0.02 : 0.15, starCount: 20000, flattening: o.galaxy.type === 'elliptical' ? 0.3 : 0 } };
    }
    if (o.kind === 'star') return { kind: 'star', entry: { seed: hashSeed(o.id.length * 131, o.id.charCodeAt(0), o.id.charCodeAt(1)), name: o.name, cls: ((o.spec?.[0] ?? 'G') in SPEC_TEMP ? o.spec![0] : 'G') as StarEntry['cls'] } };
    return { kind: 'none' };
  }

  /** Show only the ~26 most important labels in the current zoom band, so names never pile up. */
  private updateLabelSet() {
    const lo = this.camDist * 0.12, hi = this.camDist * 1.5;
    const rank = (m: Marker): number => {
      if (m.layer === 'sol') return m.kind === 'Planet' || m.id === 'sol:sun' ? 0 : m.id === 'sol:moon' ? 1 : 3;
      if (m.layer === 'live') return m.live!.kind === 'flare' || m.live!.kind === 'iss' ? 9 : 0.6 + Math.min((Date.now() - m.live!.time) / 864e5 / 30, 2);
      if (m.layer === 'real') {
        const L = this.real.entries.get(m.rl!.key)?.layer;
        const base: Partial<Record<Category, number>> = { superclusters: 0.5, groups: 1.6, galaxies: 1.8, blackholes: 1.5, clusters: 2.3, nebulae: 2.4, stars: 2.2, quasars: 2.6, pulsars: 2.8, exoplanets: 2.5 };
        const mag = L ? L.mag[m.rl!.i] : NaN;
        return (base[m.cat ?? 'stars'] ?? 3) + (isFinite(mag) ? Math.max(mag, -2) / 6 : 0.5) + m.rl!.i * 1e-5;
      }
      const o = m.obj!;
      const base: Record<string, number> = { supercluster: 0, galaxycluster: 1, galaxy: 1, wall: 1, highz: 1, quasar: 2, void: 2, blackhole: 1, group: 2, cluster: 2, nebula: 2, star: 2, probe: 3, field: 3 };
      return (base[o.kind] ?? 3) + (o.mag !== undefined ? Math.max(o.mag, -2) / 6 : 0.5);
    };
    const cand = this.markers.filter((m) => {
      if (!this.markerVisible(m)) return false;
      const R = m.disp.length();
      return (R > lo && R < hi) || (m.id === 'sol:sun' && this.camDist < 420) || (this.iso?.kind === 'region' && m.id === this.iso.id);
    });
    cand.sort((a, b) => rank(a) - rank(b));
    this.labelSet = new Set(cand.slice(0, this.iso ? 40 : 26).map((m) => m.id));
  }

  labels(): LabelSpec[] {
    const out: LabelSpec[] = [];
    for (const m of this.markers) {
      const R = () => m.disp.length();
      const major = m.id === 'sol:sun' || m.id === 'sol:earth' || m.obj?.kind === 'supercluster';
      out.push({
        id: m.id, text: m.id === 'sol:sun' && this.isAtSun() ? 'Sun · you are here' : m.name,
        cls: major ? 'major' : m.layer === 'live' ? 'minor live' : m.layer === 'sol' && m.kind !== 'Planet' ? 'minor tiny' : 'minor',
        pos: () => m.disp,
        visible: () => { void R; return this.labelSet.has(m.id); },
      });
    }
    for (const f of this.flows) out.push({ id: f.id, text: f.label, cls: f.id === 'flow:dark' ? 'minor ring' : 'minor', pos: () => f.tip, visible: () => !!this.physics?.mapFlows && !this.iso && !(this.live && f.id === 'flow:dark') });
    for (const r of this.rings) out.push({ id: `ring:${r.label}`, text: r.label, cls: 'minor tiny ring', pos: () => r.pos, visible: () => !!this.physics?.mapRings });
    const cmbPos = new THREE.Vector3(0, 0, 0);
    out.push({ id: 'ring:cmb', text: 'Cosmic microwave background (edge of what we can see)', cls: 'minor ring', pos: () => cmbPos.set(0, this.cmb.scale.x * 0.98, 0), visible: () => !!this.physics?.mapCMB && !this.iso });
    return out;
  }

  stats(p: PhysicsParams): LevelStats {
    const scale = mapInverse(this.camDist);
    const drawn = [...this.layers.values()].reduce((a, L) => a + (L.points.visible ? L.n : 0), 0) + this.real.count();
    const near = this.nearestName();
    void p;
    return {
      rows: [
        this.live ? { k: 'Now', v: dateFromJD(this.jd).toISOString().slice(0, 19).replace('T', ' ') + ' UTC' } : { k: 'Date', v: dateFromJD(this.jd).toISOString().slice(0, 10) },
        { k: 'Viewpoint', v: near },
        { k: 'Zoom scale', v: fmtLy(scale) },
        { k: 'Edge of observable universe', v: fmtLy(this.horizonLy) + ' (comoving)' },
        { k: 'CMB (last scattering)', v: fmtLy(this.lsLy) },
        { k: 'Galaxies form beyond', v: `${fmtLy(this.dawnLy)} → dark ages` },
        { k: 'Points drawn', v: drawn.toLocaleString('en-US') },
        { k: 'Real catalogue objects loaded', v: [...dataStore.layers.values()].filter((L) => !L.simulated).reduce((a, L) => a + L.n, 0).toLocaleString('en-US') },
        { k: 'Live events on the map', v: String(this.markers.filter((m) => m.layer === 'live' && this.markerVisible(m)).length) },
        ...(this.iso ? [{ k: 'Showing only', v: this.iso.label }] : []),
      ],
    };
  }

  private nearestName(): string {
    if (this.isAtSun()) return 'The Sun';
    let best = 'Deep space', bd = Infinity;
    for (const m of this.markers) {
      const d = Math.hypot(m.real[0] - this.center[0], m.real[1] - this.center[1], m.real[2] - this.center[2]);
      if (d < bd) { bd = d; best = m.name; }
    }
    return `${fmtLy(bd)} from ${best}`;
  }

  private cosmoParams(): CosmoParams {
    const p = this.physics;
    return { H0: p?.H0 ?? 67.4, omegaM: p?.omegaM ?? 0.315, omegaL: p?.omegaL ?? 0.685, gMult: p?.gMult ?? 1 };
  }

  // ───────────────────────── real catalogues ─────────────────────────

  private syncData() {
    this.dataVersion = dataStore.version;
    if (!this.real.sync(dataStore.layers, this.cosmoParams())) return;
    this.markers = this.markers.filter((m) => m.layer !== 'real');
    for (const id of [...this.markerIndex.keys()]) if (id.startsWith('rl:')) this.markerIndex.delete(id);
    for (const [key, e] of this.real.entries) {
      const L = e.layer;
      for (const i of L.notable.slice(0, 900)) {
        const p = this.real.position(key, i)!;
        const d = Math.hypot(...p);
        const m: Marker = { id: `rl:${key}:${i}`, name: L.names[i], kind: L.types[i], real: p, disp: new THREE.Vector3(), layer: 'real', distLy: d,
          scale: Math.max(regionRadiusFor(L.types[i], L.category) * 0.3, d * 1e-3, 1e-5), cat: L.category, rl: { key, i } };
        this.markers.push(m);
        this.markerIndex.set(m.id, m);
      }
    }
    this.labelsVersion++;
    this.dirty = true;
  }

  private realLayer(id: string): { L: RealLayer; i: number; p: Vec3 } | null {
    const r = parseRl(id), e = this.real.entries.get(r.key), p = this.real.position(r.key, r.i);
    return e && p ? { L: e.layer, i: r.i, p } : null;
  }

  private realInfo(id: string): SelectionInfo | null {
    const h = this.realLayer(id);
    if (!h) return null;
    const { L, i, p } = h, cosmo = this.cosmoParams();
    const extra: InfoRow[] = [];
    const d = Math.hypot(...p);
    if (L.z && isFinite(L.z[i])) {
      extra.push({ k: 'Redshift z', v: L.z[i].toFixed(L.z[i] < 1 ? 4 : 3) });
      extra.push({ k: 'Light left it', v: `${lookbackGyr(L.z[i], cosmo).toFixed(2)} billion years ago` });
    } else if (!L.simulated && d > 1e-3) extra.push({ k: 'Light left it', v: fmtTime(d * 3.15576e7) + ' ago' });
    if (isFinite(L.mag[i])) extra.push({ k: 'Apparent magnitude', v: L.mag[i].toFixed(2) + (L.mag[i] <= 6 ? ' (naked eye)' : '') });
    for (const [k, arr] of Object.entries(L.details)) if (arr[i]) extra.push({ k, v: arr[i] });
    extra.push({ k: 'Distance measured by', v: L.distMethod });
    extra.push({ k: 'Catalogue', v: L.title });
    if (L.simulated) extra.push({ k: 'Status', v: 'SIMULATED — not an observed object', tone: 'warn' });
    const a = this.realAction(id);
    return {
      id, name: L.names[i] || `${L.title} (model point)`, kind: L.types[i], info: L.source, rows: this.infoRows(p, extra),
      enterLabel: this.actionLabel(a), travelLabel: 'Fly here', editable: false,
    };
  }

  private realAction(id: string): MapAction {
    const h = this.realLayer(id);
    if (!h) return { kind: 'none' };
    const { L, i } = h, name = L.names[i], type = L.types[i];
    if (L.simulated) return { kind: 'none' };
    if (L.key === 'nasaexo') return { kind: 'host', name: L.details.Host?.[i] ?? name, layerKey: L.key };
    if (L.category === 'blackholes' && /sgr ?a\*/i.test(name)) return { kind: 'nucleus' };
    if (L.category === 'stars') {
      let cls = (L.details['Spectral type']?.[i] ?? '').trim()[0];
      if (!cls || !(cls in SPEC_TEMP)) {
        const c = Number(L.details['BP−RP colour']?.[i]);
        const t = isFinite(c) && L.details['BP−RP colour']?.[i] ? bprpToTeff(c) : 5600;
        cls = t >= 30000 ? 'O' : t >= 10000 ? 'B' : t >= 7500 ? 'A' : t >= 6000 ? 'F' : t >= 5200 ? 'G' : t >= 3700 ? 'K' : 'M';
      }
      return { kind: 'star', entry: { seed: strHash(name), name, cls: cls as StarEntry['cls'] } };
    }
    if (L.category === 'galaxies') {
      const t = /ellip|spheroid/i.test(type) ? 'elliptical' : /irreg|dwarf/i.test(type) ? 'irregular' : 'spiral';
      const key = 200000 + (strHash(name) % 100000);
      return { kind: 'galaxyDef', key, params: { ...MILKY_WAY, seed: hashSeed(key), name, type: t, radiusKpc: t === 'irregular' ? 3 : 12, massScale: t === 'irregular' ? 0.05 : 0.6, bulgeFrac: t === 'irregular' ? 0.02 : 0.15, starCount: 20000, flattening: t === 'elliptical' ? 0.3 : 0 } };
    }
    return { kind: 'none' };
  }

  /** Keep only one object (and the space around it), everywhere and in every lens. Returns where to look. */
  isolateObject(id: string): { center: Vec3; radius: number; label: string } | null {
    let center: Vec3 | null = null, radius = 0, label = '';
    const m = this.markerIndex.get(id);
    if (id.startsWith('rl:')) {
      const h = this.realLayer(id);
      if (!h) return null;
      center = h.p; label = h.L.names[h.i] || h.L.title;
      radius = regionRadiusFor(h.L.types[h.i], h.L.category);
    } else if (m?.obj) {
      const o = m.obj;
      center = m.real; label = o.name;
      radius = o.id === 'sgra' ? 1 : o.id === 'milkyway' ? 1.5e5 : regionRadiusFor(KIND_LABEL[o.kind], CATKIND_CAT[o.kind], o.sizeLy);
    } else if (m?.layer === 'sol') {
      center = [0, 0, 0]; label = 'Solar System'; radius = 2; // Oort cloud reaches ≈ 1–2 ly
    } else {
      const t = this.targetOf(id);
      if (!t) return null;
      center = t.real; radius = id.startsWith('web:') ? 3e5 : 0.02; label = this.info(id)?.name ?? 'Object';
    }
    this.iso = { kind: 'region', id, label, center, radius };
    this.real.setRegion({ center, radius });
    this.applyMasks();
    return { center, radius, label };
  }

  isolateCategory(cat: Category) {
    this.iso = { kind: 'category', cat, label: `All ${CATEGORY_LABEL[cat].toLowerCase()}` };
    this.real.setRegion(null);
    this.applyMasks();
  }

  clearIsolation() { this.iso = null; this.real.setRegion(null); this.applyMasks(); }
  isolation(): Isolation | null { return this.iso; }

  private applyMasks() {
    const iso = this.iso;
    for (const L of this.layers.values()) {
      let base = this.baseSizes.get(L.key);
      if (!base) { base = L.size.slice(); this.baseSizes.set(L.key, base); }
      const cats = this.pointCats.get(L.key);
      for (let i = 0; i < L.n; i++) {
        let keep = true;
        if (iso?.kind === 'region') keep = Math.hypot(L.real[i * 3] - iso.center[0], L.real[i * 3 + 1] - iso.center[1], L.real[i * 3 + 2] - iso.center[2]) <= iso.radius;
        else if (iso?.kind === 'category') keep = !!cats && cats[i] === iso.cat;
        L.size[i] = keep ? base[i] : 0;
      }
      (L.points.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    }
    this.labelsVersion++;
  }

  /** Search every name on the map: built-in objects and all loaded catalogues. */
  search(q: string, limit = 40): SearchHit[] {
    const qn = normName(q);
    if (!qn) return [];
    const hits: { id: string; name: string; kind: string; group: string; score: number; real: () => Vec3 }[] = [];
    const seen = new Set<string>();
    const score = (n: string) => { const s = normName(n); return s === qn ? 0 : s.startsWith(qn) ? 1 : s.includes(qn) ? 2 : -1; };
    for (const m of this.markers) {
      const sc = score(m.name);
      if (sc < 0) continue;
      hits.push({ id: m.id, name: m.name, kind: m.kind, group: m.layer === 'sol' ? 'Solar System' : m.layer === 'cat' ? 'Highlights' : (this.real.entries.get(m.rl!.key)?.layer.title ?? ''), score: sc - 0.5, real: () => m.real });
    }
    for (const [key, e] of this.real.entries) {
      const L = e.layer;
      if (L.simulated || (L.n > 100000 && qn.length < 5)) continue;
      let found = 0;
      for (let i = 0; i < L.n && found < 200; i++) {
        const sc = score(L.names[i]);
        if (sc < 0) continue;
        found++;
        const id = `rl:${key}:${i}`;
        if (this.markerIndex.has(id)) continue;
        hits.push({ id, name: L.names[i], kind: L.types[i], group: L.title, score: sc, real: () => this.real.position(key, i)! });
      }
    }
    hits.sort((a, b) => a.score - b.score || a.name.length - b.name.length);
    const out: SearchHit[] = [];
    for (const h of hits) {
      const k = normName(h.name);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ id: h.id, name: h.name, kind: h.kind, group: h.group, distLy: Math.hypot(...h.real()) });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** The named objects of one category, nearest first. */
  browse(cat: Category, limit = 250): SearchHit[] {
    return this.markers.filter((m) => m.cat === cat && m.name)
      .sort((a, b) => a.distLy - b.distLy).slice(0, limit)
      .map((m) => ({ id: m.id, name: m.name, kind: m.kind, group: m.layer === 'cat' ? 'Highlights' : (this.real.entries.get(m.rl!.key)?.layer.title ?? ''), distLy: m.distLy }));
  }

  // ───────────────────────── live events ─────────────────────────

  setLive(on: boolean) { this.live = on; this.cmbStyle = ''; this.labelsVersion++; if (on) { this.jd = julianDate(new Date()); this.updateSolar(); } }

  private lastYear = NaN;
  /** Stars move with their measured proper motion and radial velocity to the current date. */
  private updateStarEpoch() {
    const year = 2000 + (this.jd - 2451545) / 365.25;
    this.real.setYear(year);
    if (Math.abs(year - this.lastYear) < 0.01) return;
    this.lastYear = year;
    for (const m of this.markers) if (m.layer === 'real') { const p = this.real.position(m.rl!.key, m.rl!.i); if (p) { m.real = p; this.mapPoint(p, m.disp); } }
  }

  /** Spacecraft / asteroid / ISS positions are only known near the present. */
  private liveValid(e: LiveEvent): boolean {
    if (!e.helio && !e.geo) return true;
    return Math.abs(this.jd - julianDate(new Date())) < 2;
  }

  private syncLive() {
    this.liveVersion = liveStore.version;
    const evsNow = liveStore.list().slice(0, 256);
    if (evsNow.map((e) => e.id).join('|') === this.liveIds.join('|')) {
      for (const e of evsNow) { const m = this.markerIndex.get(`live:${e.id}`); if (m) m.live = e; } // same events, fresher data
      return;
    }
    this.markers = this.markers.filter((m) => m.layer !== 'live');
    for (const id of [...this.markerIndex.keys()]) if (id.startsWith('live:')) this.markerIndex.delete(id);
    const evs = liveStore.list().slice(0, 256);
    this.liveIds = evs.map((e) => e.id);
    const L = this.liveLayer;
    const COL: Record<string, number> = { spacecraft: 0x7fffa0, neo: 0xffb36b, supernova: 0xff6a4a, gw: 0xd08cff, iss: 0xffffff, flare: 0xffe08a };
    L.size.fill(0);
    evs.forEach((e, i) => {
      L.col.set(hexRGB(COL[e.kind] ?? 0xffffff), i * 3);
      const m: Marker = { id: `live:${e.id}`, name: e.name, kind: e.type, real: [0, 0, 0], disp: new THREE.Vector3(), layer: 'live', live: e, distLy: 0, scale: e.kind === 'iss' ? 1e-9 : e.helio ? 2e-6 : 1e5, cat: null };
      this.markers.push(m);
      this.markerIndex.set(m.id, m);
    });
    (L.points.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    this.labelsVersion++;
  }

  private livePos(e: LiveEvent): Vec3 | null {
    if (e.helio) {
      const dt = this.jd - e.helio.jd, a = e.helio.pos, v = e.helio.vel;
      return eclAUtoGalLy([a[0] + v[0] * dt, a[1] + v[1] * dt, a[2] + v[2] * dt]);
    }
    if (e.geo) {
      const earth = this.markerIndex.get('sol:earth')!.real;
      const r = (6371 + e.geo.altKm) / 9.4607304725808e12; // km → ly
      const g = eqToGalactic(fromRaDec(((e.geo.lon + gmstDeg(this.jd)) % 360 + 360) % 360, e.geo.lat));
      return [earth[0] + g[0] * r, earth[1] + g[1] * r, earth[2] + g[2] * r];
    }
    if (e.sun) return [0, 0, 0];
    if (e.sky) {
      let d = e.sky.distLy;
      if (d === undefined && e.sky.dLMpc) {
        const key = `${e.id}:${this.cosmoKey}`;
        d = this.skyCache.get(key);
        if (d === undefined) { d = comovingFromLuminosity(e.sky.dLMpc * LY_PER_MPC, this.cosmoParams()); this.skyCache.set(key, d); }
      }
      if (!d) return null;
      const g = eqToGalactic(fromRaDec(e.sky.ra, e.sky.dec));
      return [g[0] * d, g[1] * d, g[2] * d];
    }
    return null;
  }

  private updateLive(p: PhysicsParams) {
    if (!p.mapLive) return;
    const L = this.liveLayer, t = performance.now() / 1000;
    for (let i = 0; i < this.liveIds.length; i++) {
      const m = this.markerIndex.get(`live:${this.liveIds[i]}`);
      if (!m) continue;
      const e = m.live!;
      const pos = this.liveValid(e) ? this.livePos(e) : null;
      if (!pos) { L.size[i] = 0; continue; }
      m.real = pos; m.distLy = Math.hypot(...pos);
      L.real[i * 3] = pos[0]; L.real[i * 3 + 1] = pos[1]; L.real[i * 3 + 2] = pos[2];
      const fresh = Date.now() - e.time < 3 * 864e5 && (e.kind === 'supernova' || e.kind === 'gw');
      const base = e.kind === 'flare' ? 0 : e.kind === 'gw' ? 9 : e.kind === 'supernova' ? 6 : e.kind === 'spacecraft' ? 5.5 : 4.5;
      L.size[i] = base * (fresh ? 1 + 0.45 * Math.sin(t * 3 + i) : 1);
      this.mapPoint(pos, m.disp);
    }
    this.remapLayer(L);
    (L.points.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
  }

  private liveInfo(id: string): SelectionInfo | null {
    const m = this.markerIndex.get(id);
    const e = m?.live;
    if (!m || !e) return null;
    const pos = this.livePos(e);
    const rows: InfoRow[] = e.rows.map(([k, v]) => ({ k, v }));
    rows.unshift({ k: e.kind === 'neo' ? 'Closest approach' : e.kind === 'spacecraft' || e.kind === 'iss' ? 'Position for' : 'When', v: e.kind === 'spacecraft' || e.kind === 'iss' ? 'now' : ago(e.time) });
    if (e.sky?.note) rows.push({ k: 'Placement', v: e.sky.note, tone: 'warn' });
    rows.push({ k: 'Source', v: e.source });
    if (!this.liveValid(e)) rows.push({ k: 'Note', v: 'Positions are only known for the present — set the date to now to see it.', tone: 'warn' });
    return {
      id, name: e.name, kind: e.type, info: e.summary,
      rows: pos && !e.sun ? this.infoRows(pos, rows) : rows,
      enterLabel: null, travelLabel: pos ? 'Fly here' : undefined, editable: false,
    };
  }

  getState() { return { center: [...this.center] as Vec3, jd: this.jd }; }
  setState(s: { center: Vec3; jd: number }) { this.center = [...s.center] as Vec3; this.jd = s.jd; this.updateSolar(); this.dirty = true; }
  setDate(d: Date) { this.jd = julianDate(d); this.updateSolar(); }

  dispose() { this.real.dispose(); disposeTree(this.group); this.group.clear(); }
}

// ── helpers ─────────────────────────────────────────────────────────

function fromGalacticVec(lDeg: number, bDeg: number): Vec3 {
  const l = lDeg * Math.PI / 180, b = bDeg * Math.PI / 180;
  return [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
}

function galToEq(g: Vec3): Vec3 {
  // inverse of eqToGalactic (orthonormal → transpose): apply the galactic→equatorial matrix
  const G2E = [[-0.0548755604, 0.4941094279, -0.867666149], [-0.8734370902, -0.44482963, -0.1980763734], [-0.4838350155, 0.7469822445, 0.4559837762]];
  return [G2E[0][0] * g[0] + G2E[0][1] * g[1] + G2E[0][2] * g[2], G2E[1][0] * g[0] + G2E[1][1] * g[1] + G2E[1][2] * g[2], G2E[2][0] * g[0] + G2E[2][1] * g[1] + G2E[2][2] * g[2]];
}

/** CMB colour maps, t ∈ [−1 (cold), 1 (hot)]. All encode the same temperature field. */
const CMB_PALETTES: Record<string, [number, [number, number, number]][]> = {
  // default: dark and calm — reads as a night-sky backdrop, hot/cold still visible
  deep: [[-1, [0.05, 0.16, 0.42]], [-0.4, [0.04, 0.08, 0.2]], [0, [0.03, 0.03, 0.08]], [0.4, [0.22, 0.07, 0.28]], [1, [0.55, 0.16, 0.5]]],
  // the familiar Planck-satellite map colours
  planck: [[-1, [0.0, 0.12, 0.6]], [-0.5, [0.2, 0.55, 0.95]], [0, [0.95, 0.92, 0.82]], [0.5, [1.0, 0.6, 0.15]], [1, [0.75, 0.08, 0.05]]],
  // thermal-camera style
  infrared: [[-1, [0.0, 0.0, 0.05]], [-0.3, [0.15, 0.0, 0.25]], [0.2, [0.7, 0.1, 0.1]], [0.6, [1.0, 0.55, 0.0]], [1, [1.0, 0.95, 0.6]]],
  mono: [[-1, [0.02, 0.02, 0.03]], [0, [0.25, 0.25, 0.28]], [1, [0.9, 0.9, 0.95]]],
};
function cmbColor(t: number, palette: string): [number, number, number] {
  const stops = CMB_PALETTES[palette] ?? CMB_PALETTES.deep;
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    if (t <= b) { const f = (t - a) / (b - a); return [ca[0] + f * (cb[0] - ca[0]), ca[1] + f * (cb[1] - ca[1]), ca[2] + f * (cb[2] - ca[2])]; }
  }
  return stops[stops.length - 1][1];
}


function parseRl(id: string): { key: string; i: number } {
  const j = id.lastIndexOf(':');
  return { key: id.slice(3, j), i: Number(id.slice(j + 1)) };
}
