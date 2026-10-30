// Small-body populations as Keplerian test particles (they feel the star, not
// each other — true for real asteroids to very good approximation).
// Each particle has real orbital elements in AU; its radius is mapped to display
// units with the system's distance map, and its mean motion uses the display
// radius (n = √(GM/r_d³)) so belts co-rotate consistently with the N-body planets.
// Kirkwood gaps / plutinos / Hildas sit at mean-motion resonances computed from the
// actual planet's semi-major axis: a_res = a_planet · (p/q)^{2/3}.

import { Rng } from './rng';

export type BeltKind = 'main' | 'trojan' | 'hilda' | 'kuiper' | 'scattered' | 'oort' | 'debris';

export interface BeltDef {
  id: string;
  name: string;
  kind: BeltKind;
  count: number;
  aMin: number; aMax: number;      // AU
  eMax: number; iMaxDeg: number;
  color: number;
  size: number;                    // point size (display units)
  info: string;
  realCount?: string;
  gaps?: number[];                 // AU, removed ± gapWidth
  gapWidth?: number;
  ofBody?: string;                 // trojans: planet id
  clusterA?: number;               // resonant sub-population centre (AU), e.g. plutinos
  clusterFrac?: number;
  seed: number;
}

export interface BeltField {
  def: BeltDef;
  n: number;
  a: Float32Array; e: Float32Array; inc: Float32Array; node: Float32Array; peri: Float32Array; M0: Float32Array;
  lib: Float32Array;               // trojans: libration amplitude
  side: Int8Array;                 // trojans: +1 L4, −1 L5
  positions: Float32Array;
}

export function generateBelt(def: BeltDef): BeltField {
  const rng = new Rng(def.seed);
  const n = def.count;
  const f: BeltField = {
    def, n,
    a: new Float32Array(n), e: new Float32Array(n), inc: new Float32Array(n), node: new Float32Array(n),
    peri: new Float32Array(n), M0: new Float32Array(n), lib: new Float32Array(n), side: new Int8Array(n),
    positions: new Float32Array(n * 3),
  };
  const deg = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    let a = 0;
    for (let tries = 0; tries < 20; tries++) {
      a = def.kind === 'oort' ? rng.logRange(def.aMin, def.aMax)
        : def.clusterA && rng.chance(def.clusterFrac ?? 0.25) ? def.clusterA + rng.gauss() * 0.15
        : rng.range(def.aMin, def.aMax);
      if (!def.gaps?.some((g) => Math.abs(a - g) < (def.gapWidth ?? 0.03))) break;
    }
    f.a[i] = a;
    if (def.kind === 'oort') {
      f.e[i] = Math.sqrt(rng.next()) * def.eMax;   // thermal-like e distribution
      f.inc[i] = Math.acos(rng.range(-1, 1));      // isotropic
    } else if (def.kind === 'scattered') {
      f.e[i] = rng.range(0.15, def.eMax);
      f.inc[i] = Math.abs(rng.gauss()) * def.iMaxDeg * deg * 0.5;
    } else {
      f.e[i] = Math.abs(rng.gauss()) * def.eMax * 0.45;
      f.inc[i] = Math.abs(rng.gauss()) * def.iMaxDeg * deg * 0.45;
    }
    f.e[i] = Math.min(f.e[i], 0.97);
    f.node[i] = rng.range(0, Math.PI * 2);
    f.peri[i] = rng.range(0, Math.PI * 2);
    f.M0[i] = rng.range(0, Math.PI * 2);
    f.lib[i] = rng.range(2, 30) * deg;
    f.side[i] = rng.chance(0.62) ? 1 : -1;          // L4 (Greeks) is the more populated cloud
  }
  return f;
}

