// Friedmann–Lemaître cosmology (radiation + matter + Λ + curvature).
//
//   H(a)² = H0² (g·Ωr a⁻⁴ + g·Ωm a⁻³ + Ωk a⁻² + ΩΛ),   Ωk = 1 − gΩr − gΩm − ΩΛ
//   ä     = H0² (−g·Ωm/(2a²) − g·Ωr/a³ + ΩΛ a)
// g = G multiplier: gravity scales the matter/radiation terms, not Λ.
// The 3-D universe integrates (a, ȧ) with RK4 (handles turnaround / Big Crunch).
// The timeline (any time from the Planck epoch on) integrates t(a) = ∫ da/(aH)
// including the change in relativistic degrees of freedom g*(T).

export interface CosmoParams { H0: number; omegaM: number; omegaL: number; omegaR?: number; gMult?: number }

export const KMSMPC_TO_PER_GYR = 1.0227e-3;
export const GYR_S = 3.15576e16;
export const A_MIN = 0.02;
export const A_MAX = 25;
export const MPC_PER_UNIT = 14.26;
export const MLY_PER_MPC = 3.2616;
/** Photons + 3 massless neutrinos: Ωr h² ≈ 4.15e-5 (Planck 2018) → 9.14e-5 for h = 0.674. */
export const OMEGA_R = 9.14e-5;
export const T_CMB = 2.7255; // K (Fixsen 2009)
const KB_EV = 8.617333e-5;   // eV/K

function eff(p: CosmoParams) {
  const g = p.gMult ?? 1;
  const or = (p.omegaR ?? OMEGA_R) * g, om = p.omegaM * g;
  return { or, om, ol: p.omegaL, ok: 1 - or - om - p.omegaL, H: p.H0 * KMSMPC_TO_PER_GYR };
}

export function radicand(a: number, p: CosmoParams): number {
  const e = eff(p);
  return e.or / a ** 4 + e.om / a ** 3 + e.ok / (a * a) + e.ol;
}

/** Age today (Gyr), null if the model has no Big Bang (H² ≤ 0 in the past). */
export function ageTodayGyr(p: CosmoParams): number | null {
  const e = eff(p);
  // t0 = ∫₀¹ a da / (H0 √(Ωr + Ωm a + Ωk a² + ΩΛ a⁴))
  const N = 4000;
  let sum = 0;
  for (let i = 0; i <= N; i++) {
    const a = i / N;
    const q = e.or + e.om * a + e.ok * a * a + e.ol * a ** 4;
    if (q < 0 || (q === 0 && a > 0)) return null;
    const f = q === 0 ? 0 : a / Math.sqrt(q); // a→0 with Ωr = 0: integrand → √a/√Ωm → 0
    sum += f * (i === 0 || i === N ? 1 : i % 2 ? 4 : 2);
  }
  return sum / (3 * N) / e.H;
}

export type CosmoEvent = 'none' | 'bigbang' | 'crunch' | 'maxsize';
export interface ClockState { a: number; adot: number; tSinceToday: number; event: CosmoEvent }

export class CosmicClock {
  a = 1;
  adot = 0;
  tSinceToday = 0;
  age0: number | null = null;
  event: CosmoEvent = 'none';
  private p: CosmoParams;

  constructor(p: CosmoParams) { this.p = { ...p }; this.reset(p); }

  reset(p: CosmoParams) {
    this.p = { ...p };
    this.a = 1;
    this.adot = p.H0 * KMSMPC_TO_PER_GYR;
    this.tSinceToday = 0;
    this.event = 'none';
    this.age0 = ageTodayGyr(p);
  }

  /** New parameters redefine "today" (a = 1, ȧ = H0), so the clock restarts from today. */
  setParams(p: CosmoParams) {
    const q = this.p;
    if (p.H0 === q.H0 && p.omegaM === q.omegaM && p.omegaL === q.omegaL
      && (p.gMult ?? 1) === (q.gMult ?? 1) && (p.omegaR ?? OMEGA_R) === (q.omegaR ?? OMEGA_R)) return;
    this.reset(p);
  }

  state(): ClockState { return { a: this.a, adot: this.adot, tSinceToday: this.tSinceToday, event: this.event }; }
  restore(s: ClockState) { this.a = s.a; this.adot = s.adot; this.tSinceToday = s.tSinceToday; this.event = s.event; }

