// Procedural galaxies with a physically-based rotation curve.
//
// Mass model (Milky-Way calibrated, scaled per galaxy):
//   • Hernquist bulge     v² = G·M_b·r / (r + a_b)²
//   • Exponential disk    v² = (2G·M_d / R_d) · y² [I0(y)K0(y) − I1(y)K1(y)],  y = R / 2R_d   (Freeman 1970)
//   • Cored isothermal halo  v² = v∞² [1 − (r_c/r)·atan(r/r_c)]
// MW values: M_b = 1e10 M☉ (a_b 0.6 kpc), M_d = 5e10 M☉, R_d = 2.6 kpc
// (Bland-Hawthorn & Gerhard 2016). Halo v∞ is solved so v(8.2 kpc) = 229 km/s
// (Eilers et al. 2019) at halo strength 1. Halo strength 0 shows the
// declining baryons-only curve — the classic evidence for dark matter.
//
// Spiral arms are density waves, not material arms: every star moves on
// its own orbit at ω(r) while an m-fold perturbation r = a·(1 + e·cos m(θ − φ(a) − Ω_p t))
// with logarithmic phase φ(a) = k·ln a makes orbits crowd along a spiral that
// rotates rigidly at the pattern speed Ω_p. (Lindblad kinematic density wave.)
// The arms therefore never wind up, whatever the rotation curve. Amplitude e is
// capped so neighbouring orbits never cross: e·√(1 + (mk)²) < 0.9.
// Young OB stars live < 10 Myr — they are placed on the arm crest itself.

import { Rng } from './rng';
import { CLASSES, CLASS_INFO, kelvinToHex, type SpectralClass } from './astro';

export type GalaxyType = 'spiral' | 'barred' | 'elliptical' | 'irregular';

export interface GalaxyParams {
  seed: number;
  name: string;
  type: GalaxyType;
  arms: number;          // m, 1–6
  pitchDeg: number;      // arm pitch angle, 5–40°
  armStrength: number;   // 0–1 (fraction of max non-crossing amplitude)
  starCount: number;
  bulgeFrac: number;     // 0–0.6
  radiusKpc: number;     // visible radius
  massScale: number;     // stellar mass relative to MW
  flattening: number;    // ellipticals: 0 (E0) … 0.7 (E7)
}

export const MILKY_WAY: GalaxyParams = {
  seed: 7, name: 'Milky Way', type: 'barred', arms: 2, pitchDeg: 12, armStrength: 0.8,
  starCount: 24000, bulgeFrac: 0.15, radiusKpc: 15, massScale: 1, flattening: 0,
};

export const GALAXY_SCENE_RADIUS = 100; // scene units for radiusKpc
const G_KPC = 4.30091e-6;               // kpc·(km/s)²/M☉
export const KMS_PER_KPC_TO_RAD_PER_MYR = 1.0227e-3;

