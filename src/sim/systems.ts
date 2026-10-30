// Star systems. Real systems use published data; procedural systems use the
// stellar/planetary relations in astro.ts so every number is consistent.
//
// Distance mapping (display units ↔ AU), stored per system:
//  • 'linear'  r = rMax · au/auMax          → preserves period RATIOS exactly (Kepler III),
//                                            used when the system spans < ~12× in radius.
//  • 'power'   r = r0 + (rMax−r0)(au/auMax)^0.55 → compresses wide systems like Sol;
//                                            ordering preserved, period ratios not.
// Orbital speeds are always derived from the DISPLAY radius, v = √(GM/r), so the
// Newtonian dynamics on screen are exact for the bodies as drawn.
//
// Moons: in a compressed map a moon lies far outside its planet's Hill sphere
// (r_H = a·(m/3M)^⅓ ≈ 0.08 units for Earth), so it cannot be gravitationally
// bound in the N-body sim. Moons are therefore kinematic ("on rails") around
// their parent, with REAL period ratios, slowed by MOON_TIME_DILATION.

import { z } from 'zod';
import { Rng, properName } from './rng';
import {
  EARTH_MASS_SIM, SUN_MASS_SIM, JUPITER_IN_EARTH, R_EARTH_KM, R_SUN_KM,
  starFromMass, planetRadiusEarth, equilibriumTemp, habitableZone, snowLine,
  CLASS_INFO, type SpectralClass,
} from './astro';
import { circularOrbitSpeed } from './physics';
import { solBelts, keplerPosition, meanFromTrue, type BeltDef, type KeplerElements } from './belts';

export type TexStyle = 'star' | 'gas' | 'rock' | 'ice' | 'earth' | 'lava' | 'blackhole';
export type BodyKind = 'star' | 'planet' | 'moon' | 'blackhole';

export interface BodyDef {
  id: string;
  name: string;
  kind: BodyKind;
  mass: number;            // sim units (Sun = 400)
  radius: number;          // display/collision radius
  pos: [number, number, number];
  vel: [number, number, number];
  color: number;
  tex: TexStyle;
  ring?: boolean;
  info: string;
  realRadiusKm?: number;
  lum?: number;            // stars: L☉
  teff?: number;           // stars: K
  albedo?: number;
  texSeed?: number;
  // moons (kinematic)
  parentId?: string;
  orbitR?: number;         // display radius from parent centre
  periodSim?: number;      // sim seconds
  phase?: number;
  incl?: number;
  // small bodies: Keplerian test particle on real elements (AU, radians)
  kepler?: KeplerElements;
}

export interface DistanceScale { kind: 'linear' | 'power'; r0: number; rMax: number; auMax: number }

export interface SystemDef {
  id: string;
  name: string;
  subtitle: string;
  bodies: BodyDef[];
  scale: DistanceScale;
  belts?: BeltDef[];
  timeScale?: number;      // sim-time multiplier for this system (very massive systems orbit fast)
  t0?: number;             // system clock at load (saved snapshots resume belts / test particles)
}

/** 1 sim-second ≡ this many days for moon periods. Sol-calibrated: Earth's display year ≈ 7.1 sim-s. */
export const MOON_TIME_DILATION = 150;
export const SIM_S_PER_YEAR_SOL = 7.1;
export const MOON_SIM_S_PER_DAY = (SIM_S_PER_YEAR_SOL * MOON_TIME_DILATION) / 365.25;

export function toDisplay(au: number, s: DistanceScale): number {
  if (s.kind === 'linear') return (s.rMax * au) / s.auMax;
  return s.r0 + (s.rMax - s.r0) * Math.pow(Math.max(au, 0) / s.auMax, 0.55);
}
export function toAU(r: number, s: DistanceScale): number {
  if (s.kind === 'linear') return (r * s.auMax) / s.rMax;
  if (r <= s.r0) return 0;
  return s.auMax * Math.pow((r - s.r0) / (s.rMax - s.r0), 1 / 0.55);
}

/** Display radius for a planet of R⊕ (√ compression, Earth ≈ 0.28). */
export function displayRadiusPlanet(rEarth: number): number {
  return Math.min(Math.max(0.28 * Math.sqrt(rEarth), 0.1), 1.15);
}
export function displayRadiusStar(rSun: number): number {
  return Math.min(Math.max(1.6 * Math.sqrt(rSun), 0.45), 3.2);
}

function orbitState(r: number, centralMass: number, phase: number, inclDeg: number, speedFactor = 1) {
  const v = circularOrbitSpeed(centralMass, r) * speedFactor;
  const inc = (inclDeg * Math.PI) / 180;
  const ca = Math.cos(phase), sa = Math.sin(phase), ci = Math.cos(inc), si = Math.sin(inc);
  return {
    pos: [r * ca, r * sa * si, r * sa * ci] as [number, number, number],
    vel: [-sa * v, ca * v * si, ca * v * ci] as [number, number, number],
  };
}

/** Shift to the barycentric frame: total momentum zero, centre of mass at origin. */
export function toBarycentric(bodies: BodyDef[]) {
  const dyn = bodies.filter((b) => b.kind !== 'moon' && !b.kepler);
  let m = 0, px = 0, py = 0, pz = 0, cx = 0, cy = 0, cz = 0;
  for (const b of dyn) {
    m += b.mass;
    px += b.mass * b.vel[0]; py += b.mass * b.vel[1]; pz += b.mass * b.vel[2];
    cx += b.mass * b.pos[0]; cy += b.mass * b.pos[1]; cz += b.mass * b.pos[2];
  }
  if (m <= 0) return;
  for (const b of dyn) {
    b.vel = [b.vel[0] - px / m, b.vel[1] - py / m, b.vel[2] - pz / m];
    b.pos = [b.pos[0] - cx / m, b.pos[1] - cy / m, b.pos[2] - cz / m];
  }
}

function makeStar(id: string, name: string, massSun: number, info: string, over: Partial<BodyDef> = {}): BodyDef {
  const s = starFromMass(massSun);
  return {
    id, name, kind: 'star', mass: massSun * SUN_MASS_SIM,
    radius: displayRadiusStar(over.realRadiusKm ? over.realRadiusKm / R_SUN_KM : s.radiusSun),
    pos: [0, 0, 0], vel: [0, 0, 0], color: s.color, tex: 'star',
    info, realRadiusKm: s.radiusSun * R_SUN_KM, lum: s.lum, teff: s.teff, ...over,
  };
}

