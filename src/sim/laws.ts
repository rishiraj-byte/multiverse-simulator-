// Fundamental constants as multipliers of their measured values (1 = our universe),
// and the consequences that follow from them by standard physics scalings.
// G lives in PhysicsParams.gMult so it drives every scale (orbits, galaxy rotation,
// cosmic expansion, stellar luminosity, black holes) from one slider.
//
// Every derived quantity below is either an exact formula (Bohr radius, Hawking
// temperature, Chandrasekhar mass scaling, Kerr ISCO) or a standard scaling law
// whose approximation is noted next to it.

export interface Laws {
  c: number;       // speed of light
  hbar: number;    // reduced Planck constant
  alpha: number;   // fine-structure constant (electromagnetism)
  alphaS: number;  // strong coupling (nuclear binding)
  GF: number;      // Fermi constant (weak interaction)
  me: number;      // electron mass
  mp: number;      // proton mass
  dMnp: number;    // neutron–proton mass difference
}

export const REAL_LAWS: Laws = { c: 1, hbar: 1, alpha: 1, alphaS: 1, GF: 1, me: 1, mp: 1, dMnp: 1 };

// CODATA 2018 / PDG values
export const SI = {
  G: 6.6743e-11, c: 2.99792458e8, hbar: 1.054571817e-34, kB: 1.380649e-23,
  alpha: 1 / 137.035999, me: 9.1093837e-31, mp: 1.67262192e-27, eV: 1.602176634e-19,
  Msun: 1.989e30, Lsun: 3.828e26, year: 3.15576e7,
};
const ME_MEV = 0.51099895, DMNP_MEV = 1.29333, TAU_N = 879.4; // neutron lifetime (s)

export interface Constants { G: number; c: number; hbar: number; alpha: number; me: number; mp: number }
export function constants(l: Laws, gMult: number): Constants {
  return { G: SI.G * gMult, c: SI.c * l.c, hbar: SI.hbar * l.hbar, alpha: SI.alpha * l.alpha, me: SI.me * l.me, mp: SI.mp * l.mp };
}

export type Verdict = 'ok' | 'warn' | 'bad';
export interface Consequence { k: string; v: string; verdict?: Verdict; note?: string }

export interface Derived {
  lumFactor: number;        // luminosity of a star of fixed mass relative to ours
  lifetimeFactor: number;   // main-sequence lifetime relative to ours
  chandraFactor: number;    // Chandrasekhar / characteristic stellar mass relative to ours
  heliumY: number;          // primordial helium mass fraction
  rows: Consequence[];
  life: Verdict;
}

/**
 * Derived consequences.
 *  • Bohr radius a₀ = ħ/(mₑcα); hydrogen binding ½α²mₑc²             (exact)
 *  • Heaviest stable atom Z_max ≈ 1/α (Dirac point-nucleus limit)        (exact limit)
 *  • Chandrasekhar mass ∝ (ħc/G)^{3/2} / m_p²  (1.4575 M☉ for μₑ = 2)    (exact scaling)
 *  • Stellar luminosity, electron-scattering homology: L ∝ G⁴M³m_p⁵mₑ² / (α²ħ⁵)
 *    lifetime ∝ ε c² / L                                                 (scaling; ±)
 *  • Neutron decay: Q = Δm − mₑ; τ ∝ G_F⁻² Q⁻⁵ (Sargent's rule)           (approx.)
 *  • BBN: weak freeze-out T_f ∝ G^{1/6} G_F^{-2/3} (Γ_weak = H), n/p = e^{−Δm/T_f},
 *    neutrons decay until t_BBN ∝ G^{−1/2}; Y = 2·Xₙ                     (approx., Y≈0.24 here vs 0.245 measured)
 *  • Deuteron unbound if strong coupling −~9 %; diproton bound if +~4 %
 *    (Davies 1972; Barrow & Tipler 1986 — order-of-magnitude thresholds)
 */