// ── Bessel functions (Abramowitz & Stegun 9.8.1–9.8.8 polynomial fits) ──
function besselI0(x: number) {
  const ax = Math.abs(x);
  if (ax < 3.75) {
    const y = (x / 3.75) ** 2;
    return 1 + y * (3.5156229 + y * (3.0899424 + y * (1.2067492 + y * (0.2659732 + y * (0.0360768 + y * 0.0045813)))));
  }
  const y = 3.75 / ax;
  return (Math.exp(ax) / Math.sqrt(ax)) * (0.39894228 + y * (0.01328592 + y * (0.00225319 + y * (-0.00157565 + y * (0.00916281 + y * (-0.02057706 + y * (0.02635537 + y * (-0.01647633 + y * 0.00392377))))))));
}
function besselI1(x: number) {
  const ax = Math.abs(x);
  if (ax < 3.75) {
    const y = (x / 3.75) ** 2;
    return ax * (0.5 + y * (0.87890594 + y * (0.51498869 + y * (0.15084934 + y * (0.02658733 + y * (0.00301532 + y * 0.00032411))))));
  }
  const y = 3.75 / ax;
  let ans = 0.02282967 + y * (-0.02895312 + y * (0.01787654 - y * 0.00420059));
  ans = 0.39894228 + y * (-0.03988024 + y * (-0.00362018 + y * (0.00163801 + y * (-0.01031555 + y * ans))));
  return ans * (Math.exp(ax) / Math.sqrt(ax));
}
function besselK0(x: number) {
  if (x <= 2) {
    const y = (x * x) / 4;
    return -Math.log(x / 2) * besselI0(x) + (-0.57721566 + y * (0.4227842 + y * (0.23069756 + y * (0.0348859 + y * (0.00262698 + y * (0.0001075 + y * 0.0000074))))));
  }
  const y = 2 / x;
  return (Math.exp(-x) / Math.sqrt(x)) * (1.25331414 + y * (-0.07832358 + y * (0.02189568 + y * (-0.01062446 + y * (0.00587872 + y * (-0.0025154 + y * 0.00053208))))));
}
function besselK1(x: number) {
  if (x <= 2) {
    const y = (x * x) / 4;
    return Math.log(x / 2) * besselI1(x) + (1 / x) * (1 + y * (0.15443144 + y * (-0.67278579 + y * (-0.18156897 + y * (-0.01919402 + y * (-0.00110404 + y * -0.00004686))))));
  }
  const y = 2 / x;
  return (Math.exp(-x) / Math.sqrt(x)) * (1.25331414 + y * (0.23498619 + y * (-0.0365562 + y * (0.01504268 + y * (-0.00780353 + y * (0.00325614 + y * -0.00068245))))));
}
export const _bessel = { besselI0, besselI1, besselK0, besselK1 }; // exported for verification

// ── mass model ──────────────────────────────────────────────────────
export interface MassModel { Mb: number; ab: number; Md: number; Rd: number; vInf: number; rc: number }

function vBulge2(r: number, m: MassModel) { return m.Mb > 0 ? (G_KPC * m.Mb * r) / ((r + m.ab) ** 2) : 0; }
function vDisk2(r: number, m: MassModel) {
  if (m.Md <= 0 || r <= 0) return 0;
  const y = r / (2 * m.Rd);
  if (y > 12) return (G_KPC * m.Md) / r; // far outside: Keplerian
  const bracket = besselI0(y) * besselK0(y) - besselI1(y) * besselK1(y);
  return ((2 * G_KPC * m.Md) / m.Rd) * y * y * bracket;
}
function vHalo2(r: number, m: MassModel) {
  if (r <= 0) return 0;
  return m.vInf * m.vInf * (1 - (m.rc / r) * Math.atan(r / m.rc));
}

const MW_BASE = { Mb: 1.0e10, ab: 0.6, Md: 5.0e10, Rd: 2.6, rc: 5 };
const MW_VINF = (() => {
  const r = 8.2;
  const m = { ...MW_BASE, vInf: 0 };
  const need = 229 * 229 - vBulge2(r, m) - vDisk2(r, m);
  return Math.sqrt(Math.max(need, 0) / (1 - (m.rc / r) * Math.atan(r / m.rc)));
})();

export function massModel(p: GalaxyParams): MassModel {
  const s = p.radiusKpc / 15; // length scale relative to MW
  const ms = p.massScale;
  const vScale = Math.sqrt(ms / s);
  if (p.type === 'elliptical') {
    return { Mb: 6e10 * ms, ab: 1.2 * s, Md: 0, Rd: 1, vInf: MW_VINF * vScale, rc: 5 * s };
  }
  const bulgeBoost = p.bulgeFrac / 0.15;
  return {
    Mb: MW_BASE.Mb * ms * bulgeBoost, ab: MW_BASE.ab * s,
    Md: MW_BASE.Md * ms * (p.type === 'irregular' ? 0.4 : 1), Rd: MW_BASE.Rd * s,
    vInf: MW_VINF * vScale * (p.type === 'irregular' ? 0.6 : 1), rc: MW_BASE.rc * s,
  };
}

export interface CurvePoint { rKpc: number; vTotal: number; vBaryon: number; vHalo: number }