function makeMoon(id: string, name: string, parent: BodyDef, massE: number, rKm: number,
  orbitR: number, periodDays: number, phase: number, info: string, color = 0xb8b8b0): BodyDef {
  return {
    id, name, kind: 'moon', mass: massE * EARTH_MASS_SIM,
    radius: Math.max(displayRadiusPlanet(rKm / R_EARTH_KM) * 0.6, 0.05),
    pos: [0, 0, 0], vel: [0, 0, 0], color, tex: 'rock', info, realRadiusKm: rKm,
    parentId: parent.id, orbitR, periodSim: periodDays * MOON_SIM_S_PER_DAY, phase, incl: 0.05,
  };
}

/** Moon display radius: spread between 1.8 and 4 parent radii by √(a/a_outer). */
function moonOrbit(parent: BodyDef, aKm: number, aOuterKm: number) {
  return parent.radius * (1.8 + 2.2 * Math.sqrt(aKm / aOuterKm));
}

/** Display-space ellipse preserving the REAL perihelion and aphelion distances (each mapped separately). */
export function ellipticalState(qAU: number, QAU: number, scale: DistanceScale, mu: number,
  inclDeg: number, periDeg: number, nodeDeg: number, nuDeg: number) {
  const rp = toDisplay(qAU, scale), ra = toDisplay(QAU, scale);
  const a = (rp + ra) / 2, e = (ra - rp) / (ra + rp);
  const nu = (nuDeg * Math.PI) / 180, w = (periDeg * Math.PI) / 180, O = (nodeDeg * Math.PI) / 180, i = (inclDeg * Math.PI) / 180;
  const pSemi = a * (1 - e * e);
  const r = pSemi / (1 + e * Math.cos(nu));
  const vk = Math.sqrt(mu / pSemi);
  const xo = r * Math.cos(nu), yo = r * Math.sin(nu);         // perifocal
  const vxo = -vk * Math.sin(nu), vyo = vk * (e + Math.cos(nu));
  const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i);
  const R = [cO * cw - sO * sw * ci, -cO * sw - sO * cw * ci, sO * cw + cO * sw * ci, -sO * sw + cO * cw * ci, sw * si, cw * si];
  const ex = (x: number, y: number) => [R[0] * x + R[1] * y, R[2] * x + R[3] * y, R[4] * x + R[5] * y];
  const P = ex(xo, yo), V = ex(vxo, vyo);
  // ecliptic (x, y, z) → scene (x, z, y)
  return { pos: [P[0], P[2], P[1]] as [number, number, number], vel: [V[0], V[2], V[1]] as [number, number, number] };
}

