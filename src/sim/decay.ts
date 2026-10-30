// Radioactive decay: real nuclide data (NNDC / ENSDF half-lives, rounded),
// exact Bateman solution for chains with branching, and a Monte-Carlo
// simulation of individual atoms with exponentially distributed decay times.
import { Rng } from './rng';

const Y = 3.15576e7, D = 86400, H = 3600, MIN = 60;

export type DecayMode = 'α' | 'β⁻' | 'β⁺/EC' | 'IT' | 'EC';
export interface Branch { to: string; mode: DecayMode; br: number }
export interface Nuclide { id: string; name: string; Z: number; A: number; halfLife: number; decays: Branch[] }

const N = (id: string, name: string, Z: number, A: number, halfLife: number, decays: Branch[] = []): Nuclide => ({ id, name, Z, A, halfLife, decays });
const b = (to: string, mode: DecayMode, br = 1): Branch => ({ to, mode, br });

export const NUCLIDES: Record<string, Nuclide> = Object.fromEntries([
  // U-238 series (radium series), minor branches < 1 % omitted
  N('U238', 'Uranium-238', 92, 238, 4.468e9 * Y, [b('Th234', 'α')]),
  N('Th234', 'Thorium-234', 90, 234, 24.10 * D, [b('Pa234m', 'β⁻')]),
  N('Pa234m', 'Protactinium-234m', 91, 234, 1.159 * MIN, [b('U234', 'β⁻')]),
  N('U234', 'Uranium-234', 92, 234, 2.455e5 * Y, [b('Th230', 'α')]),
  N('Th230', 'Thorium-230', 90, 230, 7.54e4 * Y, [b('Ra226', 'α')]),
  N('Ra226', 'Radium-226', 88, 226, 1600 * Y, [b('Rn222', 'α')]),
  N('Rn222', 'Radon-222', 86, 222, 3.8235 * D, [b('Po218', 'α')]),
  N('Po218', 'Polonium-218', 84, 218, 3.098 * MIN, [b('Pb214', 'α')]),
  N('Pb214', 'Lead-214', 82, 214, 26.8 * MIN, [b('Bi214', 'β⁻')]),
  N('Bi214', 'Bismuth-214', 83, 214, 19.9 * MIN, [b('Po214', 'β⁻')]),
  N('Po214', 'Polonium-214', 84, 214, 164.3e-6, [b('Pb210', 'α')]),
  N('Pb210', 'Lead-210', 82, 210, 22.2 * Y, [b('Bi210', 'β⁻')]),
  N('Bi210', 'Bismuth-210', 83, 210, 5.012 * D, [b('Po210', 'β⁻')]),
  N('Po210', 'Polonium-210', 84, 210, 138.376 * D, [b('Pb206', 'α')]),
  N('Pb206', 'Lead-206', 82, 206, Infinity),
  // Th-232 series (thorium series)
  N('Th232', 'Thorium-232', 90, 232, 1.405e10 * Y, [b('Ra228', 'α')]),
  N('Ra228', 'Radium-228', 88, 228, 5.75 * Y, [b('Ac228', 'β⁻')]),
  N('Ac228', 'Actinium-228', 89, 228, 6.15 * H, [b('Th228', 'β⁻')]),
  N('Th228', 'Thorium-228', 90, 228, 1.912 * Y, [b('Ra224', 'α')]),
  N('Ra224', 'Radium-224', 88, 224, 3.632 * D, [b('Rn220', 'α')]),
  N('Rn220', 'Radon-220', 86, 220, 55.6, [b('Po216', 'α')]),
  N('Po216', 'Polonium-216', 84, 216, 0.145, [b('Pb212', 'α')]),
  N('Pb212', 'Lead-212', 82, 212, 10.64 * H, [b('Bi212', 'β⁻')]),
  N('Bi212', 'Bismuth-212', 83, 212, 60.55 * MIN, [b('Po212', 'β⁻', 0.6406), b('Tl208', 'α', 0.3594)]),
  N('Po212', 'Polonium-212', 84, 212, 0.299e-6, [b('Pb208', 'α')]),
  N('Tl208', 'Thallium-208', 81, 208, 3.053 * MIN, [b('Pb208', 'β⁻')]),
  N('Pb208', 'Lead-208', 82, 208, Infinity),
  // U-235 series (actinium series), minor branches omitted
  N('U235', 'Uranium-235', 92, 235, 7.04e8 * Y, [b('Th231', 'α')]),
  N('Th231', 'Thorium-231', 90, 231, 25.52 * H, [b('Pa231', 'β⁻')]),
  N('Pa231', 'Protactinium-231', 91, 231, 3.276e4 * Y, [b('Ac227', 'α')]),
  N('Ac227', 'Actinium-227', 89, 227, 21.77 * Y, [b('Th227', 'β⁻')]),
  N('Th227', 'Thorium-227', 90, 227, 18.68 * D, [b('Ra223', 'α')]),
  N('Ra223', 'Radium-223', 88, 223, 11.43 * D, [b('Rn219', 'α')]),
  N('Rn219', 'Radon-219', 86, 219, 3.96, [b('Po215', 'α')]),
  N('Po215', 'Polonium-215', 84, 215, 1.781e-3, [b('Pb211', 'α')]),
  N('Pb211', 'Lead-211', 82, 211, 36.1 * MIN, [b('Bi211', 'β⁻')]),
  N('Bi211', 'Bismuth-211', 83, 211, 2.14 * MIN, [b('Tl207', 'α')]),
  N('Tl207', 'Thallium-207', 81, 207, 4.77 * MIN, [b('Pb207', 'β⁻')]),
  N('Pb207', 'Lead-207', 82, 207, Infinity),
  // single decays / short chains
  N('n', 'Free neutron', 0, 1, 609.6, [b('H1', 'β⁻')]),
  N('H1', 'Hydrogen-1 (proton)', 1, 1, Infinity),
  N('H3', 'Tritium', 1, 3, 12.32 * Y, [b('He3', 'β⁻')]),
  N('He3', 'Helium-3', 2, 3, Infinity),
  N('C14', 'Carbon-14', 6, 14, 5730 * Y, [b('N14', 'β⁻')]),
  N('N14', 'Nitrogen-14', 7, 14, Infinity),
  N('K40', 'Potassium-40', 19, 40, 1.248e9 * Y, [b('Ca40', 'β⁻', 0.8928), b('Ar40', 'EC', 0.1072)]),
  N('Ca40', 'Calcium-40', 20, 40, Infinity),
  N('Ar40', 'Argon-40', 18, 40, Infinity),
  N('Co60', 'Cobalt-60', 27, 60, 5.2714 * Y, [b('Ni60', 'β⁻')]),
  N('Ni60', 'Nickel-60', 28, 60, Infinity),
  N('Sr90', 'Strontium-90', 38, 90, 28.79 * Y, [b('Y90', 'β⁻')]),
  N('Y90', 'Yttrium-90', 39, 90, 64.0 * H, [b('Zr90', 'β⁻')]),
  N('Zr90', 'Zirconium-90', 40, 90, Infinity),
  N('I131', 'Iodine-131', 53, 131, 8.0252 * D, [b('Xe131', 'β⁻')]),
  N('Xe131', 'Xenon-131', 54, 131, Infinity),
  N('Cs137', 'Caesium-137', 55, 137, 30.08 * Y, [b('Ba137m', 'β⁻', 0.946), b('Ba137', 'β⁻', 0.054)]),
  N('Ba137m', 'Barium-137m', 56, 137, 2.552 * MIN, [b('Ba137', 'IT')]),
  N('Ba137', 'Barium-137', 56, 137, Infinity),
  N('Pu239', 'Plutonium-239', 94, 239, 24110 * Y, [b('U235', 'α')]),
].map((n) => [n.id, n]));