/** Circular speed (km/s) at radius r (kpc). dm = halo strength multiplier. */
export function vCirc(rKpc: number, m: MassModel, dm: number): number {
  return Math.sqrt(Math.max(vBulge2(rKpc, m) + vDisk2(rKpc, m) + dm * vHalo2(rKpc, m), 0));
}

export function rotationCurve(p: GalaxyParams, dm: number, n = 48): CurvePoint[] {
  const m = massModel(p);
  const out: CurvePoint[] = [];
  for (let i = 1; i <= n; i++) {
    const r = (p.radiusKpc * 1.1 * i) / n;
    const vb2 = vBulge2(r, m) + vDisk2(r, m);
    const vh2 = dm * vHalo2(r, m);
    out.push({ rKpc: r, vTotal: Math.sqrt(vb2 + vh2), vBaryon: Math.sqrt(vb2), vHalo: Math.sqrt(vh2) });
  }
  return out;
}

/** Angular speed (rad/Myr) at radius r (kpc). */
export function omegaAt(rKpc: number, m: MassModel, dm: number): number {
  const r = Math.max(rKpc, 0.05);
  return (vCirc(r, m, dm) / r) * KMS_PER_KPC_TO_RAD_PER_MYR;
}

// ── star field ──────────────────────────────────────────────────────
// Population colour weights are visibility-weighted (bright stars dominate
// what you see), not number-weighted (where M dwarfs are ~75 %).
const W_DISK = [0.01, 0.04, 0.08, 0.14, 0.2, 0.23, 0.3];
const W_OLD = [0, 0, 0.01, 0.06, 0.18, 0.35, 0.4];
const MODE_DISK = 0, MODE_SPHEROID = 1, MODE_BAR = 2;

export interface GalaxyField {
  params: GalaxyParams;
  count: number;
  unitKpc: number;            // kpc per scene unit
  positions: Float32Array;
  colors: Float32Array;
  a: Float32Array;            // orbit radius (scene units)
  theta: Float32Array;        // orbital angle
  h: Float32Array;            // height above disk (scene units)
  basis: Float32Array;        // spheroid orbit plane (u,w) or bar-frame coords
  mode: Uint8Array;
  cls: Uint8Array;            // spectral class index into CLASSES
  omega: Float32Array;        // rad/Myr, depends on dark-matter strength
  // density wave
  m: number; k: number; eMax: number; aIn: number; aRef: number;
  pattern: number;            // current pattern angle
  patternSpeed: number;       // rad/Myr
  // young OB stars on arm crests
  youngCount: number;
  youngPositions: Float32Array;
  youngColors: Float32Array;
  youngA: Float32Array;
  youngOffset: Float32Array;  // arm index · 2π/m + scatter
  youngH: Float32Array;
  dmApplied: number;
  gApplied: number;
}

const CLASS_TEMP = CLASSES.map((c) => (CLASS_INFO[c].tMin + CLASS_INFO[c].tMax) / 2);
const CLASS_RGB = CLASS_TEMP.map((t) => {
  const hx = kelvinToHex(t);
  return [((hx >> 16) & 255) / 255, ((hx >> 8) & 255) / 255, (hx & 255) / 255];
});

function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

