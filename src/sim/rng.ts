// Deterministic randomness. Every procedural object in the universe is
// addressed by a seed derived from its parent's seed + its index, so the
// same universe seed always regenerates the same galaxies, stars, planets.

/** FNV-1a style mix of several integers, finished with the murmur3 fmix32 avalanche. */
export function hashSeed(...parts: number[]): number {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    h ^= p >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= (Math.floor(p / 4294967296) >>> 0); // keep high bits of large ints
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export class Rng {
  private s: number;
  private spare: number | null = null;
  constructor(seed: number) { this.s = (seed >>> 0) || 0x9e3779b9; }

  /** mulberry32 — uniform in [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  /** log-uniform in [a, b] (a, b > 0) */
  logRange(a: number, b: number): number { return Math.exp(this.range(Math.log(a), Math.log(b))); }
  int(a: number, bInclusive: number): number { return a + Math.floor(this.next() * (bInclusive - a + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  /** standard normal via Box–Muller */
  gauss(): number {
    if (this.spare !== null) { const v = this.spare; this.spare = null; return v; }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const mag = Math.sqrt(-2 * Math.log(u));
    this.spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  }
  /** weighted index pick; weights need not sum to 1 */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let x = this.next() * total;
    for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x < 0) return i; }
    return weights.length - 1;
  }
}

const SYL = ['ka', 've', 'lo', 'ri', 'tha', 'sen', 'mor', 'ul', 'ae', 'zan', 'qui', 'dor', 'ny', 'pha', 'es', 'tor'];
export function properName(rng: Rng, syllables = rng.int(2, 3)): string {
  let s = '';
  for (let i = 0; i < syllables; i++) s += rng.pick(SYL);
  return s[0].toUpperCase() + s.slice(1);
}
