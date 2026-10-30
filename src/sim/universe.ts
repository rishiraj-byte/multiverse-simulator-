// Procedural observable universe: galaxies along cosmic-web filaments with
// sparse field galaxies in the voids, inside the comoving horizon sphere.
// Positions are COMOVING; the renderer multiplies by the scale factor a(t)
// (uniform scaling is exactly Hubble's law v = H·d). The Local Group is
// gravitationally bound, so it does not take part in the expansion.
// Every point is enterable: its galaxy is derived from (universe seed, index).

import { Rng, hashSeed } from './rng';
import { MILKY_WAY, type GalaxyParams, type GalaxyType } from './galaxy';

export interface UniverseParams {
  seed: number;
  count: number;      // galaxies
  clustering: number; // 0–1 fraction on filaments
}

export const DEFAULT_UNIVERSE: UniverseParams = { seed: 42, count: 5000, clustering: 0.72 };
export const UNIVERSE_RADIUS = 1000; // = 46.5 Gly comoving radius of today's horizon

export const TYPE_LIST: GalaxyType[] = ['spiral', 'barred', 'elliptical', 'irregular'];

export interface UniverseField {
  params: UniverseParams;
  count: number;
  comoving: Float32Array;
  positions: Float32Array;
  colors: Float32Array;
  types: Uint8Array;
  bound: Uint8Array;  // 1 = Local Group (no Hubble flow)
}

export interface NamedGalaxy {
  index: number; name: string; type: GalaxyType; pos: [number, number, number];
  realDistance: string; realMpc: number; note: string; params?: Partial<GalaxyParams>;
}

// Positions of the Local Group / Virgo are exaggerated (true separations
// are < 1 scene unit at this scale).
export const NAMED_GALAXIES: NamedGalaxy[] = [
  { index: 0, name: 'Milky Way', type: 'barred', pos: [0, 0, 0], realDistance: '0 (you are here)', realMpc: 0, note: 'Our barred spiral. ~100 000 ly across, 100–400 billion stars.', params: MILKY_WAY },
  { index: 1, name: 'Andromeda (M31)', type: 'spiral', pos: [105, 30, 55], realDistance: '2.5 Mly', realMpc: 0.77, note: 'Largest Local Group member; approaching us at ~110 km/s — merger in ~4.5 Gyr. Bound: no Hubble recession.', params: { seed: 31, radiusKpc: 23, massScale: 1.4, arms: 2, pitchDeg: 9, bulgeFrac: 0.22, starCount: 28000 } },
  { index: 2, name: 'Triangulum (M33)', type: 'spiral', pos: [-110, -35, 70], realDistance: '2.7 Mly', realMpc: 0.84, note: 'Third-largest Local Group galaxy, a flocculent spiral with almost no bulge.', params: { seed: 33, radiusKpc: 9, massScale: 0.12, arms: 4, pitchDeg: 25, armStrength: 0.5, bulgeFrac: 0.02, starCount: 16000 } },
  { index: 3, name: 'M87 (Virgo Cluster)', type: 'elliptical', pos: [220, 110, -170], realDistance: '53.5 Mly', realMpc: 16.4, note: 'Giant elliptical at the heart of the Virgo Cluster; its 6.5 billion M☉ black hole was the first ever imaged (EHT 2019).', params: { seed: 87, radiusKpc: 40, massScale: 6, flattening: 0.1, starCount: 26000 } },
];

const TYPE_COLOR: Record<GalaxyType, [number, number, number]> = {
  spiral: [0.75, 0.85, 1.0],
  barred: [0.82, 0.88, 1.0],
  elliptical: [1.0, 0.82, 0.55],
  irregular: [0.6, 0.95, 1.0],
};