// ── Sol ──────────────────────────────────────────────────────────────
// Planets: J2000 mean longitudes, circular orbits, real inclinations.
// Dwarf planets / comets: real a, e, i, ω, Ω; perihelion & aphelion mapped
// separately. Their current positions (true anomalies) are illustrative.
export function solarSystem(): SystemDef {
  const scale: DistanceScale = { kind: 'power', r0: 4, rMax: 30, auMax: 30.07 };
  const rows = [
    { id: 'mercury', name: 'Mercury', au: 0.387, massE: 0.0553, rKm: 2440, radius: 0.16, color: 0x9c8e85, tex: 'rock', L: 252.25, incl: 7.0, info: 'Smallest planet. A year lasts 88 days; the surface swings from −180 °C to +430 °C.' },
    { id: 'venus', name: 'Venus', au: 0.723, massE: 0.815, rKm: 6052, radius: 0.28, color: 0xe8c98a, tex: 'lava', L: 181.98, incl: 3.39, info: 'Runaway greenhouse under 92 bar of CO₂ — hottest surface in the system (~465 °C). Spins backwards.', albedo: 0.77 },
    { id: 'earth', name: 'Earth', au: 1.0, massE: 1.0, rKm: 6371, radius: 0.3, color: 0x4d8fd1, tex: 'earth', L: 100.46, incl: 0.0, info: 'The only known world with surface oceans and life.' },
    { id: 'mars', name: 'Mars', au: 1.524, massE: 0.107, rKm: 3390, radius: 0.22, color: 0xc1583b, tex: 'rock', L: 355.45, incl: 1.85, info: 'Iron-oxide dust and Olympus Mons, the tallest volcano known (~22 km).' },
    { id: 'jupiter', name: 'Jupiter', au: 5.203, massE: 317.8, rKm: 69911, radius: 1.05, color: 0xd8a56e, tex: 'gas', L: 34.4, incl: 1.3, info: 'More massive than all other planets combined. The Great Red Spot is a centuries-old storm.', albedo: 0.34 },
    { id: 'saturn', name: 'Saturn', au: 9.537, massE: 95.2, rKm: 58232, radius: 0.88, color: 0xe3cf9b, tex: 'gas', ring: true, L: 49.94, incl: 2.49, info: 'Rings of nearly pure water ice, ~280 000 km wide but typically ~10 m thick.', albedo: 0.34 },
    { id: 'uranus', name: 'Uranus', au: 19.19, massE: 14.5, rKm: 25362, radius: 0.55, color: 0x9fd8dd, tex: 'ice', L: 313.23, incl: 0.77, info: 'Ice giant tipped 98° — it rolls around the Sun on its side.' },
    { id: 'neptune', name: 'Neptune', au: 30.07, massE: 17.1, rKm: 24622, radius: 0.52, color: 0x4a6fd4, tex: 'ice', L: 304.88, incl: 1.77, info: 'Predicted mathematically by Le Verrier from Uranus’ orbit before it was seen (1846).' },
  ] as const;

  const sun = makeStar('sun', 'Sun', 1, 'G2V main-sequence star holding 99.86 % of the system’s mass. Core ≈ 15 million K.', { radius: 1.6, realRadiusKm: R_SUN_KM, lum: 1, teff: 5772, color: 0xffd27a });
  const bodies: BodyDef[] = [sun];
  for (const p of rows) {
    const r = toDisplay(p.au, scale);
    const st = orbitState(r, sun.mass, (p.L * Math.PI) / 180, p.incl);
    bodies.push({
      id: p.id, name: p.name, kind: 'planet', mass: p.massE * EARTH_MASS_SIM, radius: p.radius,
      ...st, color: p.color, tex: p.tex, ring: 'ring' in p ? p.ring : undefined,
      info: p.info, realRadiusKm: p.rKm, albedo: 'albedo' in p ? p.albedo : 0.3,
    });
  }
  // dwarf planets, a comet and a sednoid: [id, name, a, e, i, ω, Ω, ν(illustrative), mass kg, radius km, colour, info]
  const small = [
    ['ceres', 'Ceres', 2.767, 0.0785, 10.59, 73.6, 80.3, 40, 9.38e20, 470, 0x8d877f, 'Dwarf planet and largest asteroid (~25 % of the belt’s mass). Bright salt deposits in Occator crater.'],
    ['pluto', 'Pluto', 39.48, 0.2488, 17.16, 113.8, 110.3, 75, 1.303e22, 1188, 0xc9a98a, 'Dwarf planet in the 3:2 resonance with Neptune — which keeps the two from ever meeting. Nitrogen-ice heart, Sputnik Planitia.'],
    ['haumea', 'Haumea', 43.1, 0.195, 28.2, 239, 122.1, 200, 4.0e21, 780, 0xd8d8d8, 'Spins every 3.9 h, stretched into an ellipsoid; has a ring and two moons.'],
    ['makemake', 'Makemake', 45.4, 0.16, 29.0, 297, 79.6, 160, 3.1e21, 715, 0xc98f6f, 'Reddish dwarf planet of the classical Kuiper belt.'],
    ['eris', 'Eris', 67.9, 0.44, 44.0, 151.6, 35.9, 205, 1.66e22, 1163, 0xe0e0e0, 'Most massive dwarf planet; its discovery in 2005 led to Pluto’s reclassification.'],
    ['sedna', 'Sedna', 506, 0.85, 11.93, 311, 144.5, -15, 1e21, 500, 0xb5523b, 'Detached object on an ~11 000-year orbit; perihelion 76 AU, aphelion ~937 AU. Mass is a rough estimate.'],
    ['halley', '1P/Halley', 17.83, 0.967, 162.26, 111.33, 58.42, 178, 2.2e14, 5.5, 0xd7e6ff, 'Periodic comet (76 yr), retrograde orbit. Passed aphelion in Dec 2023; next perihelion July 2061.'],
  ] as const;
  const D2R = Math.PI / 180;
  for (const [id, name, a, e, inc, w, O, nu, kg, rKm, color, info] of small) {
    const kepler: KeplerElements = { a, e, i: inc * D2R, w: w * D2R, O: O * D2R, M0: meanFromTrue(nu * D2R, e) };
    const pos = [0, 0, 0];
    keplerPosition(kepler, 0, sun.mass, (au) => toDisplay(au, scale), 0, 0, 0, pos);
    bodies.push({
      id, name, kind: 'planet', mass: (kg / 5.972e24) * EARTH_MASS_SIM,
      radius: id === 'halley' ? 0.08 : Math.max(displayRadiusPlanet(rKm / R_EARTH_KM), 0.1),
      pos: [pos[0], pos[1], pos[2]], vel: [0, 0, 0], color, tex: id === 'halley' ? 'ice' : 'rock',
      info: info + ' Moves as a Keplerian test particle on its real orbit (its pull on the planets is negligible).',
      realRadiusKm: rKm, kepler,
    });
  }

  const by = (id: string) => bodies.find((b) => b.id === id)!;
  // moons: [id, name, parent, mass kg, radius km, a km, period d (negative = retrograde), colour, info]
  const moons = [
    ['moon', 'Moon', 'earth', 7.342e22, 1737, 384400, 27.32, 0xb8b8b0, 'Tidally locked; stabilises Earth’s axial tilt.'],
    ['phobos', 'Phobos', 'mars', 1.06e16, 11.3, 9376, 0.319, 0x7d6e62, 'Spirals inward ~2 cm/yr; will break up or crash in ~50 Myr.'],
    ['deimos', 'Deimos', 'mars', 1.5e15, 6.2, 23463, 1.263, 0x8e8174, 'Tiny, smooth outer moon of Mars.'],
    ['io', 'Io', 'jupiter', 8.93e22, 1822, 421700, 1.769, 0xd9c35a, 'Most volcanically active body known — tidal heating from Jupiter.'],
    ['europa', 'Europa', 'jupiter', 4.8e22, 1561, 671034, 3.551, 0xcbb9a0, 'Global salt-water ocean beneath an ice shell.'],
    ['ganymede', 'Ganymede', 'jupiter', 1.48e23, 2634, 1070412, 7.155, 0x9c9488, 'Largest moon in the Solar System — bigger than Mercury. Io–Europa–Ganymede are in a 1:2:4 resonance.'],
    ['callisto', 'Callisto', 'jupiter', 1.076e23, 2410, 1882709, 16.69, 0x6e665e, 'Ancient, heavily cratered surface.'],
    ['mimas', 'Mimas', 'saturn', 3.75e19, 198, 185539, 0.942, 0xbdbdbd, 'Giant Herschel crater; may hide a young ocean.'],
    ['enceladus', 'Enceladus', 'saturn', 1.08e20, 252, 237948, 1.370, 0xf2f6ff, 'Geysers of water from a subsurface ocean feed Saturn’s E ring.'],
    ['tethys', 'Tethys', 'saturn', 6.17e20, 531, 294619, 1.888, 0xd6d6d6, 'Nearly pure water ice.'],
    ['dione', 'Dione', 'saturn', 1.095e21, 561, 377396, 2.737, 0xcfcfcf, 'Bright ice cliffs.'],
    ['rhea', 'Rhea', 'saturn', 2.31e21, 764, 527108, 4.518, 0xc8c8c8, 'Saturn’s second-largest moon.'],
    ['titan', 'Titan', 'saturn', 1.345e23, 2575, 1221870, 15.945, 0xd6a756, 'Thick nitrogen atmosphere and methane lakes. Dragonfly launches 2028.'],
    ['iapetus', 'Iapetus', 'saturn', 1.81e21, 735, 3560820, 79.32, 0x8a7a66, 'Two-toned: one hemisphere dark as coal, the other bright as snow.'],
    ['miranda', 'Miranda', 'uranus', 6.4e19, 236, 129390, 1.413, 0xb0b8bd, 'Patchwork terrain with 20 km cliffs.'],
    ['ariel', 'Ariel', 'uranus', 1.25e21, 579, 191020, 2.520, 0xb8c0c4, 'Brightest Uranian moon.'],
    ['umbriel', 'Umbriel', 'uranus', 1.27e21, 585, 266000, 4.144, 0x6f7477, 'Darkest of the major Uranian moons.'],
    ['titania', 'Titania', 'uranus', 3.4e21, 789, 435910, 8.706, 0xa8a49e, 'Largest moon of Uranus.'],
    ['oberon', 'Oberon', 'uranus', 3.08e21, 761, 583520, 13.46, 0x9a948c, 'Outermost major moon of Uranus.'],
    ['triton', 'Triton', 'neptune', 2.14e22, 1353, 354759, -5.877, 0xd8c8c0, 'Retrograde orbit — a captured Kuiper-belt object. Nitrogen geysers.'],
    ['charon', 'Charon', 'pluto', 1.586e21, 606, 19591, 6.387, 0x9c9a96, 'Half Pluto’s size; the pair orbit a point between them and are mutually tidally locked.'],
  ] as const;
  const outer: Record<string, number> = {};
  for (const m of moons) outer[m[2]] = Math.max(outer[m[2]] ?? 0, m[5]);
  moons.forEach(([id, name, parent, kg, rKm, aKm, P, color, info], i) => {
    const par = by(parent);
    const moon = makeMoon(id, name, par, kg / 5.972e24, rKm, moonOrbit(par, aKm, outer[parent]), Math.abs(P), (i * 2.39) % (Math.PI * 2), info, color);
    if (P < 0) moon.periodSim = -moon.periodSim!;
    bodies.push(moon);
  });

  toBarycentric(bodies);
  return { id: 'solar', name: 'Sol', subtitle: 'Home system · 8 planets, 5 dwarf planets, Sedna, Halley’s Comet, 21 moons, 6 belts', bodies, scale, belts: solBelts(5.203, 30.07) };
}