export function generateGalaxy(p: GalaxyParams, dm: number): GalaxyField {
  const rng = new Rng(p.seed);
  const R = GALAXY_SCENE_RADIUS;
  const unitKpc = p.radiusKpc / R;
  const count = Math.max(1000, Math.floor(p.starCount));
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const a = new Float32Array(count);
  const theta = new Float32Array(count);
  const h = new Float32Array(count);
  const basis = new Float32Array(count * 6);
  const mode = new Uint8Array(count);
  const cls = new Uint8Array(count);
  const mm = massModel(p);

  const isDiskGalaxy = p.type === 'spiral' || p.type === 'barred';
  const m = Math.max(1, Math.round(p.arms));
  const k = 1 / Math.tan((Math.min(Math.max(p.pitchDeg, 4), 45) * Math.PI) / 180);
  const eMax = isDiskGalaxy ? (Math.min(Math.max(p.armStrength, 0), 1) * 0.9) / Math.sqrt(1 + (m * k) ** 2) : 0;
  const barLen = p.type === 'barred' ? R * 0.22 : 0;
  const aIn = Math.max(barLen, R * 0.12);
  const RdScene = mm.Rd / unitKpc;
  const abScene = Math.max(mm.ab / unitKpc, 1);

  const bulgeN = p.type === 'elliptical' ? count : Math.floor(count * Math.min(Math.max(p.bulgeFrac, 0), 0.8));
  const barN = p.type === 'barred' ? Math.floor(count * 0.08) : 0;
  const clumps = p.type === 'irregular'
    ? Array.from({ length: 6 }, () => ({ a: rng.range(0.15, 0.8) * R, t: rng.range(0, Math.PI * 2), s: rng.range(4, 12) }))
    : [];

  const setColor = (i: number, ci: number, fade: number) => {
    cls[i] = ci;
    const c = CLASS_RGB[ci];
    const b = (0.55 + 0.45 * fade) * (0.75 + rng.next() * 0.35);
    colors[i * 3] = c[0] * b; colors[i * 3 + 1] = c[1] * b; colors[i * 3 + 2] = c[2] * b;
  };

  for (let i = 0; i < count; i++) {
    if (i < bulgeN) {
      // Hernquist sphere: M(<r)/M = r²/(r+a)² → r = a·√u / (1 − √u)
      let r = R;
      for (let tries = 0; tries < 8 && r >= R; tries++) {
        const su = Math.sqrt(rng.next() * 0.995);
        r = (abScene * su) / (1 - su);
        if (p.type !== 'elliptical') r = Math.min(r, aIn * 1.4);
      }
      r = Math.min(Math.max(r, 0.3), R);
      // random orbit plane
      const nz = rng.range(-1, 1), phi = rng.range(0, Math.PI * 2), s = Math.sqrt(1 - nz * nz);
      const nx = s * Math.cos(phi), ny = nz, nzz = s * Math.sin(phi);
      // u ⟂ n
      let ux = -nzz, uy = 0, uz = nx;
      let ul = Math.hypot(ux, uy, uz);
      if (ul < 1e-6) { ux = 1; uy = 0; uz = 0; ul = 1; }
      ux /= ul; uy /= ul; uz /= ul;
      const wx = ny * uz - nzz * uy, wy = nzz * ux - nx * uz, wz = nx * uy - ny * ux;
      basis.set([ux, uy, uz, wx, wy, wz], i * 6);
      a[i] = r; theta[i] = rng.range(0, Math.PI * 2); mode[i] = MODE_SPHEROID;
      setColor(i, rng.weighted(W_OLD), 1 - r / R);
    } else if (i < bulgeN + barN) {
      // bar: elongated distribution rotating rigidly with the pattern
      const bx = rng.gauss() * barLen * 0.45, bz = rng.gauss() * barLen * 0.12, by = rng.gauss() * R * 0.015;
      basis.set([bx, by, bz, 0, 0, 0], i * 6);
      a[i] = Math.hypot(bx, bz); mode[i] = MODE_BAR;
      setColor(i, rng.weighted(W_OLD), 0.9);
    } else {
      let r: number;
      let th = rng.range(0, Math.PI * 2);
      if (clumps.length) {
        const c = rng.pick(clumps);
        const cx = c.a * Math.cos(c.t) + rng.gauss() * c.s, cz = c.a * Math.sin(c.t) + rng.gauss() * c.s;
        r = Math.min(Math.hypot(cx, cz), R); th = Math.atan2(cz, cx);
      } else {
        // exponential disk Σ ∝ e^(−R/Rd) → radial pdf ∝ R·e^(−R/Rd) = Gamma(2, Rd)
        do { r = -RdScene * Math.log(rng.next() * rng.next() + 1e-12); } while (r > R);
        if (p.type === 'barred') r = Math.max(r, barLen * 0.6 + rng.next() * 2);
      }
      a[i] = Math.max(r, 0.4); theta[i] = th; mode[i] = MODE_DISK;
      const thick = p.type === 'irregular' ? 0.05 : 0.018;
      h[i] = rng.gauss() * R * thick * (1.3 - r / R);
      setColor(i, rng.weighted(W_DISK), 1 - r / R);
    }
  }

  // young OB stars on the arm crests (density-wave spirals only)
  const youngCount = isDiskGalaxy && eMax > 0 ? Math.floor(count * 0.06) : 0;
  const youngPositions = new Float32Array(youngCount * 3);
  const youngColors = new Float32Array(youngCount * 3);
  const youngA = new Float32Array(youngCount);
  const youngOffset = new Float32Array(youngCount);
  const youngH = new Float32Array(youngCount);
  for (let i = 0; i < youngCount; i++) {
    youngA[i] = rng.range(aIn * 1.05, R * 0.95);
    youngOffset[i] = (rng.int(0, m - 1) * 2 * Math.PI) / m + rng.gauss() * 0.07;
    youngH[i] = rng.gauss() * R * 0.006;
    const c = CLASS_RGB[rng.chance(0.25) ? 0 : 1];
    const b = 0.9 + rng.next() * 0.3;
    youngColors[i * 3] = c[0] * b; youngColors[i * 3 + 1] = c[1] * b; youngColors[i * 3 + 2] = c[2] * b;
  }

  // pattern rotates at the angular speed of corotation, placed at 0.6 R
  const field: GalaxyField = {
    params: p, count, unitKpc, positions, colors, a, theta, h, basis, mode, cls,
    omega: new Float32Array(count),
    m, k, eMax, aIn, aRef: R * 0.3,
    pattern: 0,
    patternSpeed: omegaAt(0.6 * p.radiusKpc, mm, dm),
    youngCount, youngPositions, youngColors, youngA, youngOffset, youngH,
    dmApplied: -1,
    gApplied: 1,
  };
  applyDarkMatter(field, dm);
  updateGalaxy(field, 0);
  return field;
}

