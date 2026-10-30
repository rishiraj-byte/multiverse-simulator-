// Empirical astrophysical relations used to keep every generated object
// self-consistent. Each relation is an approximation; its source and
// validity range are noted next to it.

export const SUN_MASS_SIM = 400;               // simulation mass units per M☉
export const EARTH_PER_SUN = 332946;           // M☉ / M⊕
export const EARTH_MASS_SIM = SUN_MASS_SIM / EARTH_PER_SUN;
export const JUPITER_IN_EARTH = 317.83;        // M♃ / M⊕
export const M_SUN_KG = 1.989e30;
export const M_EARTH_KG = 5.972e24;
export const R_SUN_KM = 695700;
export const R_EARTH_KM = 6371;

// ── spectral classes (main sequence) ───────────────────────────────
// Mass / temperature ranges: standard Harvard classification table
// (e.g. Habets & Heintze 1981; Pecaut & Mamajek 2013 compilations).
export type SpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M';
export const CLASSES: SpectralClass[] = ['O', 'B', 'A', 'F', 'G', 'K', 'M'];
export const CLASS_INFO: Record<SpectralClass, { mMin: number; mMax: number; tMin: number; tMax: number }> = {
  O: { mMin: 16, mMax: 60, tMin: 30000, tMax: 45000 },
  B: { mMin: 2.1, mMax: 16, tMin: 10000, tMax: 30000 },
  A: { mMin: 1.4, mMax: 2.1, tMin: 7500, tMax: 10000 },
  F: { mMin: 1.04, mMax: 1.4, tMin: 6000, tMax: 7500 },
  G: { mMin: 0.8, mMax: 1.04, tMin: 5200, tMax: 6000 },
  K: { mMin: 0.45, mMax: 0.8, tMin: 3700, tMax: 5200 },
  M: { mMin: 0.08, mMax: 0.45, tMin: 2400, tMax: 3700 },
};

/** Mass–luminosity relation, piecewise power law (L☉, M in M☉). */
export function luminosityFromMass(m: number): number {
  if (m < 0.43) return 0.23 * Math.pow(m, 2.3);
  if (m < 2) return Math.pow(m, 4);
  if (m < 55) return 1.4 * Math.pow(m, 3.5);
  return 32000 * m;
}

/** Main-sequence mass–radius approximation (R☉): R ≈ M^0.8 (M<1), M^0.57 (M≥1). */
export function radiusFromMass(m: number): number {
  return m < 1 ? Math.pow(m, 0.8) : Math.pow(m, 0.57);
}

/** Stefan–Boltzmann in solar units: L = R² (T/T☉)⁴, T☉ = 5772 K (IAU 2015). */
export function teffFromLR(L: number, R: number): number {
  return 5772 * Math.pow(L / (R * R), 0.25);
}

export function classFromTeff(t: number): SpectralClass {
  if (t >= 30000) return 'O';
  if (t >= 10000) return 'B';
  if (t >= 7500) return 'A';
  if (t >= 6000) return 'F';
  if (t >= 5200) return 'G';
  if (t >= 3700) return 'K';
  return 'M';
}

export interface StarProps { massSun: number; lum: number; radiusSun: number; teff: number; cls: SpectralClass; color: number }

export function starFromMass(massSun: number): StarProps {
  const lum = luminosityFromMass(massSun);
  const radiusSun = radiusFromMass(massSun);
  const teff = teffFromLR(lum, radiusSun);
  return { massSun, lum, radiusSun, teff, cls: classFromTeff(teff), color: kelvinToHex(teff) };
}