export function deriveLaws(l: Laws, gMult: number): Derived {
  const rows: Consequence[] = [];
  const g = Math.max(gMult, 1e-9);

  // atoms
  const a0 = (SI.hbar * l.hbar) / (SI.me * l.me * SI.c * l.c * SI.alpha * l.alpha);
  const eH = 0.5 * (SI.alpha * l.alpha) ** 2 * SI.me * l.me * (SI.c * l.c) ** 2 / SI.eV;
  rows.push({ k: 'Bohr radius', v: `${(a0 * 1e12).toFixed(2)} pm (ours 52.92)` });
  rows.push({ k: 'Hydrogen binding energy', v: `${eH.toFixed(2)} eV (ours 13.61)` });
  const zMax = Math.floor(1 / (SI.alpha * l.alpha));
  rows.push({ k: 'Heaviest possible atom', v: `Z ≈ ${zMax} (ours 137)`, verdict: zMax < 8 ? 'bad' : zMax < 26 ? 'warn' : 'ok', note: 'Z·α < 1 or the innermost electron collapses' });

  // nuclear
  const deuteron = l.alphaS >= 0.91;
  const diproton = l.alphaS > 1.04;
  rows.push({ k: 'Deuterium', v: deuteron ? 'bound' : 'unbound — no pp-chain fusion', verdict: deuteron ? 'ok' : 'bad' });
  if (diproton) rows.push({ k: 'Diproton (²He)', v: 'bound — hydrogen burns away instantly', verdict: 'bad' });

  // weak / neutron stability
  const dm = DMNP_MEV * l.dMnp, me = ME_MEV * l.me;
  const Q = dm - me;
  let tauN = Infinity;
  if (Q > 0) {
    tauN = TAU_N / (l.GF * l.GF) * Math.pow((DMNP_MEV - ME_MEV) / Q, 5);
    rows.push({ k: 'Free neutron lifetime', v: fmtTime(tauN) + ' (ours 14.7 min)' });
  } else if (dm < -me) {
    rows.push({ k: 'Proton', v: 'unstable — decays to neutron: no hydrogen', verdict: 'bad' });
  } else {
    rows.push({ k: 'Free neutron', v: 'stable (Q ≤ 0)', verdict: 'warn' });
  }

  // Big Bang nucleosynthesis
  const Tf = 0.75 * Math.pow(g, 1 / 6) * Math.pow(l.GF, -2 / 3);
  const np = Math.exp(-dm / Tf);
  let Xn = np / (1 + np);
  const tBBN = 200 / Math.sqrt(g);
  if (isFinite(tauN)) Xn *= Math.exp(-tBBN / tauN);
  let Y = deuteron ? Math.min(2 * Xn, 1) : 0;
  if (dm < -me) Y = 0;
  if (diproton) Y = 1;
  rows.push({ k: 'Primordial helium Y', v: `${(Y * 100).toFixed(1)} % (ours ≈ 24.5 %)`, verdict: Y > 0.9 ? 'bad' : Y > 0.6 ? 'warn' : 'ok' });

  // stars
  const chandraFactor = Math.pow((l.hbar * l.c) / g, 1.5) / (l.mp * l.mp);
  rows.push({ k: 'Chandrasekhar mass', v: `${(1.4575 * chandraFactor).toPrecision(3)} M☉ (ours 1.46)`, note: 'sets the mass scale of all stars' });
  const lumFactor = (g ** 4 * l.mp ** 5 * l.me ** 2) / (l.alpha ** 2 * l.hbar ** 5);
  const fusionEff = Math.min(Math.max(l.alphaS, 0), 3); // ε ∝ nuclear binding (crude)
  const lifetimeFactor = (fusionEff * l.c * l.c) / lumFactor;
  const life = 1e10 * lifetimeFactor;
  rows.push({ k: 'Sun-mass star luminosity', v: `${fmtSci(lumFactor)} × ours` });
  rows.push({ k: 'Sun-mass star lifetime', v: fmtTime(life * SI.year), verdict: life < 1e8 ? 'bad' : life < 1e9 ? 'warn' : 'ok', note: 'complex life on Earth took ~4 Gyr' });

  const verdicts = rows.map((r) => r.verdict).filter(Boolean);
  const lifeV: Verdict = verdicts.includes('bad') ? 'bad' : verdicts.includes('warn') ? 'warn' : 'ok';
  return { lumFactor, lifetimeFactor, chandraFactor, heliumY: Y, rows, life: lifeV };
}