// ── TRAPPIST-1 (Agol et al. 2021) ────────────────────────────────────
export function trappistSystem(): SystemDef {
  const auMax = 0.06189;
  const scale: DistanceScale = { kind: 'linear', r0: 0, rMax: 28, auMax };
  const star = makeStar('trap-star', 'TRAPPIST-1', 0.0898, 'Ultracool M8V red dwarf 40 ly away, barely larger than Jupiter.', { realRadiusKm: 0.1192 * R_SUN_KM, lum: 0.000553, teff: 2566, radius: 0.9 });
  const rows = [
    ['b', 0.01154, 1.374, 1.116, 0xc98d6b, 'rock'], ['c', 0.0158, 1.308, 1.097, 0xb97e5e, 'rock'],
    ['d', 0.02227, 0.388, 0.788, 0x8fae7a, 'rock'], ['e', 0.02925, 0.692, 0.92, 0x6f9fd0, 'earth'],
    ['f', 0.03849, 1.039, 1.045, 0x74b5c9, 'earth'], ['g', 0.04683, 1.321, 1.129, 0x9fc4d8, 'ice'],
    ['h', 0.06189, 0.326, 0.755, 0xcfd8e3, 'ice'],
  ] as const;
  const bodies: BodyDef[] = [star];
  rows.forEach(([s, au, mE, rE, color, tex], i) => {
    const st = orbitState(toDisplay(au, scale), star.mass, i * 1.7 + 0.4, 0);
    bodies.push({
      id: `trap-${s}`, name: `TRAPPIST-1${s}`, kind: 'planet', mass: mE * EARTH_MASS_SIM,
      radius: displayRadiusPlanet(rE), ...st, color, tex, realRadiusKm: rE * R_EARTH_KM,
      info: 'Part of a resonant chain — neighbouring periods near 8:5, 5:3, 3:2, 3:2, 4:3, 3:2. Linear map keeps those ratios exact.',
    });
  });
  toBarycentric(bodies);
  return { id: 'trappist', name: 'TRAPPIST-1', subtitle: 'Seven rocky worlds · Aquarius, 40 ly', bodies, scale };
}

// ── Kepler-16 (Doyle et al. 2011): real circumbinary planet ─────────────
export function kepler16System(): SystemDef {
  const auMax = 0.7048;
  const scale: DistanceScale = { kind: 'linear', r0: 0, rMax: 28, auMax };
  const A = makeStar('k16-a', 'Kepler-16 A', 0.6897, 'K-dwarf primary. Binary period 41.1 days.', { realRadiusKm: 0.6489 * R_SUN_KM });
  const B = makeStar('k16-b', 'Kepler-16 B', 0.20255, 'M-dwarf companion; eclipses A every 41 days.', { realRadiusKm: 0.2262 * R_SUN_KM });
  const M = A.mass + B.mass;
  const aBin = toDisplay(0.22431, scale), e = 0.15944;
  const rApo = aBin * (1 + e);
  const vApo = Math.sqrt((M * (1 - e)) / (aBin * (1 + e))); // vis-viva at apoapsis
  A.pos = [(-B.mass / M) * rApo, 0, 0]; A.vel = [0, 0, (-B.mass / M) * vApo];
  B.pos = [(A.mass / M) * rApo, 0, 0]; B.vel = [0, 0, (A.mass / M) * vApo];
  const st = orbitState(toDisplay(0.7048, scale), M, 2.0, 0);
  const planet: BodyDef = {
    id: 'k16-b-planet', name: 'Kepler-16b', kind: 'planet', mass: 105.8 * EARTH_MASS_SIM,
    radius: displayRadiusPlanet(8.45), ...st, color: 0xc9a06a, tex: 'gas', realRadiusKm: 8.45 * R_EARTH_KM,
    info: '“Tatooine”: orbits both stars every 229 days, just outside the ~0.65 AU stability limit (Holman & Wiegert 1999).',
  };
  const bodies = [A, B, planet];
  toBarycentric(bodies);
  return { id: 'kepler16', name: 'Kepler-16', subtitle: 'Real circumbinary planet · Cygnus, 245 ly', bodies, scale };
}