export const DECAY_SOURCES = [
  { id: 'U238', label: 'Uranium-238 series' }, { id: 'Th232', label: 'Thorium-232 series' },
  { id: 'U235', label: 'Uranium-235 series' }, { id: 'Pu239', label: 'Plutonium-239 → U-235 series' },
  { id: 'Rn222', label: 'Radon-222 (indoor radon)' }, { id: 'C14', label: 'Carbon-14 (dating)' },
  { id: 'K40', label: 'Potassium-40 (in your body)' }, { id: 'I131', label: 'Iodine-131 (medicine)' },
  { id: 'Cs137', label: 'Caesium-137 (fallout)' }, { id: 'Co60', label: 'Cobalt-60' },
  { id: 'Sr90', label: 'Strontium-90' }, { id: 'H3', label: 'Tritium' }, { id: 'n', label: 'Free neutron' },
];

export const lambda = (n: Nuclide) => (isFinite(n.halfLife) ? Math.LN2 / n.halfLife : 0);

/** Nuclides reachable from a parent, in topological order. */
export function chainOf(parent: string): Nuclide[] {
  const out: Nuclide[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(NUCLIDES[id]);
    for (const d of NUCLIDES[id].decays) visit(d.to);
  };
  visit(parent);
  // topological order by longest path from parent (branches can rejoin, e.g. Bi-212 → Pb-208)
  const depth = new Map<string, number>([[parent, 0]]);
  for (let pass = 0; pass < out.length; pass++)
    for (const n of out) for (const d of n.decays) depth.set(d.to, Math.max(depth.get(d.to) ?? 0, (depth.get(n.id) ?? 0) + 1));
  return out.sort((a, c) => (depth.get(a.id)! - depth.get(c.id)!));
}