/** Recompute per-star angular speeds for a new halo strength. */
export function applyDarkMatter(f: GalaxyField, dm: number, gMult = 1) {
  if (f.dmApplied === dm && f.gApplied === gMult) return;
  const mm = massModel(f.params);
  const gs = Math.sqrt(Math.max(gMult, 0)); // v ∝ √(G·M/r) → every angular speed scales by √G
  for (let i = 0; i < f.count; i++) f.omega[i] = omegaAt(f.a[i] * f.unitKpc, mm, dm) * gs;
  f.patternSpeed = omegaAt(0.6 * f.params.radiusKpc, mm, dm) * gs;
  f.dmApplied = dm;
  f.gApplied = gMult;
}

function armPhase(f: GalaxyField, a: number) { return f.k * Math.log(a / f.aRef); }
function amplitude(f: GalaxyField, a: number) {
  const R = GALAXY_SCENE_RADIUS;
  return f.eMax * smoothstep(f.aIn, f.aIn * 1.5, a) * (1 - smoothstep(R * 0.85, R * 1.05, a));
}

/** Advance the galaxy by dtMyr (signed). */
export function updateGalaxy(f: GalaxyField, dtMyr: number) {
  f.pattern += f.patternSpeed * dtMyr;
  const P = f.pattern, cp = Math.cos(P), sp = Math.sin(P);
  const pos = f.positions, flat = 1 - f.params.flattening;
  for (let i = 0; i < f.count; i++) {
    const md = f.mode[i];
    if (md === MODE_BAR) {
      const o = i * 6, bx = f.basis[o], by = f.basis[o + 1], bz = f.basis[o + 2];
      pos[i * 3] = bx * cp - bz * sp; pos[i * 3 + 1] = by; pos[i * 3 + 2] = bx * sp + bz * cp;
      continue;
    }
    const th = (f.theta[i] += f.omega[i] * dtMyr);
    const ai = f.a[i];
    if (md === MODE_SPHEROID) {
      const o = i * 6, c = Math.cos(th) * ai, s = Math.sin(th) * ai;
      pos[i * 3] = c * f.basis[o] + s * f.basis[o + 3];
      pos[i * 3 + 1] = (c * f.basis[o + 1] + s * f.basis[o + 4]) * flat;
      pos[i * 3 + 2] = c * f.basis[o + 2] + s * f.basis[o + 5];
    } else {
      const e = amplitude(f, ai);
      const r = e > 0 ? ai * (1 + e * Math.cos(f.m * (th - armPhase(f, ai) - P))) : ai;
      pos[i * 3] = r * Math.cos(th); pos[i * 3 + 1] = f.h[i]; pos[i * 3 + 2] = r * Math.sin(th);
    }
  }
  // arm crest: max orbit crowding where sin(m·Δ) = −1  →  θ = φ(a) + P − π/(2m)
  for (let i = 0; i < f.youngCount; i++) {
    const ai = f.youngA[i];
    const th = armPhase(f, ai) + P - Math.PI / (2 * f.m) + f.youngOffset[i];
    f.youngPositions[i * 3] = ai * Math.cos(th);
    f.youngPositions[i * 3 + 1] = f.youngH[i];
    f.youngPositions[i * 3 + 2] = ai * Math.sin(th);
  }
}

