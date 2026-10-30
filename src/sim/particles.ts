// Standard Model particles (PDG 2024 central values, rounded).
// mass in MeV/c²; neutrino masses are upper limits (KATRIN 2024: m_ν < 0.45 eV).
export type ParticleGroup = 'quark' | 'lepton' | 'gauge' | 'scalar';
export interface Particle { sym: string; name: string; group: ParticleGroup; massMeV: number; charge: string; spin: string; force: string; gen?: number; note?: string }

export const STANDARD_MODEL: Particle[] = [
  { sym: 'u', name: 'up', group: 'quark', massMeV: 2.16, charge: '+2/3', spin: '1/2', force: 'strong, EM, weak', gen: 1 },
  { sym: 'd', name: 'down', group: 'quark', massMeV: 4.70, charge: '−1/3', spin: '1/2', force: 'strong, EM, weak', gen: 1 },
  { sym: 'c', name: 'charm', group: 'quark', massMeV: 1273, charge: '+2/3', spin: '1/2', force: 'strong, EM, weak', gen: 2 },
  { sym: 's', name: 'strange', group: 'quark', massMeV: 93.5, charge: '−1/3', spin: '1/2', force: 'strong, EM, weak', gen: 2 },
  { sym: 't', name: 'top', group: 'quark', massMeV: 172570, charge: '+2/3', spin: '1/2', force: 'strong, EM, weak', gen: 3, note: 'Decays before it can form hadrons (~5×10⁻²⁵ s).' },
  { sym: 'b', name: 'bottom', group: 'quark', massMeV: 4183, charge: '−1/3', spin: '1/2', force: 'strong, EM, weak', gen: 3 },
  { sym: 'e', name: 'electron', group: 'lepton', massMeV: 0.51099895, charge: '−1', spin: '1/2', force: 'EM, weak', gen: 1 },
  { sym: 'νₑ', name: 'electron neutrino', group: 'lepton', massMeV: 4.5e-7, charge: '0', spin: '1/2', force: 'weak', gen: 1, note: 'Mass is an upper limit.' },
  { sym: 'μ', name: 'muon', group: 'lepton', massMeV: 105.658, charge: '−1', spin: '1/2', force: 'EM, weak', gen: 2, note: 'Lifetime 2.2 µs.' },
  { sym: 'ν_μ', name: 'muon neutrino', group: 'lepton', massMeV: 4.5e-7, charge: '0', spin: '1/2', force: 'weak', gen: 2, note: 'Mass is an upper limit.' },
  { sym: 'τ', name: 'tau', group: 'lepton', massMeV: 1776.9, charge: '−1', spin: '1/2', force: 'EM, weak', gen: 3, note: 'Lifetime 2.9×10⁻¹³ s.' },
  { sym: 'ν_τ', name: 'tau neutrino', group: 'lepton', massMeV: 4.5e-7, charge: '0', spin: '1/2', force: 'weak', gen: 3, note: 'Mass is an upper limit.' },
  { sym: 'g', name: 'gluon', group: 'gauge', massMeV: 0, charge: '0', spin: '1', force: 'carries strong' },
  { sym: 'γ', name: 'photon', group: 'gauge', massMeV: 0, charge: '0', spin: '1', force: 'carries EM' },
  { sym: 'Z', name: 'Z boson', group: 'gauge', massMeV: 91188, charge: '0', spin: '1', force: 'carries weak' },
  { sym: 'W', name: 'W boson', group: 'gauge', massMeV: 80369, charge: '±1', spin: '1', force: 'carries weak' },
  { sym: 'H', name: 'Higgs boson', group: 'scalar', massMeV: 125200, charge: '0', spin: '0', force: 'gives mass (Higgs field)' },
];

export const COMPOSITES = [
  { sym: 'p', name: 'proton', massMeV: 938.272, quarks: 'uud', note: 'Stable (lifetime > 10³⁴ yr).' },
  { sym: 'n', name: 'neutron', massMeV: 939.565, quarks: 'udd', note: 'Free: 14.7 min mean life. Bound in nuclei: stable.' },
  { sym: 'π⁺', name: 'pion', massMeV: 139.57, quarks: 'ud̄', note: 'Carrier of the residual nuclear force.' },
];

/** Particles thermally abundant at temperature kT (eV): kT ≳ mc²/3 (pairs created freely). */
export function abundantAt(kTeV: number): Particle[] {
  return STANDARD_MODEL.filter((p) => p.massMeV * 1e6 <= 3 * kTeV);
}