/** Blackbody colour approximation (Tanner Helland's fit), returns 0xRRGGBB. */
export function kelvinToHex(kelvin: number): number {
  const t = Math.min(Math.max(kelvin, 1000), 40000) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

// ── habitable zone ─────────────────────────────────────────────────
// Kopparapu et al. 2013 (ApJ 765:131, erratum-corrected coefficients):
//   S_eff = S☉ + aT + bT² + cT³ + dT⁴,  T = Teff − 5780 K,  d = √(L / S_eff) AU
// Conservative HZ = moist greenhouse (inner) → maximum greenhouse (outer).
// Gives 0.99 – 1.70 AU for the Sun. Fit valid for 2600 K ≤ Teff ≤ 7200 K
// (clamped outside that range).
const HZ_INNER = [1.014, 8.1774e-5, 1.7063e-9, -4.3241e-12, -6.6462e-16];
const HZ_OUTER = [0.3438, 5.8942e-5, 1.6558e-9, -3.0045e-12, -5.2983e-16];
function seff(c: number[], teff: number): number {
  const T = Math.min(Math.max(teff, 2600), 7200) - 5780;
  return c[0] + c[1] * T + c[2] * T * T + c[3] * T ** 3 + c[4] * T ** 4;
}
export function habitableZone(lum: number, teff: number): { inner: number; outer: number } {
  return { inner: Math.sqrt(lum / seff(HZ_INNER, teff)), outer: Math.sqrt(lum / seff(HZ_OUTER, teff)) };
}

/** Planetary equilibrium temperature (K): 278.6·L^¼·(1−A)^¼ / √d. Earth, A=0.3 → 255 K. */
export function equilibriumTemp(lum: number, au: number, albedo = 0.3): number {
  return (278.6 * Math.pow(lum, 0.25) * Math.pow(1 - albedo, 0.25)) / Math.sqrt(Math.max(au, 1e-4));
}

/** Water snow line ≈ 2.7 AU · √L (Hayashi 1981 scaling). */
export function snowLine(lum: number): number { return 2.7 * Math.sqrt(lum); }

/**
 * Planet radius (R⊕) from mass (M⊕) — power-law slopes of Chen & Kipping 2017:
 * R ∝ M^0.279 (terran, < 2 M⊕), R ∝ M^0.589 (neptunian), ~flat for giants.
 * Typical scatter ±30 %; giants capped near Jupiter's 11.2 R⊕.
 */
export function planetRadiusEarth(massE: number): number {
  if (massE < 2.04) return Math.pow(massE, 0.279);
  return Math.min(0.8 * Math.pow(massE, 0.589), 11.2);
}

/** Schwarzschild radius in km: r_s = 2GM/c² ≈ 2.953 km per M☉. */
export function schwarzschildKm(massSun: number): number { return 2.953 * massSun; }

// ── formatting helpers ─────────────────────────────────────────────
const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
export function sci(x: number, digits = 2): string {
  if (x === 0 || !isFinite(x)) return String(x);
  const e = Math.floor(Math.log10(Math.abs(x)));
  const m = x / Math.pow(10, e);
  return `${m.toFixed(digits)} × 10${String(e).split('').map((c) => SUP[c] ?? c).join('')}`;
}

export function fmtNum(x: number, digits = 2): string {
  if (!isFinite(x)) return '∞';
  const a = Math.abs(x);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return sci(x, digits);
  if (a >= 1000) return Math.round(x).toLocaleString('en-US');
  return x.toFixed(digits);
}

/** Simulation mass → readable mass with physical kg. */
export function fmtMass(massSim: number): string {
  const sun = massSim / SUN_MASS_SIM;
  const earth = massSim / EARTH_MASS_SIM;
  const kg = sun * M_SUN_KG;
  if (sun >= 0.05) return `${fmtNum(sun)} M☉ · ${sci(kg)} kg`;
  if (earth >= 50) return `${fmtNum(earth / JUPITER_IN_EARTH)} M♃ · ${sci(kg)} kg`;
  return `${fmtNum(earth)} M⊕ · ${sci(kg)} kg`;
}

export function fmtKm(km: number): string {
  return `${fmtNum(km, 0)} km`;
}