function singlePlanetSystem(id: string, starName: string, massSun: number, starInfo: string, teff: number, lum: number,
  pName: string, au: number, massE: number, rE: number, tex: TexStyle, pInfo: string, subtitle: string): SystemDef {
  const scale: DistanceScale = { kind: 'linear', r0: 0, rMax: 16, auMax: au };
  const star = makeStar(`${id}-star`, starName, massSun, starInfo, { teff, lum });
  const st = orbitState(toDisplay(au, scale), star.mass, 1.0, 0);
  const planet: BodyDef = {
    id: `${id}-b`, name: pName, kind: 'planet', mass: massE * EARTH_MASS_SIM, radius: displayRadiusPlanet(rE),
    ...st, color: tex === 'earth' ? 0x5d9ad1 : 0xa98c74, tex, realRadiusKm: rE * R_EARTH_KM, info: pInfo,
  };
  const bodies = [star, planet];
  toBarycentric(bodies);
  return { id, name: starName, subtitle, bodies, scale };
}

export const kepler442System = () => singlePlanetSystem('kepler442', 'Kepler-442', 0.61,
  'K-type dwarf, 1 206 ly away in Lyra.', 4402, 0.117,
  'Kepler-442b', 0.409, 2.36, 1.34, 'earth',
  'Super-Earth in the habitable zone (radius 1.34 R⊕; mass is an estimate — no RV measurement).',
  'One confirmed planet · Lyra, 1 206 ly');

export const ross128System = () => singlePlanetSystem('ross128', 'Ross 128', 0.168,
  'Quiet M4V red dwarf, 11 ly away — unusually few flares for its type.', 3192, 0.00362,
  'Ross 128 b', 0.0496, 1.4, 1.1, 'rock',
  'Temperate Earth-mass planet (minimum mass 1.4 M⊕), 9.9-day orbit. Radius is an estimate.',
  'One confirmed planet · Virgo, 11 ly');

// ── Alpha Centauri A & B (Akeson et al. 2021; Pourbaix & Boffin 2016) ─────
export function alphaCenSystem(): SystemDef {
  const a = 23.4, e = 0.5179, auMax = a * (1 + e);
  const scale: DistanceScale = { kind: 'linear', r0: 0, rMax: 30, auMax };
  const A = makeStar('acen-a', 'α Centauri A', 1.0788, 'G2V — a near-twin of the Sun, 4.37 ly away. A candidate giant planet was reported from JWST imaging in 2025 (unconfirmed).', { realRadiusKm: 1.2175 * R_SUN_KM, lum: 1.519, teff: 5790 });
  const B = makeStar('acen-b', 'α Centauri B', 0.9092, 'K1V companion; the pair orbit each other every 79.9 years.', { realRadiusKm: 0.8591 * R_SUN_KM, lum: 0.5, teff: 5260 });
  const M = A.mass + B.mass;
  const aD = toDisplay(a, scale), rApo = aD * (1 + e);
  const vApo = Math.sqrt((M * (1 - e)) / (aD * (1 + e)));
  A.pos = [(-B.mass / M) * rApo, 0, 0]; A.vel = [0, 0, (-B.mass / M) * vApo];
  B.pos = [(A.mass / M) * rApo, 0, 0]; B.vel = [0, 0, (A.mass / M) * vApo];
  const bodies = [A, B];
  toBarycentric(bodies);
  return { id: 'alphacen', name: 'α Centauri', subtitle: 'Nearest Sun-like stars · 4.37 ly · binary, e = 0.52', bodies, scale };
}

// ── Proxima Centauri (Faria et al. 2022) ────────────────────────────
export function proximaSystem(): SystemDef {
  const scale: DistanceScale = { kind: 'linear', r0: 0, rMax: 22, auMax: 0.04857 };
  const star = makeStar('prox-star', 'Proxima Centauri', 0.1221, 'M5.5V flare star — the nearest star to the Sun (4.24 ly). Orbits α Cen A/B at ~13 000 AU.', { realRadiusKm: 0.1542 * R_SUN_KM, lum: 0.00155, teff: 2992, radius: 1.0 });
  const mk = (id: string, name: string, au: number, mE: number, info: string, phase: number, tex: TexStyle): BodyDef => {
    const rE = planetRadiusEarth(mE);
    return { id, name, kind: 'planet', mass: mE * EARTH_MASS_SIM, radius: displayRadiusPlanet(rE), ...orbitState(toDisplay(au, scale), star.mass, phase, 0), color: tex === 'earth' ? 0x6f9fd0 : 0xa98c74, tex, realRadiusKm: rE * R_EARTH_KM, info };
  };
  const bodies = [star,
    mk('prox-d', 'Proxima d', 0.02885, 0.26, 'Sub-Earth (minimum mass 0.26 M⊕), 5.1-day orbit. Radius estimated.', 2.0, 'rock'),
    mk('prox-b', 'Proxima b', 0.04857, 1.07, 'Earth-mass planet (minimum 1.07 M⊕) in the habitable zone, 11.2-day orbit — but blasted by stellar flares. Radius estimated.', 0.3, 'earth')];
  toBarycentric(bodies);
  return { id: 'proxima', name: 'Proxima Centauri', subtitle: 'Nearest star · 2 confirmed planets', bodies, scale };
}

// ── 51 Pegasi (Mayor & Queloz 1995) ──────────────────────────────────
export const peg51System = () => singlePlanetSystem('peg51', '51 Pegasi', 1.11,
  'G5V star 50 ly away in Pegasus.', 5768, 1.36,
  '51 Pegasi b', 0.0527, 146, 13, 'gas',
  'First exoplanet found around a Sun-like star (1995, Nobel Prize 2019). A hot Jupiter: 4.23-day orbit, minimum mass 0.46 M♃. Radius estimated.',
  'The first hot Jupiter · Pegasus, 50 ly');