/**
 * Exact Bateman solution with branching: N_k(t) = Σ_i A[k][i]·e^{−λ_i t}.
 *   A[k][i] = Σ_parents j  br_jk λ_j A[j][i] / (λ_k − λ_i)   (i ≠ k),   A[k][k] = N_k(0) − Σ_{i≠k} A[k][i].
 * Requires distinct λ (true for every chain here).
 */
export function bateman(parent: string, n0 = 1) {
  const chain = chainOf(parent);
  const idx = new Map(chain.map((n, i) => [n.id, i]));
  const lam = chain.map(lambda);
  const A = chain.map(() => new Array<number>(chain.length).fill(0));
  A[0][0] = n0;
  for (let k = 1; k < chain.length; k++) {
    const parents: { j: number; br: number }[] = [];
    chain.forEach((p, j) => p.decays.forEach((d) => { if (d.to === chain[k].id) parents.push({ j, br: d.br }); }));
    let sum = 0;
    for (let i = 0; i < chain.length; i++) {
      if (i === k) continue;
      let s = 0;
      for (const { j, br } of parents) s += br * lam[j] * A[j][i];
      if (s !== 0) { A[k][i] = s / (lam[k] - lam[i]); sum += A[k][i]; }
    }
    A[k][k] = -sum;
  }
  const amounts = (t: number) => {
    const out = chain.map((_, k) => {
      let v = 0;
      for (let i = 0; i < chain.length; i++) if (A[k][i] !== 0) v += A[k][i] * Math.exp(-lam[i] * t);
      return Math.max(v, 0);
    });
    // stable end products: fix cancellation error with conservation of nuclei
    const unstable = out.reduce((s, v, k) => s + (lam[k] > 0 ? v : 0), 0);
    const stableIdx = out.map((_, k) => k).filter((k) => lam[k] === 0);
    const stableSum = stableIdx.reduce((s, k) => s + out[k], 0);
    const missing = n0 - unstable;
    if (stableIdx.length && stableSum > 0) for (const k of stableIdx) out[k] = Math.max(0, (out[k] / stableSum) * missing);
    else if (stableIdx.length === 1) out[stableIdx[0]] = Math.max(0, missing);
    return out;
  };
  const activity = (t: number) => amounts(t).reduce((s, v, k) => s + v * lam[k], 0);
  return { chain, idx, lam, amounts, activity };
}

/** Monte-Carlo atoms: full decay history per atom; state(t) is a pure function of t. */
export function monteCarlo(parent: string, count: number, seed: number) {
  const rng = new Rng(seed);
  const chain = chainOf(parent);
  const index = new Map(chain.map((n, i) => [n.id, i]));
  const histories: { t: number; k: number }[][] = [];
  for (let a = 0; a < count; a++) {
    const h = [{ t: 0, k: 0 }];
    let cur = chain[0], t = 0;
    while (cur.decays.length) {
      t += -Math.log(1 - rng.next()) / lambda(cur);
      const pick = rng.weighted(cur.decays.map((d) => d.br));
      cur = NUCLIDES[cur.decays[pick].to];
      h.push({ t, k: index.get(cur.id)! });
    }
    histories.push(h);
  }
  const state = (t: number) => histories.map((h) => { let k = 0; for (const e of h) { if (e.t <= t) k = e.k; else break; } return k; });
  return { chain, histories, state };
}