export function generateUniverse(p: UniverseParams): UniverseField {
  const rng = new Rng(p.seed);
  const count = Math.max(NAMED_GALAXIES.length + 10, Math.floor(p.count));
  const comoving = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const types = new Uint8Array(count);
  const bound = new Uint8Array(count);

  // filament spine: random-walk chains through the volume
  const nodes: number[][] = [];
  for (let c = 0; c < 16; c++) {
    let x = rng.range(-350, 350), y = rng.range(-350, 350), z = rng.range(-350, 350);
    const steps = rng.int(6, 13);
    const dx = rng.range(-260, 260), dy = rng.range(-260, 260), dz = rng.range(-260, 260);
    for (let i = 0; i < steps; i++) {
      nodes.push([x, y, z]);
      x += dx / steps + rng.gauss() * 25; y += dy / steps + rng.gauss() * 25; z += dz / steps + rng.gauss() * 25;
    }
  }

  for (let i = 0; i < count; i++) {
    const named = NAMED_GALAXIES.find((n) => n.index === i);
    let x: number, y: number, z: number, type: GalaxyType;
    if (named) {
      [x, y, z] = named.pos; type = named.type;
      if (i <= 2) bound[i] = 1;
    } else {
      const onFilament = rng.chance(p.clustering);
      if (onFilament) {
        const n = rng.pick(nodes);
        x = n[0] + rng.gauss() * 24; y = n[1] + rng.gauss() * 24; z = n[2] + rng.gauss() * 24;
      } else {
        // uniform in the ball
        const u = rng.range(-1, 1), t = rng.range(0, Math.PI * 2), r = UNIVERSE_RADIUS * Math.cbrt(rng.next());
        const s = Math.sqrt(1 - u * u);
        x = r * s * Math.cos(t); y = r * u; z = r * s * Math.sin(t);
      }
      const d = Math.hypot(x, y, z);
      if (d > UNIVERSE_RADIUS) { const k = (UNIVERSE_RADIUS * 0.98) / d; x *= k; y *= k; z *= k; }
      // morphology–density relation: ellipticals dominate dense regions (Dressler 1980)
      type = onFilament
        ? TYPE_LIST[rng.weighted([0.35, 0.25, 0.32, 0.08])]
        : TYPE_LIST[rng.weighted([0.42, 0.3, 0.1, 0.18])];
    }
    comoving[i * 3] = x; comoving[i * 3 + 1] = y; comoving[i * 3 + 2] = z;
    types[i] = TYPE_LIST.indexOf(type);
    const c = TYPE_COLOR[type];
    const b = named ? 1.2 : 0.6 + rng.next() * 0.5;
    colors[i * 3] = c[0] * b; colors[i * 3 + 1] = c[1] * b; colors[i * 3 + 2] = c[2] * b;
  }
  return { params: p, count, comoving, positions: comoving.slice(), colors, types, bound };
}

/** Apply scale factor a: comoving → proper positions (bound objects stay put). */
export function applyScale(f: UniverseField, a: number) {
  const c = f.comoving, out = f.positions;
  for (let i = 0; i < f.count; i++) {
    const k = f.bound[i] ? 1 : a;
    out[i * 3] = c[i * 3] * k; out[i * 3 + 1] = c[i * 3 + 1] * k; out[i * 3 + 2] = c[i * 3 + 2] * k;
  }
}

export function galaxyName(index: number, universeSeed: number): string {
  const named = NAMED_GALAXIES.find((n) => n.index === index);
  if (named) return named.name;
  return `GX ${String(hashSeed(universeSeed, index) % 900000 + 100000)}`;
}

/** Deterministic galaxy parameters for the galaxy at `index`. */
export function galaxyParamsFor(f: UniverseField, index: number): GalaxyParams {
  const seed = hashSeed(f.params.seed, index, 0x6a1);
  const named = NAMED_GALAXIES.find((n) => n.index === index);
  const type = TYPE_LIST[f.types[index]];
  if (named?.params) {
    return { ...MILKY_WAY, ...named.params, type: named.type, name: named.name, seed: named.params.seed ?? seed } as GalaxyParams;
  }
  const rng = new Rng(seed);
  const massScale = rng.logRange(0.05, type === 'elliptical' ? 8 : 2.5);
  return {
    seed,
    name: galaxyName(index, f.params.seed),
    type,
    arms: type === 'barred' ? 2 : rng.weighted([0, 0.55, 0.15, 0.25, 0, 0.05]) + 1,
    pitchDeg: rng.range(8, 28),
    armStrength: rng.range(0.45, 0.95),
    starCount: Math.round(rng.range(14000, 26000)),
    bulgeFrac: type === 'irregular' ? 0.02 : rng.range(0.06, 0.3),
    radiusKpc: 15 * Math.pow(massScale, 0.35),
    massScale,
    flattening: type === 'elliptical' ? rng.range(0, 0.7) : 0,
  };
}