// ── supermassive black holes ─────────────────────────────────────────
/** SMBH with an S-star-like cluster on Keplerian ellipses; timeScale makes orbits watchable. */
export function smbhSystem(id: string, name: string, massSun: number, seed: number, info: string, s2 = false): SystemDef {
  const rng = new Rng(seed);
  const bh: BodyDef = {
    id: `${id}-bh`, name, kind: 'blackhole', mass: massSun * SUN_MASS_SIM, radius: 0.6,
    pos: [0, 0, 0], vel: [0, 0, 0], color: 0, tex: 'blackhole', info,
  };
  const scale: DistanceScale = { kind: 'linear', r0: 0, rMax: 40, auMax: 2000 * Math.cbrt(massSun / 4.3e6) };
  const bodies: BodyDef[] = [bh];
  const mu = bh.mass;
  const addStar = (sid: string, sname: string, mSun: number, aAU: number, e: number, inc: number, w: number, O: number, nu: number, sinfo: string) => {
    const sp = starFromMass(Math.min(mSun, 40));
    const st = ellipticalState(aAU * (1 - e), aAU * (1 + e), scale, mu, inc, w, O, nu);
    bodies.push({ id: sid, name: sname, kind: 'star', mass: mSun * SUN_MASS_SIM, radius: 0.12, ...st, color: sp.color, tex: 'star', info: sinfo, lum: sp.lum, teff: sp.teff, realRadiusKm: sp.radiusSun * R_SUN_KM });
  };
  // S2 / S0-2 (GRAVITY Collaboration 2020): a = 1039 AU, e = 0.884, P = 16.05 yr, i = 134.6°, ω = 66.1°, Ω = 228.2°
  if (s2) addStar('s2', 'S2 (S0-2)', 14, 1039, 0.884, 134.6, 66.1, 228.2, 180, 'B-type star on a 16-year orbit; its 2018 periapsis passage (120 AU, 7 650 km/s) confirmed gravitational redshift near a black hole.');
  const scaleAU = scale.auMax / 2;
  for (let i = 0; i < 10; i++) {
    const aAU = scaleAU * rng.range(0.3, 1.6);
    const eCap = 1 - (3 * scale.auMax) / (scale.rMax * aAU); // keep periapsis ≥ 3 display units (5× the hole)
    addStar(`${id}-s${i}`, `Model star ${i + 1}`, rng.logRange(3, 20), aAU, Math.min(rng.range(0.2, 0.9), Math.max(eCap, 0)),
      rng.range(0, 180), rng.range(0, 360), rng.range(0, 360), rng.range(0, 360), 'Procedural (made-up) star of the nuclear star cluster — real stars here are not individually known except for the S-stars around Sgr A*.');
  }
  // slow this system's clock so the median stellar period appears as ≈ 20 sim-s
  const periods = bodies.slice(1).map((b) => {
    const r = Math.hypot(...b.pos), v2 = b.vel[0] ** 2 + b.vel[1] ** 2 + b.vel[2] ** 2;
    const a = 1 / (2 / r - v2 / mu);
    return 2 * Math.PI * Math.sqrt(a ** 3 / mu);
  }).sort((x, y) => x - y);
  const timeScale = periods[Math.floor(periods.length / 2)] / 20; // seen period = P / timeScale
  toBarycentric(bodies);
  return { id, name, subtitle: `Supermassive black hole · ${(massSun / 1e6).toPrecision(3)} million M☉`, bodies, scale, timeScale };
}

export const sgrASystem = () => smbhSystem('sgra', 'Sagittarius A*', 4.297e6, 4297,
  'The Milky Way’s central black hole, 4.3 million M☉ (GRAVITY 2022), imaged by the Event Horizon Telescope in 2022.', true);
export const m87System = () => smbhSystem('m87', 'M87*', 6.5e9, 87,
  'First black hole ever imaged (Event Horizon Telescope, 2019): 6.5 billion M☉. Drives a 5 000-light-year jet.');

// ── NASA Exoplanet Archive catalog rows → system ─────────────────────
export interface CatalogPlanet { name: string; a?: number; periodDays?: number; massE?: number; radE?: number; ecc?: number }
export interface CatalogHost { name: string; starMass?: number; teff?: number; starRad?: number; lumLog?: number; distPc?: number; planets: CatalogPlanet[] }

export function catalogSystem(h: CatalogHost): SystemDef {
  const mStar = h.starMass && h.starMass > 0 ? h.starMass : 1;
  const sp = starFromMass(mStar);
  const lum = h.lumLog !== undefined ? Math.pow(10, h.lumLog) : sp.lum;
  const star = makeStar(`cat-${h.name}`, h.name, mStar,
    `Catalog star${h.distPc ? ` · ${(h.distPc * 3.2616).toFixed(1)} ly` : ''} · data from the NASA Exoplanet Archive (missing values estimated).`,
    { teff: h.teff ?? sp.teff, lum, ...(h.starRad ? { realRadiusKm: h.starRad * R_SUN_KM } : {}) });
  const pl = h.planets.map((p) => {
    const a = p.a ?? (p.periodDays ? Math.cbrt(mStar * (p.periodDays / 365.25) ** 2) : undefined);
    const massE = p.massE ?? (p.radE ? (p.radE < 1.23 ? Math.pow(p.radE, 1 / 0.279) : Math.pow(p.radE / 0.8, 1 / 0.589)) : 1);
    return { ...p, a, massE, radE: p.radE ?? planetRadiusEarth(massE), ecc: Math.min(Math.max(p.ecc ?? 0, 0), 0.95) };
  }).filter((p): p is typeof p & { a: number } => p.a !== undefined && p.a > 0).sort((x, y) => x.a - y.a);
  if (!pl.length) return { id: `cat-${h.name}`, name: h.name, subtitle: 'Catalog system (no usable orbits)', bodies: [star], scale: { kind: 'linear', r0: 0, rMax: 28, auMax: 1 } };
  const auMin = pl[0].a * (1 - pl[0].ecc), auMax = pl[pl.length - 1].a * (1 + pl[pl.length - 1].ecc);
  const r0 = star.radius * 2.6 + 1.5;
  const scale: DistanceScale = (28 * auMin) / auMax >= r0 ? { kind: 'linear', r0: 0, rMax: 28, auMax } : { kind: 'power', r0, rMax: r0 + 26, auMax };
  const rng = new Rng(h.name.length * 7919 + pl.length);
  const bodies: BodyDef[] = [star];
  for (const p of pl) {
    const teq = equilibriumTemp(lum, p.a);
    const tex: TexStyle = p.massE > 50 ? 'gas' : p.massE > 8 ? 'ice' : teq > 700 ? 'lava' : teq < 170 ? 'ice' : 'rock';
    const st = ellipticalState(p.a * (1 - p.ecc), p.a * (1 + p.ecc), scale, star.mass, 0, rng.range(0, 360), 0, rng.range(0, 360));
    bodies.push({
      id: `cat-${p.name}`, name: p.name, kind: 'planet', mass: p.massE * EARTH_MASS_SIM, radius: displayRadiusPlanet(p.radE),
      ...st, color: tex === 'gas' ? 0xd8a56e : tex === 'ice' ? 0x7fb8d8 : tex === 'lava' ? 0xd06a3a : 0xa98c74, tex,
      realRadiusKm: p.radE * R_EARTH_KM,
      info: `a = ${p.a.toFixed(4)} AU${p.periodDays ? ` · P = ${p.periodDays.toFixed(2)} d` : ''} · e = ${p.ecc.toFixed(3)} · T_eq ≈ ${Math.round(teq)} K.`,
    });
  }
  toBarycentric(bodies);
  return { id: `cat-${h.name}`, name: h.name, subtitle: `NASA Exoplanet Archive · ${pl.length} planet${pl.length > 1 ? 's' : ''}`, bodies, scale };
}