// ── black holes ───────────────────────────────────────────────────────
export interface BlackHoleProps {
  rsM: number; rPlus: number; rMinus: number; iscoPro: number; iscoRetro: number; efficiency: number;
  photonSphere: number; shadowR: number;
  hawkingK: number; evapYears: number; hawkingW: number;
  tidal: number; eddingtonW: number; density: number;
}

/** Black-hole properties for mass (M☉) and dimensionless spin a* ∈ [0, 1). */
export function blackHole(massSun: number, spin: number, l: Laws, gMult: number): BlackHoleProps {
  const k = constants(l, gMult);
  const M = massSun * SI.Msun;
  const rg = (k.G * M) / (k.c * k.c);            // gravitational radius GM/c²
  const a = Math.min(Math.max(spin, 0), 0.9999);
  const rs = 2 * rg;
  // Bardeen, Press & Teukolsky 1972
  const Z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  const Z2 = Math.sqrt(3 * a * a + Z1 * Z1);
  const iscoPro = 3 + Z2 - Math.sqrt((3 - Z1) * (3 + Z1 + 2 * Z2));
  const iscoRetro = 3 + Z2 + Math.sqrt((3 - Z1) * (3 + Z1 + 2 * Z2));
  const efficiency = 1 - Math.sqrt(1 - 2 / (3 * iscoPro));
  const sigmaT = (8 * Math.PI / 3) * ((k.alpha * k.hbar) / (k.me * k.c)) ** 2;
  return {
    rsM: rs,
    rPlus: rg * (1 + Math.sqrt(1 - a * a)),
    rMinus: rg * (1 - Math.sqrt(1 - a * a)),
    iscoPro: iscoPro * rg, iscoRetro: iscoRetro * rg, efficiency,
    photonSphere: 3 * rg, shadowR: Math.sqrt(27) * rg,
    hawkingK: (k.hbar * k.c ** 3) / (8 * Math.PI * k.G * M * SI.kB),
    evapYears: (5120 * Math.PI * k.G ** 2 * M ** 3) / (k.hbar * k.c ** 4) / SI.year,
    hawkingW: (k.hbar * k.c ** 6) / (15360 * Math.PI * k.G ** 2 * M ** 2),
    tidal: (2 * k.G * M * 2) / rs ** 3,          // Δa across 2 m at the horizon
    eddingtonW: (4 * Math.PI * k.G * M * k.mp * k.c) / sigmaT,
    density: M / ((4 / 3) * Math.PI * rs ** 3),
  };
}

export function fmtSci(x: number, d = 3): string {
  if (!isFinite(x)) return '∞';
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e >= -2 && e < 5) return x.toPrecision(d);
  return `${(x / 10 ** e).toFixed(d - 1)}e${e}`;
}

export function fmtTime(s: number): string {
  if (!isFinite(s)) return '∞';
  const y = s / SI.year;
  if (s < 1e-9) return `${fmtSci(s)} s`;
  if (s < 1e-3) return `${(s * 1e6).toPrecision(3)} µs`;
  if (s < 1) return `${(s * 1e3).toPrecision(3)} ms`;
  if (s < 120) return `${s.toPrecision(3)} s`;
  if (s < 7200) return `${(s / 60).toPrecision(3)} min`;
  if (s < 172800) return `${(s / 3600).toPrecision(3)} h`;
  if (y < 1) return `${(s / 86400).toPrecision(3)} d`;
  if (y < 1e3) return `${y.toPrecision(3)} yr`;
  if (y < 1e6) return `${(y / 1e3).toPrecision(3)} kyr`;
  if (y < 1e9) return `${(y / 1e6).toPrecision(3)} Myr`;
  if (y < 1e12) return `${(y / 1e9).toPrecision(3)} Gyr`;
  return `${fmtSci(y)} yr`;
}
