// Newtonian N-body core.
//  • Gravity: a_i = Σ G·m_j·(r_j − r_i) / (|r_ij|² + ε²)^(3/2)   (Plummer softening ε)
//  • Integrator: leapfrog kick–drift–kick (velocity Verlet). Symplectic and
//    time-reversible, so energy error stays bounded instead of drifting and
//    running time backwards retraces the orbits.
//    (The previous version updated body i's position before body j's force
//    was computed — that breaks Newton's 3rd law, so momentum was NOT conserved.)
//  • Adaptive substep: h ≤ η · min_ij √(r_ij³ / G(m_i+m_j)) — a fraction of the
//    tightest pair's dynamical time, so close encounters get resolved.
//  • Collisions: perfectly inelastic merge — mass and linear momentum conserved
//    exactly; the merged radius conserves volume.

export interface SimBody {
  id: string;
  mass: number;
  radius: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  ax: number; ay: number; az: number;
}

export interface MergeEvent { keepId: string; absorbedId: string; x: number; y: number; z: number }

export interface PhysicsParams {
  gMult: number;        // multiplier on G
  timeWarp: number;     // sim time per real second (> 0)
  paused: boolean;
  reverse: boolean;     // run time backwards (exact for leapfrog, except merges)
  softening: number;    // Plummer ε (scene units)
  collisions: boolean;
  trails: boolean;
  trailLength: number;  // points per trail
  labels: boolean;
  habitableZone: boolean;
  darkMatter: number;   // halo strength multiplier (galaxy level), 1 = Milky-Way calibrated
  belts: boolean;       // show asteroid belts / clouds
  moonRate: number;     // moon clock multiplier (moons are kinematic)
  galaxyRate: number;   // Myr of galactic time per sim-second
  cosmicRate: number;   // Gyr of cosmic time per sim-second
  // universe map layers
  mapSolar: boolean; mapStars: boolean; mapMilkyWay: boolean; mapGalaxies: boolean;
  mapStructures: boolean; mapWeb: boolean; mapRings: boolean; mapCMB: boolean; mapDipole: boolean;
  mapReal: boolean;     // downloaded real catalogues (stars, galaxies, …)
  mapSimulated: boolean; // modelled components: dark matter, gas, dark energy
  mapLive: boolean;     // real-time events: spacecraft, asteroid flybys, supernovae, black-hole mergers
  mapFlows: boolean;    // arrows: our motion vs the CMB, Great Attractor, disputed dark flow
  cmbPalette: string;   // 'deep' | 'planck' | 'infrared' | 'mono'
  cmbBrightness: number; // 0–1
  fisheye: boolean;     // true equidistant fisheye lens (universe map)
  fisheyeFov: number;   // degrees, up to 360 (whole sky in one circle)
  H0: number;           // Hubble constant, km/s/Mpc (universe level)
  omegaM: number;       // matter density parameter
  omegaL: number;       // dark-energy density parameter
}

export const DEFAULT_PHYSICS: PhysicsParams = {
  gMult: 1,
  timeWarp: 4,
  paused: false,
  reverse: false,
  softening: 0.05,
  collisions: true,
  trails: true,
  trailLength: 400,
  labels: true,
  habitableZone: true,
  darkMatter: 1,
  belts: true,
  moonRate: 1,
  galaxyRate: 1,
  cosmicRate: 0.05,
  mapSolar: true, mapStars: true, mapMilkyWay: true, mapGalaxies: true,
  mapStructures: true, mapWeb: true, mapRings: true, mapCMB: true, mapDipole: false,
  mapReal: true, mapSimulated: true, mapFlows: true, mapLive: true,
  cmbPalette: 'deep',
  cmbBrightness: 0.28,
  fisheye: false,
  fisheyeFov: 220,
  H0: 67.4,      // Planck 2018
  omegaM: 0.315, // Planck 2018
  omegaL: 0.685, // flat ΛCDM
};