export function sandboxSystem(): SystemDef {
  const star = makeStar('sandbox-star', 'Sandbox Star', 1, 'A Sun-like star with nothing around it. Add bodies from the Create tab.');
  return { id: 'sandbox', name: 'Sandbox', subtitle: 'Empty system · build your own', bodies: [star], scale: { kind: 'power', r0: 4, rMax: 30, auMax: 30 } };
}

// ── procedural ───────────────────────────────────────────────────────
const LETTERS = 'bcdefghijk';
const ROCK_COLORS = [0xc1583b, 0x9c8e85, 0xa98c74, 0x8a7f73, 0xb07a5a];
const GAS_COLORS = [0xd8a56e, 0xc9b06a, 0xe3cf9b, 0xb98f6a];
const ICE_COLORS = [0x9fd8dd, 0x4a6fd4, 0x7fb8d8, 0xa8c4d8];

export interface ProceduralOpts { seed: number; name?: string; cls?: SpectralClass; massSun?: number; binary?: boolean }

export function proceduralSystem(o: ProceduralOpts): SystemDef {
  const rng = new Rng(o.seed);
  const cls = o.cls ?? rng.pick(['G', 'K', 'M', 'M', 'K', 'F', 'A'] as SpectralClass[]);
  const ci = CLASS_INFO[cls];
  const massSun = o.massSun ?? rng.logRange(ci.mMin, ci.mMax);
  const starName = o.name ?? `${properName(rng)}-${rng.int(100, 999)}`;
  const sp = starFromMass(massSun);
  const binary = o.binary ?? rng.chance(0.15);

  const star = makeStar('p-star', starName, massSun, `${sp.cls}-type main-sequence star · ${Math.round(sp.teff)} K. Procedurally generated from seed ${o.seed}.`);
  const bodies: BodyDef[] = [star];
  let companionMass = 0;
  let aBinAU = 0;
  if (binary) {
    const q = rng.range(0.25, 0.85);
    const comp = makeStar('p-star-b', `${starName} B`, massSun * q, 'Binary companion. Planets orbit outside the binary’s instability zone (> 4 × separation, Holman & Wiegert 1999).');
    companionMass = comp.mass;
    aBinAU = rng.range(0.03, 0.15) * Math.sqrt(sp.lum + 0.05);
    bodies.push(comp);
  }

  // planets: geometric spacing (Titius–Bode-like, ratio 1.4–2.0 ≈ stable Hill spacing)
  const n = rng.int(binary ? 1 : 2, Math.min(9, 3 + Math.round(massSun * 3)));
  let au = Math.max(rng.range(0.04, 0.35) * Math.pow(massSun, 0.8), binary ? aBinAU * 4.2 : 0.01);
  const hz = habitableZone(sp.lum, sp.teff);
  const snow = snowLine(sp.lum);
  const rows: { au: number; massE: number; tex: TexStyle; ring: boolean; color: number; label: string }[] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) au *= rng.range(1.4, 2.0);
    const teq = equilibriumTemp(sp.lum, au);
    let massE: number, tex: TexStyle, label: string, color: number;
    const beyondSnow = au > snow;
    if (beyondSnow && rng.chance(0.55)) {
      massE = rng.logRange(30, 1500); tex = 'gas'; label = 'Gas giant'; color = rng.pick(GAS_COLORS);
    } else if (beyondSnow) {
      massE = rng.logRange(8, 30); tex = 'ice'; label = 'Ice giant'; color = rng.pick(ICE_COLORS);
    } else if (au < 0.1 && rng.chance(0.08)) {
      massE = rng.logRange(100, 1000); tex = 'gas'; label = 'Hot Jupiter'; color = 0xd8865a;
    } else {
      massE = rng.logRange(0.08, 6);
      label = massE > 2 ? 'Super-Earth' : 'Rocky planet';
      if (teq > 700) { tex = 'lava'; color = 0xd06a3a; }
      else if (au >= hz.inner && au <= hz.outer && rng.chance(0.6)) { tex = 'earth'; color = 0x4d8fd1; }
      else if (teq < 170) { tex = 'ice'; color = 0xcfd8e3; }
      else { tex = 'rock'; color = rng.pick(ROCK_COLORS); }
    }
    rows.push({ au, massE, tex, ring: tex === 'gas' && rng.chance(0.3), color, label });
  }

  const auMin = rows[0].au, auMax = rows[rows.length - 1].au;
  const starR = star.radius;
  const linearOK = (28 * auMin) / auMax >= starR * 2.6 + 1 && (!binary || (28 * aBinAU) / auMax >= starR * 2.2);
  const r0 = binary ? Math.max(starR * 2.6 + 1.5, starR * 2.4 * 4.2) : starR * 2.6 + 1.5;
  const scale: DistanceScale = linearOK
    ? { kind: 'linear', r0: 0, rMax: 28, auMax }
    : { kind: 'power', r0, rMax: r0 + 26, auMax };

  const centralMass = star.mass + companionMass;
  if (binary) {
    const comp = bodies[1];
    const sep = linearOK ? toDisplay(aBinAU, scale) : scale.r0 / 4.2; // planets start ≥ 4.2× separation
    const M = centralMass;
    const v = Math.sqrt(M / sep);
    star.pos = [(-comp.mass / M) * sep, 0, 0]; star.vel = [0, 0, (-comp.mass / M) * v];
    comp.pos = [(star.mass / M) * sep, 0, 0]; comp.vel = [0, 0, (star.mass / M) * v];
  }

  rows.forEach((r, i) => {
    const rE = planetRadiusEarth(r.massE);
    const st = orbitState(toDisplay(r.au, scale), centralMass, rng.range(0, Math.PI * 2), rng.gauss() * 1.5);
    const teq = equilibriumTemp(sp.lum, r.au);
    const planet: BodyDef = {
      id: `p-${i}`, name: `${starName} ${LETTERS[i]}`, kind: 'planet', mass: r.massE * EARTH_MASS_SIM,
      radius: displayRadiusPlanet(rE), ...st, color: r.color, tex: r.tex, ring: r.ring,
      realRadiusKm: rE * R_EARTH_KM, texSeed: rng.int(1, 9999),
      info: `${r.label} at ${r.au.toFixed(3)} AU · T_eq ≈ ${Math.round(teq)} K${r.massE > 50 ? ` · ${(r.massE / JUPITER_IN_EARTH).toFixed(2)} M♃` : ''}.`,
    };
    bodies.push(planet);
    const nMoons = r.tex === 'gas' ? rng.int(1, 4) : r.tex === 'ice' && r.massE > 8 ? rng.int(0, 2) : rng.chance(0.2) ? 1 : 0;
    const periods = Array.from({ length: nMoons }, () => rng.logRange(1.2, 25)).sort((a, b) => a - b);
    periods.forEach((P, k) => {
      const aRel = Math.pow(P / periods[periods.length - 1], 2 / 3); // Kepler III among sibling moons
      const moonRkm = rng.logRange(200, 2600);
      bodies.push(makeMoon(`p-${i}-m${k}`, `${planet.name} ${['I', 'II', 'III', 'IV'][k]}`, planet,
        rng.logRange(0.0005, 0.03), moonRkm, planet.radius * (1.8 + 2.2 * Math.sqrt(aRel)), P,
        rng.range(0, Math.PI * 2), `Procedural moon · period ${P.toFixed(1)} d (real-day scale).`,
        rng.pick([0xb8b8b0, 0x9c9488, 0xcbb9a0, 0xd9c35a])));
    });
  });

  // debris disk beyond the outermost planet in ~45 % of systems (cf. Kuiper belt / ε Eridani)
  const belts: BeltDef[] | undefined = rng.chance(0.45) ? [{
    id: 'debris', name: `${starName} debris disk`, kind: 'debris', count: 2500,
    aMin: auMax * 1.35, aMax: auMax * rng.range(1.8, 2.6), eMax: 0.12, iMaxDeg: 8,
    color: 0xa8b4cc, size: 0.1, seed: o.seed ^ 0xd15c, realCount: 'procedural',
    info: 'Leftover planetesimals beyond the outermost planet — like our Kuiper belt.',
  }] : undefined;
  toBarycentric(bodies);
  return {
    belts,
    id: `proc-${o.seed}`, name: starName,
    subtitle: `${binary ? 'Binary · ' : ''}${sp.cls}-type · ${rows.length} planets · seed ${o.seed}`,
    bodies, scale,
  };
}

