// Real-sky ephemeris for any date — what you would actually see from Earth.
//
//  • Planets: JPL "Keplerian Elements for Approximate Positions of the Major Planets"
//    (E. M. Standish, Table 1, valid 1800–2050 AD). Accuracy: arcminutes for the inner
//    planets, up to ~10′ for Saturn/Uranus/Neptune within that range.
//  • Moon: low-precision orbital elements + the largest periodic perturbations
//    (P. Schlyter, "Computing planetary positions"). Accuracy ~ a few arcminutes.
//  • Sun: from the Earth–Moon barycentre orbit (error < 1′).
//  • Sidereal time: IAU 1982 GMST (error ≪ 1 s over centuries near J2000).
// Coordinates are J2000-ish mean equatorial (precession over ±50 yr ≈ ±0.7°, ignored).

const D2R = Math.PI / 180;
const OBLIQUITY = 23.43928 * D2R; // mean obliquity of the ecliptic, J2000

export type Vec3 = [number, number, number];

/** Julian Date from a JavaScript Date (UTC). */
export function julianDate(d: Date): number { return d.getTime() / 86400000 + 2440587.5; }
export function dateFromJD(jd: number): Date { return new Date((jd - 2440587.5) * 86400000); }

// [a (AU), e, I (°), L (°), ϖ long. perihelion (°), Ω (°)] at J2000 and rates per Julian century
type Row = [number, number, number, number, number, number];
const ELEMENTS: Record<string, { el: Row; rate: Row; H: number }> = {
  mercury: { el: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], rate: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081], H: -0.613 },
  venus: { el: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], rate: [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418], H: -4.384 },
  earth: { el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0], H: 0 },
  mars: { el: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343], H: -1.601 },
  jupiter: { el: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106], H: -9.395 },
  saturn: { el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], rate: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794], H: -8.914 },
  uranus: { el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], rate: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589], H: -7.11 },
  neptune: { el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], rate: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664], H: -7.0 },
};
export const PLANET_IDS = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] as const;