export const G0 = 1; // simulation units: Sun = 400 mass units

export function circularOrbitSpeed(massCentral: number, r: number, gMult = 1): number {
  return Math.sqrt((G0 * gMult * massCentral) / Math.max(r, 1e-6));
}

export function orbitalPeriod(r: number, massCentral: number, gMult = 1): number {
  return 2 * Math.PI * Math.sqrt((r * r * r) / (G0 * gMult * massCentral));
}

export interface Diagnostics {
  energy: number;
  px: number; py: number; pz: number;
  lx: number; ly: number; lz: number; // angular momentum about origin
  mass: number;
}

const ETA = 0.015;      // fraction of the tightest dynamical time per substep
const MAX_SUBSTEPS = 600;

export class NBody {
  bodies: SimBody[] = [];

  set(bodies: SimBody[]) {
    this.bodies = bodies;
  }

  get(id: string): SimBody | undefined {
    return this.bodies.find((b) => b.id === id);
  }

  remove(id: string) {
    this.bodies = this.bodies.filter((b) => b.id !== id);
  }

  private accelerations(G: number, eps2: number) {
    const bs = this.bodies;
    const n = bs.length;
    for (let i = 0; i < n; i++) { bs[i].ax = 0; bs[i].ay = 0; bs[i].az = 0; }
    // pairwise, applying equal-and-opposite contributions (Newton's 3rd law)
    for (let i = 0; i < n; i++) {
      const a = bs[i];
      for (let j = i + 1; j < n; j++) {
        const b = bs[j];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const r2 = dx * dx + dy * dy + dz * dz + eps2;
        const inv = G / (r2 * Math.sqrt(r2));
        const fa = b.mass * inv, fb = a.mass * inv;
        a.ax += dx * fa; a.ay += dy * fa; a.az += dz * fa;
        b.ax -= dx * fb; b.ay -= dy * fb; b.az -= dz * fb;
      }
    }
  }