export const PRESETS = [
  { id: 'solar', label: 'Sol' },
  { id: 'alphacen', label: 'α Centauri' },
  { id: 'proxima', label: 'Proxima' },
  { id: 'trappist', label: 'TRAPPIST-1' },
  { id: 'kepler16', label: 'Kepler-16' },
  { id: 'kepler442', label: 'Kepler-442' },
  { id: 'ross128', label: 'Ross 128' },
  { id: 'peg51', label: '51 Pegasi' },
  { id: 'sgra', label: 'Sgr A*' },
  { id: 'm87', label: 'M87*' },
  { id: 'sandbox', label: 'Sandbox' },
] as const;

export function getPreset(id: string): SystemDef | null {
  switch (id) {
    case 'solar': return solarSystem();
    case 'alphacen': return alphaCenSystem();
    case 'proxima': return proximaSystem();
    case 'trappist': return trappistSystem();
    case 'kepler16': return kepler16System();
    case 'kepler442': return kepler442System();
    case 'ross128': return ross128System();
    case 'peg51': return peg51System();
    case 'sgra': return sgrASystem();
    case 'm87': return m87System();
    case 'sandbox': return sandboxSystem();
    default: return null;
  }
}

// ── save / load schema (validated on import) ──────────────────────────
const vec3 = z.tuple([z.number(), z.number(), z.number()]);
export const BodySchema = z.object({
  id: z.string(), name: z.string(),
  kind: z.enum(['star', 'planet', 'moon', 'blackhole']),
  mass: z.number().nonnegative(), radius: z.number().positive(),
  pos: vec3, vel: vec3, color: z.number().int(),
  tex: z.enum(['star', 'gas', 'rock', 'ice', 'earth', 'lava', 'blackhole']),
  ring: z.boolean().optional(), info: z.string(),
  realRadiusKm: z.number().optional(), lum: z.number().optional(), teff: z.number().optional(),
  albedo: z.number().optional(), texSeed: z.number().optional(),
  parentId: z.string().optional(), orbitR: z.number().optional(), periodSim: z.number().optional(),
  phase: z.number().optional(), incl: z.number().optional(),
  kepler: z.object({ a: z.number().positive(), e: z.number().min(0).max(0.99), i: z.number(), w: z.number(), O: z.number(), M0: z.number() }).optional(),
});
export const SystemSchema = z.object({
  format: z.literal('cosmos-system'),
  version: z.literal(2),
  savedAt: z.string(),
  system: z.object({
    id: z.string(), name: z.string(), subtitle: z.string(),
    scale: z.object({ kind: z.enum(['linear', 'power']), r0: z.number(), rMax: z.number().positive(), auMax: z.number().positive() }),
    bodies: z.array(BodySchema).min(1).max(400),
    belts: z.array(z.object({
      id: z.string(), name: z.string(), kind: z.enum(['main', 'trojan', 'hilda', 'kuiper', 'scattered', 'oort', 'debris']),
      count: z.number().int().min(1).max(20000), aMin: z.number().positive(), aMax: z.number().positive(),
      eMax: z.number(), iMaxDeg: z.number(), color: z.number().int(), size: z.number().positive(), info: z.string(),
      realCount: z.string().optional(), gaps: z.array(z.number()).optional(), gapWidth: z.number().optional(),
      ofBody: z.string().optional(), clusterA: z.number().optional(), clusterFrac: z.number().optional(), seed: z.number(),
    })).optional(),
    timeScale: z.number().positive().optional(),
    t0: z.number().optional(),
  }),
});
export type SystemSnapshot = z.infer<typeof SystemSchema>;