export function starClass(f: GalaxyField, i: number): SpectralClass { return CLASSES[f.cls[i]]; }

/** Named systems placed in the Milky Way (positions exaggerated around Sol). */
export interface NamedStar { id: string; name: string; preset: string; aKpc: number; theta: number; note: string }
export const MW_NAMED: NamedStar[] = [
  { id: 'sol', name: 'Sol', preset: 'solar', aKpc: 8.2, theta: 0.6, note: 'Home — Orion Arm, 8.2 kpc from the centre' },
  { id: 'trappist', name: 'TRAPPIST-1', preset: 'trappist', aKpc: 8.6, theta: 0.68, note: 'Seven rocky planets (real distance 40 ly — spread for visibility)' },
  { id: 'kepler16', name: 'Kepler-16', preset: 'kepler16', aKpc: 7.7, theta: 0.52, note: 'Circumbinary planet (real distance 245 ly)' },
  { id: 'kepler442', name: 'Kepler-442', preset: 'kepler442', aKpc: 8.9, theta: 0.5, note: 'Habitable-zone super-Earth (real distance 1 206 ly)' },
  { id: 'ross128', name: 'Ross 128', preset: 'ross128', aKpc: 7.9, theta: 0.72, note: 'Quiet red dwarf with a temperate planet (11 ly)' },
  { id: 'alphacen', name: 'α Centauri', preset: 'alphacen', aKpc: 8.3, theta: 0.57, note: 'Nearest Sun-like stars, 4.37 ly (spread for visibility)' },
  { id: 'proxima', name: 'Proxima Centauri', preset: 'proxima', aKpc: 8.1, theta: 0.63, note: 'Nearest star, 4.24 ly (spread for visibility)' },
  { id: 'peg51', name: '51 Pegasi', preset: 'peg51', aKpc: 8.5, theta: 0.61, note: 'First hot Jupiter, 50 ly' },
];

/** Overwrite the first stars of a Milky Way field with the named systems. */
export function placeNamedStars(f: GalaxyField, named: NamedStar[]): Map<number, NamedStar> {
  const map = new Map<number, NamedStar>();
  // use the last disk stars so bulge/bar indices are unaffected
  let idx = f.count - 1;
  for (const n of named) {
    while (idx > 0 && f.mode[idx] !== MODE_DISK) idx--;
    f.a[idx] = n.aKpc / f.unitKpc;
    f.theta[idx] = n.theta;
    f.h[idx] = 0.2;
    const mm = massModel(f.params);
    f.omega[idx] = omegaAt(n.aKpc, mm, f.dmApplied) * Math.sqrt(f.gApplied);
    map.set(idx, n);
    idx--;
  }
  return map;
}