  /** Shortest pairwise dynamical time √(r³/G·M) — sets the substep size. */
  private minDynamicalTime(G: number, eps2: number): number {
    const bs = this.bodies;
    let tmin = Infinity;
    if (G <= 0) return tmin;
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const dx = bs[j].x - bs[i].x, dy = bs[j].y - bs[i].y, dz = bs[j].z - bs[i].z;
        const r2 = dx * dx + dy * dy + dz * dz + eps2;
        const m = bs[i].mass + bs[j].mass;
        if (m <= 0) continue;
        const t = Math.sqrt((r2 * Math.sqrt(r2)) / (G * m));
        if (t < tmin) tmin = t;
      }
    }
    return tmin;
  }

  /**
   * Advance by a signed simulation interval dt (negative = backwards in time).
   * Returns merge events so the renderer can react.
   */
  step(dt: number, p: PhysicsParams): MergeEvent[] {
    const merges: MergeEvent[] = [];
    if (dt === 0 || this.bodies.length === 0) return merges;
    const G = G0 * p.gMult;
    const eps2 = p.softening * p.softening;

    const tdyn = this.minDynamicalTime(G, eps2);
    const hMax = Math.max(ETA * tdyn, Math.abs(dt) / MAX_SUBSTEPS, 1e-12);
    const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(Math.abs(dt) / hMax)));
    const h = dt / steps;
    const half = h * 0.5;

    this.accelerations(G, eps2);
    for (let s = 0; s < steps; s++) {
      const bs = this.bodies;
      for (const b of bs) { // kick ½ + drift
        b.vx += b.ax * half; b.vy += b.ay * half; b.vz += b.az * half;
        b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
      }
      this.accelerations(G, eps2);
      for (const b of bs) { // kick ½
        b.vx += b.ax * half; b.vy += b.ay * half; b.vz += b.az * half;
      }
      if (p.collisions && this.collide(merges)) this.accelerations(G, eps2);
    }
    return merges;
  }

  private collide(out: MergeEvent[]): boolean {
    const bs = this.bodies;
    let any = false;
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      if (a.mass < 0) continue;
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j];
        if (b.mass < 0) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const rr = a.radius + b.radius;
        if (dx * dx + dy * dy + dz * dz < rr * rr * 0.49) {
          const keep = a.mass >= b.mass ? a : b;
          const gone = keep === a ? b : a;
          const m = keep.mass + gone.mass;
          keep.vx = (keep.mass * keep.vx + gone.mass * gone.vx) / m;
          keep.vy = (keep.mass * keep.vy + gone.mass * gone.vy) / m;
          keep.vz = (keep.mass * keep.vz + gone.mass * gone.vz) / m;
          keep.x = (keep.mass * keep.x + gone.mass * gone.x) / m;
          keep.y = (keep.mass * keep.y + gone.mass * gone.y) / m;
          keep.z = (keep.mass * keep.z + gone.mass * gone.z) / m;
          keep.mass = m;
          keep.radius = Math.cbrt(keep.radius ** 3 + gone.radius ** 3);
          gone.mass = -1; // tombstone
          out.push({ keepId: keep.id, absorbedId: gone.id, x: keep.x, y: keep.y, z: keep.z });
          any = true;
        }
      }
    }
    if (any) this.bodies = bs.filter((b) => b.mass >= 0);
    return any;
  }

  /** Total energy (kinetic + softened potential), momentum, angular momentum. */
  diagnostics(p: PhysicsParams): Diagnostics {
    const G = G0 * p.gMult;
    const eps2 = p.softening * p.softening;
    const bs = this.bodies;
    let ke = 0, pe = 0, px = 0, py = 0, pz = 0, lx = 0, ly = 0, lz = 0, mass = 0;
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      mass += a.mass;
      ke += 0.5 * a.mass * (a.vx * a.vx + a.vy * a.vy + a.vz * a.vz);
      px += a.mass * a.vx; py += a.mass * a.vy; pz += a.mass * a.vz;
      lx += a.mass * (a.y * a.vz - a.z * a.vy);
      ly += a.mass * (a.z * a.vx - a.x * a.vz);
      lz += a.mass * (a.x * a.vy - a.y * a.vx);
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        pe -= (G * a.mass * b.mass) / Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
      }
    }
    return { energy: ke + pe, px, py, pz, lx, ly, lz, mass };
  }
}

/**
 * Osculating two-body orbital elements of a body relative to its primary.
 * μ = G(M + m). Standard formulas:
 *   a = 1 / (2/r − v²/μ),   e⃗ = ((v² − μ/r) r⃗ − (r⃗·v⃗) v⃗) / μ,   T = 2π√(a³/μ)
 */
export interface OrbitElements {
  a: number; e: number; period: number | null; bound: boolean;
  periapsis: number; apoapsis: number | null; r: number; v: number; vEscape: number;
}

export function orbitalElements(
  rx: number, ry: number, rz: number, vx: number, vy: number, vz: number, mu: number
): OrbitElements {
  const r = Math.hypot(rx, ry, rz);
  const v2 = vx * vx + vy * vy + vz * vz;
  const rv = rx * vx + ry * vy + rz * vz;
  const k = v2 - mu / r;
  const ex = (k * rx - rv * vx) / mu, ey = (k * ry - rv * vy) / mu, ez = (k * rz - rv * vz) / mu;
  const e = Math.hypot(ex, ey, ez);
  const energy = v2 / 2 - mu / r;
  const bound = energy < 0;
  const a = -mu / (2 * energy);
  const period = bound ? 2 * Math.PI * Math.sqrt((a * a * a) / mu) : null;
  const periapsis = bound ? a * (1 - e) : Math.abs(a) * (e - 1);
  return {
    a, e, period, bound, periapsis,
    apoapsis: bound ? a * (1 + e) : null,
    r, v: Math.sqrt(v2), vEscape: Math.sqrt((2 * mu) / r),
  };
}