function solveKepler(M: number, e: number): number {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 12; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/** Heliocentric ecliptic J2000 position (AU) of a planet at Julian Date jd. */
export function heliocentric(id: string, jd: number): Vec3 {
  const p = ELEMENTS[id];
  const T = (jd - 2451545.0) / 36525;
  const [a, e, I, L, wbar, O] = p.el.map((v, i) => v + p.rate[i] * T);
  const w = wbar - O;
  let M = ((L - wbar) % 360 + 540) % 360 - 180;
  M *= D2R;
  const E = solveKepler(M, e);
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w * D2R), sw = Math.sin(w * D2R), cO = Math.cos(O * D2R), sO = Math.sin(O * D2R), cI = Math.cos(I * D2R), sI = Math.sin(I * D2R);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

/** Ecliptic → equatorial (rotation about x by the obliquity). */
export function eclToEq(v: Vec3): Vec3 {
  const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

export function toRaDec(v: Vec3): { ra: number; dec: number; dist: number } {
  const dist = Math.hypot(v[0], v[1], v[2]);
  let ra = Math.atan2(v[1], v[0]) / D2R;
  if (ra < 0) ra += 360;
  return { ra, dec: Math.asin(v[2] / dist) / D2R, dist };
}

/** Unit vector (equatorial) from RA/Dec in degrees. */
export function fromRaDec(raDeg: number, decDeg: number): Vec3 {
  const a = raDeg * D2R, d = decDeg * D2R;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
}

/** Geocentric equatorial vector of the Moon (AU), Schlyter elements + main perturbations. */
export function moonGeocentric(jd: number): Vec3 {
  const d = jd - 2451543.5; // days since 2000 Jan 0.0 UT
  const N = (125.1228 - 0.0529538083 * d) * D2R;
  const i = 5.1454 * D2R;
  const w = (318.0634 + 0.1643573223 * d) * D2R;
  const a = 60.2666; // Earth radii
  const e = 0.0549;
  const M = ((115.3654 + 13.0649929509 * d) % 360) * D2R;
  const E = solveKepler(M, e);
  const xv = a * (Math.cos(E) - e), yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv);
  let r = Math.hypot(xv, yv);
  let lon = Math.atan2(Math.sin(v + w) * Math.cos(i), Math.cos(v + w)) + N;
  let lat = Math.asin(Math.sin(v + w) * Math.sin(i));
  // perturbations (Schlyter): Sun's mean anomaly Ms, mean longitudes
  const Ms = ((356.047 + 0.9856002585 * d) % 360) * D2R;
  const ws = (282.9404 + 4.70935e-5 * d) * D2R;
  const Ls = Ms + ws, Lm = M + w + N;
  const Dm = Lm - Ls, F = Lm - N;
  lon += D2R * (-1.274 * Math.sin(M - 2 * Dm) + 0.658 * Math.sin(2 * Dm) - 0.186 * Math.sin(Ms) - 0.059 * Math.sin(2 * M - 2 * Dm)
    - 0.057 * Math.sin(M - 2 * Dm + Ms) + 0.053 * Math.sin(M + 2 * Dm) + 0.046 * Math.sin(2 * Dm - Ms) + 0.041 * Math.sin(M - Ms)
    - 0.035 * Math.sin(Dm) - 0.031 * Math.sin(M + Ms) - 0.015 * Math.sin(2 * F - 2 * Dm) + 0.011 * Math.sin(M - 4 * Dm));
  lat += D2R * (-0.173 * Math.sin(F - 2 * Dm) - 0.055 * Math.sin(M - F - 2 * Dm) - 0.046 * Math.sin(M + F - 2 * Dm)
    + 0.033 * Math.sin(F + 2 * Dm) + 0.017 * Math.sin(2 * M + F));
  r += -0.58 * Math.cos(M - 2 * Dm) - 0.46 * Math.cos(2 * Dm);
  const rAU = (r * 6378.137) / 149597870.7;
  // Schlyter's longitudes are referred to the equinox of date; refer back to J2000
  // by removing general precession (~1.3970° per century).
  lon -= ((1.396971 * (jd - 2451545.0)) / 36525) * D2R;
  return eclToEq([rAU * Math.cos(lat) * Math.cos(lon), rAU * Math.cos(lat) * Math.sin(lon), rAU * Math.sin(lat)]);
}

export interface SkyBody {
  id: string; name: string; eq: Vec3;      // geocentric equatorial, AU
  distAU: number; mag: number; helioAU: number;
  phase?: number;                          // illuminated fraction (Moon, planets)
}

/** Apparent magnitude: V(1,0) + 5 log10(r·Δ) + linear phase term (Mallama-style, simplified). */
function planetMag(id: string, r: number, delta: number, phaseAngleDeg: number): number {
  const H = ELEMENTS[id].H;
  const k = id === 'mercury' ? 0.038 : id === 'venus' ? 0.013 : id === 'mars' ? 0.016 : 0.005;
  return H + 5 * Math.log10(r * delta) + k * phaseAngleDeg;
}

const NAMES: Record<string, string> = { mercury: 'Mercury', venus: 'Venus', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune' };

/** Everything in the Solar System sky as seen from Earth's centre at jd. */
export function solarSystemSky(jd: number): SkyBody[] {
  const earth = heliocentric('earth', jd); // Earth–Moon barycentre (≤ 4 700 km from Earth's centre)
  const out: SkyBody[] = [];
  const sunEcl: Vec3 = [-earth[0], -earth[1], -earth[2]];
  out.push({ id: 'sun', name: 'Sun', eq: eclToEq(sunEcl), distAU: Math.hypot(...sunEcl), mag: -26.74, helioAU: 0 });
  for (const id of PLANET_IDS) {
    const h = heliocentric(id, jd);
    const g: Vec3 = [h[0] - earth[0], h[1] - earth[1], h[2] - earth[2]];
    const r = Math.hypot(...h), delta = Math.hypot(...g);
    // phase angle Sun–planet–Earth
    const cosA = (h[0] * g[0] + h[1] * g[1] + h[2] * g[2]) / (r * delta);
    const alpha = Math.acos(Math.min(Math.max(cosA, -1), 1)) / D2R;
    out.push({ id, name: NAMES[id], eq: eclToEq(g), distAU: delta, mag: planetMag(id, r, delta, alpha), helioAU: r, phase: (1 + Math.cos(alpha * D2R)) / 2 });
  }
  const m = moonGeocentric(jd);
  const sunEq = out[0].eq;
  const elong = Math.acos((m[0] * sunEq[0] + m[1] * sunEq[1] + m[2] * sunEq[2]) / (Math.hypot(...m) * Math.hypot(...sunEq)));
  const phase = (1 - Math.cos(elong)) / 2;
  // Allen: full Moon V ≈ −12.7; magnitude vs phase angle (≈ π − elongation)
  const pa = (Math.PI - elong) / D2R;
  const mag = -12.73 + 0.026 * Math.abs(pa) + 4e-9 * pa ** 4;
  out.push({ id: 'moon', name: 'Moon', eq: m, distAU: Math.hypot(...m), mag, helioAU: 1, phase });
  return out;
}

/** Greenwich mean sidereal time in degrees (IAU 1982). */
export function gmstDeg(jd: number): number {
  const T = (jd - 2451545.0) / 36525;
  const g = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000;
  return ((g % 360) + 360) % 360;
}

/** Local horizon frame (equatorial unit vectors) for latitude/longitude in degrees. */
export function horizonFrame(jd: number, latDeg: number, lonDeg: number) {
  const lst = (gmstDeg(jd) + lonDeg) * D2R, lat = latDeg * D2R;
  const up: Vec3 = [Math.cos(lat) * Math.cos(lst), Math.cos(lat) * Math.sin(lst), Math.sin(lat)];
  // north = projection of the celestial pole onto the horizon plane
  const pole: Vec3 = [0, 0, 1];
  const dp = up[2];
  let north: Vec3 = [pole[0] - dp * up[0], pole[1] - dp * up[1], pole[2] - dp * up[2]];
  const n = Math.hypot(...north);
  north = n < 1e-9 ? [Math.cos(lst + Math.PI), Math.sin(lst + Math.PI), 0] : [north[0] / n, north[1] / n, north[2] / n];
  const east: Vec3 = [north[1] * up[2] - north[2] * up[1], north[2] * up[0] - north[0] * up[2], north[0] * up[1] - north[1] * up[0]];
  return { up, north, east, lstDeg: ((lst / D2R) % 360 + 360) % 360 };
}

/** Altitude / azimuth (degrees, azimuth from north through east). */
export function altAz(eq: Vec3, f: ReturnType<typeof horizonFrame>) {
  const n = Math.hypot(...eq);
  const u: Vec3 = [eq[0] / n, eq[1] / n, eq[2] / n];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const alt = Math.asin(Math.min(Math.max(dot(u, f.up), -1), 1)) / D2R;
  let az = Math.atan2(dot(u, f.east), dot(u, f.north)) / D2R;
  if (az < 0) az += 360;
  return { alt, az };
}

/** Galactic (l, b in degrees) → equatorial unit vector, IAU 1958 / Hipparcos J2000 matrix. */
const G2E = [
  [-0.0548755604, 0.4941094279, -0.867666149],
  [-0.8734370902, -0.44482963, -0.1980763734],
  [-0.4838350155, 0.7469822445, 0.4559837762],
];
export function galacticToEq(v: Vec3): Vec3 {
  return [
    G2E[0][0] * v[0] + G2E[0][1] * v[1] + G2E[0][2] * v[2],
    G2E[1][0] * v[0] + G2E[1][1] * v[1] + G2E[1][2] * v[2],
    G2E[2][0] * v[0] + G2E[2][1] * v[1] + G2E[2][2] * v[2],
  ];
}
export function fromGalactic(lDeg: number, bDeg: number): Vec3 {
  const l = lDeg * D2R, b = bDeg * D2R;
  return galacticToEq([Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)]);
}

export function fmtRA(deg: number): string {
  const h = deg / 15, hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = Math.round(((h - hh) * 60 - mm) * 60);
  return `${hh}h ${String(mm).padStart(2, '0')}m ${String(ss % 60).padStart(2, '0')}s`;
}
export function fmtDec(deg: number): string {
  const s = deg < 0 ? '−' : '+', a = Math.abs(deg), d = Math.floor(a), m = Math.round((a - d) * 60);
  return `${s}${d}° ${String(m % 60).padStart(2, '0')}′`;
}

/** Equatorial → galactic (transpose of the galactic→equatorial rotation). */
export function eqToGalactic(v: Vec3): Vec3 {
  return [
    G2E[0][0] * v[0] + G2E[1][0] * v[1] + G2E[2][0] * v[2],
    G2E[0][1] * v[0] + G2E[1][1] * v[1] + G2E[2][1] * v[2],
    G2E[0][2] * v[0] + G2E[1][2] * v[1] + G2E[2][2] * v[2],
  ];
}

/** Heliocentric ecliptic position (AU) from fixed osculating elements (a AU; angles rad), mean motion from Kepler III. */
export function keplerHelio(a: number, e: number, i: number, w: number, O: number, M0: number, jd: number, massSun = 1): Vec3 {
  const n = (0.9856076686 * D2R * Math.sqrt(massSun)) / Math.pow(a, 1.5); // rad/day
  const M = M0 + n * (jd - 2451545.0);
  const Mr = ((M % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  const E = solveKepler(Mr, e);
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(i), sI = Math.sin(i);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}
export const AU_LY = 1.58125074e-5;