/** Solve Kepler's equation M = E − e sin E (Newton, 5 iterations; e ≤ 0.97). */
function eccentricAnomaly(M: number, e: number): number {
  let E = e < 0.8 ? M : Math.PI;
  if (e > 0.9) E = M < Math.PI ? Math.min(M + e, Math.PI) : Math.max(M - e, Math.PI); // robust start
  for (let k = 0; k < 3; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  for (let k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
}

export interface KeplerElements { a: number; e: number; i: number; w: number; O: number; M0: number } // AU, radians

/** Mean anomaly from true anomaly ν. */
export function meanFromTrue(nu: number, e: number): number {
  const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
  return E - e * Math.sin(E);
}

/** Scene position of a Keplerian test particle on real elements, radially mapped to display units. */
export function keplerPosition(el: KeplerElements, t: number, mu: number, toDisp: (au: number) => number,
  cx: number, cy: number, cz: number, out: Float32Array | number[], o = 0) {
  const rdA = toDisp(el.a);
  const n = Math.sqrt(mu / (rdA * rdA * rdA));
  let M = (el.M0 + n * t) % (2 * Math.PI);
  if (M < 0) M += 2 * Math.PI;
  const E = eccentricAnomaly(M, el.e);
  const nu = 2 * Math.atan2(Math.sqrt(1 + el.e) * Math.sin(E / 2), Math.sqrt(1 - el.e) * Math.cos(E / 2));
  const r = toDisp(el.a * (1 - el.e * Math.cos(E)));
  const u = nu + el.w, cu = Math.cos(u), su = Math.sin(u);
  const cO = Math.cos(el.O), sO = Math.sin(el.O), ci = Math.cos(el.i), si = Math.sin(el.i);
  out[o] = cx + r * (cO * cu - sO * su * ci);
  out[o + 2] = cz + r * (sO * cu + cO * su * ci);
  out[o + 1] = cy + r * su * si;
}

export interface BeltCtx {
  t: number;                        // sim time
  mu: number;                       // G·M_central (display units)
  cx: number; cy: number; cz: number;
  toDisplay: (au: number) => number;
  planet?: { x: number; y: number; z: number; period: number } | null; // trojans
}

export function updateBelt(f: BeltField, c: BeltCtx) {
  const pos = f.positions;
  if (f.def.kind === 'trojan') {
    if (!c.planet) return;
    const px = c.planet.x - c.cx, pz = c.planet.z - c.cz, py = c.planet.y - c.cy;
    const rP = Math.hypot(px, pz), angP = Math.atan2(pz, px);
    const libPeriod = 12.6 * c.planet.period;       // Jupiter trojans librate in ~150 yr ≈ 12.6 orbits
    for (let i = 0; i < f.n; i++) {
      const phi = angP + f.side[i] * (Math.PI / 3 + f.lib[i] * Math.sin((2 * Math.PI * c.t) / libPeriod + f.M0[i]));
      const r = rP * (1 + 0.4 * (f.e[i] - 0.05));
      const z = r * Math.sin(f.inc[i]) * Math.sin(phi - f.node[i]);
      pos[i * 3] = c.cx + r * Math.cos(phi); pos[i * 3 + 1] = c.cy + py + z; pos[i * 3 + 2] = c.cz + r * Math.sin(phi);
    }
    return;
  }
  const el: KeplerElements = { a: 0, e: 0, i: 0, w: 0, O: 0, M0: 0 };
  for (let i = 0; i < f.n; i++) {
    el.a = f.a[i]; el.e = f.e[i]; el.i = f.inc[i]; el.w = f.peri[i]; el.O = f.node[i]; el.M0 = f.M0[i];
    keplerPosition(el, c.t, c.mu, c.toDisplay, c.cx, c.cy, c.cz, pos, i * 3);
  }
}

/** Resonance location a_planet·(p/q)^{2/3} (interior resonance q:p with q > p). */
export const resonance = (aPlanet: number, q: number, p: number) => aPlanet * Math.pow(p / q, 2 / 3);

export function solBelts(aJup: number, aNep: number): BeltDef[] {
  const kirkwood = [resonance(aJup, 3, 1), resonance(aJup, 5, 2), resonance(aJup, 7, 3), resonance(aJup, 2, 1)];
  return [
    { id: 'main-belt', name: 'Main asteroid belt', kind: 'main', count: 6000, aMin: 2.06, aMax: resonance(aJup, 2, 1), eMax: 0.3, iMaxDeg: 20,
      color: 0xb3a596, size: 0.07, gaps: kirkwood, gapWidth: 0.025, seed: 101, realCount: '1.1–1.9 million larger than 1 km',
      info: `Between Mars and Jupiter. Kirkwood gaps at Jupiter resonances 3:1, 5:2, 7:3, 2:1 (${kirkwood.map((g) => g.toFixed(2)).join(', ')} AU) are computed, not drawn by hand. Total mass ≈ 2.4×10²¹ kg — about 3 % of the Moon.` },
    { id: 'hildas', name: 'Hilda asteroids', kind: 'hilda', count: 500, aMin: resonance(aJup, 3, 2) - 0.08, aMax: resonance(aJup, 3, 2) + 0.08, eMax: 0.35, iMaxDeg: 12,
      color: 0xc9b38a, size: 0.07, seed: 102, realCount: 'thousands known',
      info: `Locked in the 3:2 resonance with Jupiter at ${resonance(aJup, 3, 2).toFixed(2)} AU.` },
    { id: 'trojans', name: 'Jupiter trojans', kind: 'trojan', count: 1200, aMin: aJup, aMax: aJup, eMax: 0.1, iMaxDeg: 25,
      color: 0xa9c79a, size: 0.08, ofBody: 'jupiter', seed: 103, realCount: 'over 10 000 known',
      info: 'Two swarms 60° ahead (L4, “Greeks”) and behind (L5, “Trojans”) of Jupiter, librating around the Lagrange points. NASA’s Lucy mission is visiting them.' },
    { id: 'kuiper', name: 'Kuiper belt', kind: 'kuiper', count: 4000, aMin: 42.0, aMax: 47.8, eMax: 0.18, iMaxDeg: 12,
      color: 0x9fb6d9, size: 0.12, clusterA: aNep * Math.pow(3 / 2, 2 / 3), clusterFrac: 0.25, seed: 104, realCount: 'estimated > 100 000 bodies larger than 100 km',
      info: `Icy bodies beyond Neptune: plutinos in the 3:2 resonance at ${(aNep * Math.pow(3 / 2, 2 / 3)).toFixed(1)} AU (Pluto among them) and the classical belt at 42–48 AU, ending near the 2:1 resonance (${(aNep * Math.pow(2, 2 / 3)).toFixed(1)} AU).` },
    { id: 'scattered', name: 'Scattered disc', kind: 'scattered', count: 1200, aMin: 50, aMax: 150, eMax: 0.65, iMaxDeg: 40,
      color: 0x8fa3c4, size: 0.18, seed: 105, realCount: 'unknown; Eris is the largest member',
      info: 'Eccentric, inclined orbits scattered outward by Neptune; source of many short-period comets.' },
    { id: 'oort', name: 'Oort cloud', kind: 'oort', count: 5000, aMin: 2000, aMax: 100000, eMax: 0.9, iMaxDeg: 180,
      color: 0x7f93b8, size: 2.5, seed: 106, realCount: 'possibly 10¹¹–10¹² comets (theoretical)',
      info: 'Hypothesised spherical shell of icy bodies from ~2 000 to ~100 000 AU — never observed directly; inferred from long-period comets. Its outer edge is about a third of the way to Proxima Centauri.' },
  ];
}