  hubbleKms(): number { return this.adot / this.a / KMSMPC_TO_PER_GYR; }
  age(): number | null { return this.age0 === null ? null : this.age0 + this.tSinceToday; }

  private acc(a: number): number {
    const e = eff(this.p);
    return e.H * e.H * (-e.om / (2 * a * a) - e.or / a ** 3 + e.ol * a);
  }

  step(dtGyr: number) {
    if (dtGyr === 0) return;
    const dir = Math.sign(dtGyr);
    if (this.event === 'bigbang' && dir < 0) return;
    if ((this.event === 'crunch' || this.event === 'maxsize') && dir > 0) return;
    this.event = 'none';
    let remaining = Math.abs(dtGyr), guard = 0;
    while (remaining > 1e-9 && guard++ < 2000) {
      const H = Math.max(Math.abs(this.adot / this.a), 1e-3);
      const h = Math.min(remaining, 0.01 / H) * dir;
      const a0 = this.a, v0 = this.adot;
      const k1a = v0, k1v = this.acc(a0);
      const k2a = v0 + 0.5 * h * k1v, k2v = this.acc(a0 + 0.5 * h * k1a);
      const k3a = v0 + 0.5 * h * k2v, k3v = this.acc(a0 + 0.5 * h * k2a);
      const k4a = v0 + h * k3v, k4v = this.acc(a0 + h * k3a);
      this.a = a0 + (h / 6) * (k1a + 2 * k2a + 2 * k3a + k4a);
      this.adot = v0 + (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
      this.tSinceToday += h;
      remaining -= Math.abs(h);
      if (this.a <= A_MIN) { this.a = A_MIN; this.event = dir < 0 ? 'bigbang' : 'crunch'; return; }
      if (this.a >= A_MAX) { this.a = A_MAX; this.event = 'maxsize'; return; }
    }
  }
}

// ── thermal history ──────────────────────────────────────────────────
// Relativistic degrees of freedom g*(T), Standard Model step approximation
// (Kolb & Turner 1990). Photon temperature T ∝ g*s^{−1/3} a^{−1}.
const GSTAR: { above: number; g: number }[] = [
  { above: 1e11, g: 106.75 },  // kT > 100 GeV: every SM particle relativistic
  { above: 1e9, g: 86.25 },    // t, H, W, Z gone
  { above: 1.5e8, g: 61.75 },  // free quarks & gluons (above the QCD transition)
  { above: 5e5, g: 10.75 },    // γ, e±, 3 ν
  { above: 0, g: 3.91 },       // after e± annihilation (entropy g*s)
];

/** Photon temperature (K) at scale factor a, including g*s steps. */
export function cmbTemperature(a: number): number {
  for (const s of GSTAR) {
    const T = (T_CMB * Math.cbrt(3.91 / s.g)) / a;
    if (T * KB_EV >= s.above) return T;
  }
  return T_CMB / a;
}
export function kTeV(a: number): number { return cmbTemperature(a) * KB_EV; }

function gStarAt(a: number): number {
  const kT = kTeV(a);
  for (const s of GSTAR) if (kT >= s.above) return s.g === 3.91 ? 3.36 : s.g;
  return 3.36;
}

/** H(a) in 1/s, radiation density corrected for g*(T). */
function hubbleSI(a: number, p: CosmoParams): number {
  const e = eff(p);
  const g = gStarAt(a);
  const gs = g === 3.36 ? 3.91 : g;
  const orA = e.or * (g / 3.36) * Math.pow(3.91 / gs, 4 / 3);
  const q = orA / a ** 4 + e.om / a ** 3 + e.ok / (a * a) + e.ol;
  return q > 0 ? (e.H / GYR_S) * Math.sqrt(q) : NaN;
}

const A_START = 1e-34;
/** Cosmic time (s) at scale factor a: t = ∫ dln a / H, radiation-era start t = 1/(2H). */
export function timeAtA(a: number, p: CosmoParams): number {
  const lo = Math.log(A_START), hi = Math.log(a);
  const H0 = hubbleSI(A_START, p);
  let t = 1 / (2 * H0);
  const N = 3000, h = (hi - lo) / N;
  let prev = 1 / H0;
  for (let i = 1; i <= N; i++) {
    const cur = 1 / hubbleSI(Math.exp(lo + i * h), p);
    if (!isFinite(cur)) return NaN;
    t += 0.5 * (prev + cur) * h;
    prev = cur;
  }
  return t;
}

/**
 * Precomputed t(a) table (one integration, ~6 ms) for fast scrubbing in both
 * directions. Covers a = 1e-34 … 1e30 or until H² ≤ 0 (turnaround of a closed universe).
 */
export function cosmicTable(p: CosmoParams, N = 6000) {
  const lo = Math.log(A_START), hi = Math.log(1e30), h = (hi - lo) / N;
  const lnA: number[] = [lo], t: number[] = [1 / (2 * hubbleSI(A_START, p))];
  let prev = 1 / hubbleSI(A_START, p);
  for (let i = 1; i <= N; i++) {
    const cur = 1 / hubbleSI(Math.exp(lo + i * h), p);
    if (!isFinite(cur)) break;
    lnA.push(lo + i * h);
    t.push(t[t.length - 1] + 0.5 * (prev + cur) * h);
    prev = cur;
  }
  const interp = (xs: number[], ys: number[], x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    let a = 0, b = xs.length - 1;
    while (b - a > 1) { const m = (a + b) >> 1; if (xs[m] <= x) a = m; else b = m; }
    const f = (x - xs[a]) / (xs[b] - xs[a]);
    return ys[a] + f * (ys[b] - ys[a]);
  };
  const logT = t.map(Math.log);
  return {
    maxA: Math.exp(lnA[lnA.length - 1]),
    /** scale factor at time tS (log-log interpolation); clamps at the table ends */
    aAt: (tS: number) => Math.exp(interp(logT, lnA, Math.log(Math.max(tS, 1e-300)))),
    tAt: (a: number) => Math.exp(interp(lnA, logT, Math.log(a))),
  };
}

/** Inverse of timeAtA (bisection in ln a). */
export function aAtTime(tS: number, p: CosmoParams): number {
  let lo = Math.log(A_START), hi = Math.log(1e30);
  for (let i = 0; i < 64; i++) {
    const mid = 0.5 * (lo + hi);
    const t = timeAtA(Math.exp(mid), p);
    if (!isFinite(t) || t > tS) hi = mid; else lo = mid;
  }
  return Math.exp(0.5 * (lo + hi));
}

export interface Epoch { name: string; tStart: number; info: string }

/** Standard cosmic epochs (start times in s), recomputed for the current parameters. */
export function epochs(p: CosmoParams): Epoch[] {
  const e = eff(p);
  const aEq = e.or / e.om;
  const aLam = Math.cbrt(e.om / Math.max(e.ol, 1e-9));
  const tAt = (a: number) => timeAtA(a, p);
  const aAtKT = (kT: number) => {
    let lo = Math.log(A_START), hi = Math.log(10);
    for (let i = 0; i < 60; i++) { const m = 0.5 * (lo + hi); if (kTeV(Math.exp(m)) > kT) lo = m; else hi = m; }
    return Math.exp(0.5 * (lo + hi));
  };
  const list: Epoch[] = [
    { name: 'Planck epoch', tStart: 0, info: 'Quantum gravity: known physics breaks down before 5.4×10⁻⁴⁴ s. (Unknown physics.)' },
    { name: 'Grand unification', tStart: 5.4e-44, info: 'Hypothesised: strong and electroweak forces unified. (Speculative.)' },
    { name: 'Inflation', tStart: 1e-36, info: 'Hypothesised exponential expansion that seeded all structure. (Leading model, not proven.)' },
    { name: 'Electroweak epoch', tStart: 1e-32, info: 'Electromagnetic and weak forces act as one; particles are massless.' },
    { name: 'Quark epoch', tStart: tAt(aAtKT(1.6e11)), info: 'Higgs field turns on (~160 GeV): W, Z, quarks and leptons gain mass. Quark–gluon plasma.' },
    { name: 'Hadron epoch', tStart: tAt(aAtKT(1.5e8)), info: 'QCD transition (~150 MeV): quarks confine into protons, neutrons and pions.' },
    { name: 'Lepton epoch', tStart: tAt(aAtKT(1e6)), info: 'Most hadron pairs annihilated; leptons dominate. Neutrinos decouple (~1 MeV) and stream freely ever since.' },
    { name: 'Nucleosynthesis', tStart: tAt(aAtKT(3e5)), info: 'e± pairs annihilate; once kT < ~0.1 MeV deuterium survives and ¹H, ⁴He (~25 % by mass), D, ³He, ⁷Li form (until ~20 min).' },
    { name: 'Photon epoch', tStart: tAt(aAtKT(3e4)), info: `Plasma of nuclei, electrons and photons. Matter–radiation equality at z ≈ ${Math.round(1 / aEq - 1)}.` },
    { name: 'Recombination', tStart: tAt(1 / 1091), info: 'z ≈ 1090, T ≈ 3000 K: atoms form and the CMB is released — the universe becomes transparent.' },
    { name: 'Dark ages', tStart: tAt(1 / 1000), info: 'Neutral hydrogen, no stars yet. Dark-matter halos grow.' },
    { name: 'Cosmic dawn', tStart: tAt(1 / 21), info: 'First stars (Population III) at z ~ 20–30. Earliest confirmed galaxy: JADES-GS-z14-0 at z = 14.3.' },
    { name: 'Reionization', tStart: tAt(1 / 11), info: 'Starlight re-ionizes intergalactic hydrogen, complete by z ≈ 6.' },
    { name: 'Galaxy era', tStart: tAt(1 / 7), info: 'Galaxies merge and grow; cosmic star formation peaks near z ≈ 2.' },
  ];
  if (aLam < 1.5) list.push({ name: 'Dark-energy era', tStart: tAt(aLam), info: `Λ dominates from z ≈ ${(1 / aLam - 1).toFixed(2)}; expansion accelerates. The Sun formed ~4.6 Gyr before today.` });
  return list.filter((x) => isFinite(x.tStart)).sort((a, b) => a.tStart - b.tStart);
}

// ── distances to redshift z (flat or curved FLRW, radiation included) ──
const C_KMS = 299792.458;
export const LY_PER_MPC = 3.26156e6;

function Ez(a: number, p: CosmoParams): number { return Math.sqrt(Math.max(radicand(a, p), 1e-300)); }

/** Comoving (line-of-sight) distance in light-years: χ = (c/H0) ∫ da / (a² E(a)). */
export function comovingDistanceLy(z: number, p: CosmoParams): number {
  if (z <= 0) return 0;
  const a0 = 1 / (1 + z);
  // substitute a = u² near a→0 to keep the integrand smooth; Simpson's rule
  const N = 2000;
  const u0 = Math.sqrt(a0), u1 = 1;
  let s = 0;
  for (let i = 0; i <= N; i++) {
    const u = u0 + ((u1 - u0) * i) / N, a = u * u;
    const f = (2 * u) / (a * a * Ez(a, p));
    s += f * (i === 0 || i === N ? 1 : i % 2 ? 4 : 2);
  }
  const integral = (s * (u1 - u0)) / (3 * N);
  return (C_KMS / p.H0) * integral * LY_PER_MPC;
}

/** Particle horizon (edge of the observable universe), light-years. */
export function particleHorizonLy(p: CosmoParams): number {
  // χ = (c/H0) ∫₀¹ da / √(Ωr + Ωm a + Ωk a² + ΩΛ a⁴)
  const N = 4000;
  let s = 0;
  for (let i = 0; i <= N; i++) {
    const a = i / N;
    const q = Math.max(radicand(Math.max(a, 1e-12), p) * Math.max(a, 1e-12) ** 4, 1e-300);
    s += (1 / Math.sqrt(q)) * (i === 0 || i === N ? 1 : i % 2 ? 4 : 2);
  }
  return (C_KMS / p.H0) * (s / (3 * N)) * LY_PER_MPC;
}

/** Light-travel (look-back) time to redshift z, Gyr. */
export function lookbackGyr(z: number, p: CosmoParams): number {
  if (z <= 0) return 0;
  const a0 = 1 / (1 + z), N = 2000;
  let s = 0;
  for (let i = 0; i <= N; i++) {
    const a = a0 + ((1 - a0) * i) / N;
    s += (1 / (a * Ez(a, p))) * (i === 0 || i === N ? 1 : i % 2 ? 4 : 2);
  }
  return ((s * (1 - a0)) / (3 * N)) / (p.H0 * KMSMPC_TO_PER_GYR);
}

/** Redshift at a given comoving distance (bisection). */
export function zAtComovingLy(ly: number, p: CosmoParams): number {
  let lo = 0, hi = 5000;
  for (let i = 0; i < 60; i++) { const m = 0.5 * (lo + hi); if (comovingDistanceLy(m, p) < ly) lo = m; else hi = m; }
  return 0.5 * (lo + hi);
}
