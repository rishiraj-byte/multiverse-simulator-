// Real objects of the observable universe: positions (J2000 RA/Dec), distances and
// basic properties. Values are rounded literature values (Hipparcos/Gaia for stars;
// NED / review papers for galaxies and clusters). Where a quantity is uncertain or
// contested, the note says so. Redshift-only objects get their distance from the
// cosmology of the current universe (comoving distance), not a hard-coded number.

export type CatKind =
  | 'star' | 'nebula' | 'cluster' | 'blackhole' | 'galaxy' | 'group' | 'galaxycluster'
  | 'supercluster' | 'void' | 'wall' | 'quasar' | 'highz' | 'probe' | 'field';

export interface CatObj {
  id: string; name: string; kind: CatKind;
  ra: number; dec: number;          // degrees
  ly?: number;                      // distance in light-years (if not given, from z)
  z?: number;                       // spectroscopic redshift
  mag?: number;                     // apparent V magnitude
  sizeLy?: number;                  // physical diameter
  spec?: string;                    // spectral type / morphology
  note: string;
  preset?: string;                  // detailed system available in the simulator
  galaxy?: { type: 'spiral' | 'barred' | 'elliptical' | 'irregular'; radiusKpc: number; massScale: number; index?: number };
}

const h = (hh: number, mm = 0, ss = 0) => (hh + mm / 60 + ss / 3600) * 15;
const d = (deg: number, mm = 0, ss = 0) => Math.sign(deg || 1) * (Math.abs(deg) + mm / 60 + ss / 3600);
const dn = (deg: number, mm = 0, ss = 0) => -(Math.abs(deg) + mm / 60 + ss / 3600); // southern

export const CATALOG: CatObj[] = [
  // ── nearest stars & systems in the simulator ─────────────────────
  { id: 'proxima', name: 'Proxima Centauri', kind: 'star', ra: h(14, 29, 42.9), dec: dn(62, 40, 46), ly: 4.246, mag: 11.13, spec: 'M5.5Ve', preset: 'proxima', note: 'Nearest star to the Sun. Two confirmed planets, one in the habitable zone.' },
  { id: 'alphacen', name: 'α Centauri A & B', kind: 'star', ra: h(14, 39, 36), dec: dn(60, 50, 2), ly: 4.37, mag: -0.27, spec: 'G2V + K1V', preset: 'alphacen', note: 'Nearest Sun-like stars; third-brightest point in the night sky.' },
  { id: 'barnard', name: "Barnard's Star", kind: 'star', ra: h(17, 57, 48.5), dec: d(4, 41, 36), ly: 5.96, mag: 9.51, spec: 'M4V', note: 'Fastest proper motion of any star (10.3″/yr). Four small planets reported 2024–25.' },
  { id: 'wolf359', name: 'Wolf 359', kind: 'star', ra: h(10, 56, 29), dec: d(7, 0, 53), ly: 7.86, mag: 13.5, spec: 'M6V', note: 'One of the faintest, lowest-mass stars known nearby.' },
  { id: 'lalande', name: 'Lalande 21185', kind: 'star', ra: h(11, 3, 20), dec: d(35, 58, 12), ly: 8.31, mag: 7.52, spec: 'M2V', note: 'Brightest red dwarf in the northern sky.' },
  { id: 'sirius', name: 'Sirius', kind: 'star', ra: h(6, 45, 8.9), dec: dn(16, 42, 58), ly: 8.60, mag: -1.46, spec: 'A1V + DA2', note: 'Brightest star in the night sky. Its companion Sirius B is a white dwarf.' },
  { id: 'epseri', name: 'ε Eridani', kind: 'star', ra: h(3, 32, 55.8), dec: dn(9, 27, 30), ly: 10.5, mag: 3.73, spec: 'K2V', note: 'Young Sun-like star with a debris disk and a Jupiter-mass planet.' },
  { id: 'ross128', name: 'Ross 128', kind: 'star', ra: h(11, 47, 44.4), dec: d(0, 48, 16), ly: 11.0, mag: 11.13, spec: 'M4V', preset: 'ross128', note: 'Quiet red dwarf with a temperate Earth-mass planet.' },
  { id: '61cyg', name: '61 Cygni', kind: 'star', ra: h(21, 6, 54), dec: d(38, 44, 58), ly: 11.4, mag: 5.2, spec: 'K5V + K7V', note: 'First star whose distance was measured (Bessel, 1838).' },
  { id: 'procyon', name: 'Procyon', kind: 'star', ra: h(7, 39, 18.1), dec: d(5, 13, 30), ly: 11.46, mag: 0.34, spec: 'F5IV + DQZ', note: 'Bright subgiant with a white-dwarf companion.' },
  { id: 'tauceti', name: 'τ Ceti', kind: 'star', ra: h(1, 44, 4.1), dec: dn(15, 56, 15), ly: 11.9, mag: 3.50, spec: 'G8V', note: 'Nearest single Sun-like star; candidate planets.' },
  { id: 'trappist1', name: 'TRAPPIST-1', kind: 'star', ra: h(23, 6, 29.3), dec: dn(5, 2, 29), ly: 40.7, mag: 18.8, spec: 'M8V', preset: 'trappist', note: 'Ultracool dwarf with seven Earth-sized planets.' },
  { id: 'peg51', name: '51 Pegasi', kind: 'star', ra: h(22, 57, 28), dec: d(20, 46, 8), ly: 50.6, mag: 5.49, spec: 'G2IV', preset: 'peg51', note: 'First exoplanet around a Sun-like star (1995).' },
  { id: 'kepler16', name: 'Kepler-16', kind: 'star', ra: h(19, 16, 18.2), dec: d(51, 45, 27), ly: 245, mag: 12, spec: 'K + M binary', preset: 'kepler16', note: 'Circumbinary planet — a real “Tatooine”.' },
  { id: 'kepler442', name: 'Kepler-442', kind: 'star', ra: h(19, 1, 28), dec: d(39, 16, 48), ly: 1206, mag: 15, spec: 'K', preset: 'kepler442', note: 'Habitable-zone super-Earth host.' },
  // ── brightest stars ──────────────────────────────────────────────
  { id: 'canopus', name: 'Canopus', kind: 'star', ra: h(6, 23, 57.1), dec: dn(52, 41, 45), ly: 310, mag: -0.74, spec: 'A9II', note: 'Second-brightest star in the night sky.' },
  { id: 'arcturus', name: 'Arcturus', kind: 'star', ra: h(14, 15, 39.7), dec: d(19, 10, 57), ly: 36.7, mag: -0.05, spec: 'K1.5III', note: 'Brightest star in the northern celestial hemisphere; an orange giant.' },
  { id: 'vega', name: 'Vega', kind: 'star', ra: h(18, 36, 56.3), dec: d(38, 47, 1), ly: 25.0, mag: 0.03, spec: 'A0V', note: 'Defined magnitude zero; will be the pole star in ~12 000 years.' },
  { id: 'capella', name: 'Capella', kind: 'star', ra: h(5, 16, 41.4), dec: d(45, 59, 53), ly: 42.9, mag: 0.08, spec: 'G8III + G0III', note: 'Pair of giant stars.' },
  { id: 'rigel', name: 'Rigel', kind: 'star', ra: h(5, 14, 32.3), dec: dn(8, 12, 6), ly: 860, mag: 0.13, spec: 'B8Ia', note: 'Blue supergiant, ~120 000 L☉. Distance uncertain by ~15 %.' },
  { id: 'achernar', name: 'Achernar', kind: 'star', ra: h(1, 37, 42.8), dec: dn(57, 14, 12), ly: 139, mag: 0.46, spec: 'B6Vep', note: 'Least spherical star known — flattened by rapid spin.' },
  { id: 'betelgeuse', name: 'Betelgeuse', kind: 'star', ra: h(5, 55, 10.3), dec: d(7, 24, 25), ly: 550, mag: 0.50, spec: 'M1Ia', note: 'Red supergiant ~700× the Sun’s radius; will explode as a supernova (time unknown). Distance uncertain (≈500–650 ly).' },
  { id: 'hadar', name: 'Hadar', kind: 'star', ra: h(14, 3, 49.4), dec: dn(60, 22, 23), ly: 390, mag: 0.61, spec: 'B1III', note: 'Blue giant triple system.' },
  { id: 'altair', name: 'Altair', kind: 'star', ra: h(19, 50, 47), dec: d(8, 52, 6), ly: 16.7, mag: 0.76, spec: 'A7V', note: 'Spins once every ~9 hours.' },
  { id: 'acrux', name: 'Acrux', kind: 'star', ra: h(12, 26, 35.9), dec: dn(63, 5, 57), ly: 320, mag: 0.76, spec: 'B0.5IV', note: 'Brightest star of the Southern Cross.' },
  { id: 'aldebaran', name: 'Aldebaran', kind: 'star', ra: h(4, 35, 55.2), dec: d(16, 30, 33), ly: 65, mag: 0.86, spec: 'K5III', note: 'Orange giant, the eye of Taurus.' },
  { id: 'antares', name: 'Antares', kind: 'star', ra: h(16, 29, 24.4), dec: dn(26, 25, 55), ly: 550, mag: 0.96, spec: 'M1.5Iab', note: 'Red supergiant, heart of Scorpius. Distance uncertain.' },
  { id: 'spica', name: 'Spica', kind: 'star', ra: h(13, 25, 11.6), dec: dn(11, 9, 41), ly: 250, mag: 0.97, spec: 'B1V', note: 'Close binary of hot blue stars.' },
  { id: 'pollux', name: 'Pollux', kind: 'star', ra: h(7, 45, 18.9), dec: d(28, 1, 34), ly: 33.8, mag: 1.14, spec: 'K0III', note: 'Giant star with a confirmed planet.' },
  { id: 'fomalhaut', name: 'Fomalhaut', kind: 'star', ra: h(22, 57, 39), dec: dn(29, 37, 20), ly: 25.1, mag: 1.16, spec: 'A3V', note: 'Surrounded by a sharp debris ring (imaged by Hubble and JWST).' },
  { id: 'deneb', name: 'Deneb', kind: 'star', ra: h(20, 41, 25.9), dec: d(45, 16, 49), ly: 2600, mag: 1.25, spec: 'A2Ia', note: 'One of the most luminous stars visible to the eye. Distance very uncertain (≈1 500–2 600 ly).' },
  { id: 'regulus', name: 'Regulus', kind: 'star', ra: h(10, 8, 22.3), dec: d(11, 58, 2), ly: 79, mag: 1.40, spec: 'B8IVn', note: 'Heart of Leo.' },
  { id: 'castor', name: 'Castor', kind: 'star', ra: h(7, 34, 36), dec: d(31, 53, 18), ly: 51, mag: 1.58, spec: 'A1V (sextuple)', note: 'Six stars in three binary pairs.' },
  { id: 'polaris', name: 'Polaris', kind: 'star', ra: h(2, 31, 49.1), dec: d(89, 15, 51), ly: 430, mag: 1.98, spec: 'F7Ib', note: 'The current North Star (within 0.7° of the pole). Distance debated (≈320–440 ly).' },
  { id: 'bellatrix', name: 'Bellatrix', kind: 'star', ra: h(5, 25, 7.9), dec: d(6, 20, 59), ly: 250, mag: 1.64, spec: 'B2III', note: 'Orion’s left shoulder.' },
  { id: 'alnilam', name: 'Alnilam', kind: 'star', ra: h(5, 36, 12.8), dec: dn(1, 12, 7), ly: 1300, mag: 1.69, spec: 'B0Ia', note: 'Middle star of Orion’s Belt. Distance uncertain.' },
  { id: 'alnitak', name: 'Alnitak', kind: 'star', ra: h(5, 40, 45.5), dec: dn(1, 56, 34), ly: 1260, mag: 1.77, spec: 'O9.5Iab', note: 'Orion’s Belt; near the Horsehead Nebula.' },
  { id: 'mintaka', name: 'Mintaka', kind: 'star', ra: h(5, 32, 0.4), dec: dn(0, 17, 57), ly: 1200, mag: 2.23, spec: 'O9.5II', note: 'Orion’s Belt, almost exactly on the celestial equator.' },
  { id: 'dubhe', name: 'Dubhe', kind: 'star', ra: h(11, 3, 43.7), dec: d(61, 45, 3), ly: 123, mag: 1.79, spec: 'K0III', note: 'Big Dipper pointer star.' },
  { id: 'alioth', name: 'Alioth', kind: 'star', ra: h(12, 54, 1.7), dec: d(55, 57, 35), ly: 83, mag: 1.77, spec: 'A1III-IVp', note: 'Brightest star of the Big Dipper.' },
  { id: 'alkaid', name: 'Alkaid', kind: 'star', ra: h(13, 47, 32.4), dec: d(49, 18, 48), ly: 104, mag: 1.86, spec: 'B3V', note: 'End of the Big Dipper’s handle.' },
  { id: 'mirfak', name: 'Mirfak', kind: 'star', ra: h(3, 24, 19.4), dec: d(49, 51, 40), ly: 510, mag: 1.80, spec: 'F5Ib', note: 'Brightest star of Perseus.' },
  { id: 'shaula', name: 'Shaula', kind: 'star', ra: h(17, 33, 36.5), dec: dn(37, 6, 14), ly: 570, mag: 1.62, spec: 'B2IV', note: 'Scorpion’s stinger.' },
  { id: 'gacrux', name: 'Gacrux', kind: 'star', ra: h(12, 31, 10), dec: dn(57, 6, 48), ly: 88.6, mag: 1.63, spec: 'M3.5III', note: 'Red giant at the top of the Southern Cross.' },
  { id: 'mimosa', name: 'Mimosa', kind: 'star', ra: h(12, 47, 43.3), dec: dn(59, 41, 19), ly: 280, mag: 1.25, spec: 'B0.5III', note: 'Southern Cross.' },
  // ── Milky Way landmarks ──────────────────────────────────────────
  { id: 'pleiades', name: 'Pleiades (M45)', kind: 'cluster', ra: h(3, 47, 24), dec: d(24, 7, 0), ly: 444, mag: 1.6, sizeLy: 86, note: 'Young open cluster (~100 Myr), the “Seven Sisters”.' },
  { id: 'orion-neb', name: 'Orion Nebula (M42)', kind: 'nebula', ra: h(5, 35, 17.3), dec: dn(5, 23, 28), ly: 1344, mag: 4.0, sizeLy: 24, note: 'Nearest large star-forming region.' },
  { id: 'crab', name: 'Crab Nebula (M1)', kind: 'nebula', ra: h(5, 34, 31.9), dec: d(22, 0, 52), ly: 6500, mag: 8.4, sizeLy: 11, note: 'Remnant of the supernova seen in 1054 AD, powered by a pulsar spinning 30×/s.' },
  { id: 'etacar', name: 'η Carinae', kind: 'star', ra: h(10, 45, 3.6), dec: dn(59, 41, 4), ly: 7500, mag: 4.3, spec: 'LBV binary', note: 'Hypergiant system (~100 M☉) that erupted in the 1840s.' },
  { id: 'cygx1', name: 'Cygnus X-1', kind: 'blackhole', ra: h(19, 58, 21.7), dec: d(35, 12, 6), ly: 7200, note: 'First black hole identified (21 M☉), orbiting a blue supergiant.' },
  { id: 'omegacen', name: 'ω Centauri', kind: 'cluster', ra: h(13, 26, 47), dec: dn(47, 28, 46), ly: 17090, mag: 3.9, sizeLy: 150, note: 'Largest globular cluster: ~10 million stars, possibly a stripped dwarf-galaxy core.' },
  { id: 'milkyway', name: 'Milky Way', kind: 'galaxy', ra: h(17, 45, 40.04), dec: dn(29, 0, 28.2), ly: 26670, sizeLy: 100000, spec: 'SBbc (barred spiral)', galaxy: { type: 'barred', radiusKpc: 15, massScale: 1, index: 0 }, note: 'Our galaxy: 100–400 billion stars in a barred spiral disk ~100 000 ly across; the Sun orbits 26 700 ly from the centre (GRAVITY 2019).' },
  { id: 'sgra', name: 'Sagittarius A*', kind: 'blackhole', ra: h(17, 45, 40.04), dec: dn(29, 0, 28.2), ly: 26670, preset: 'sgra', note: 'The Milky Way’s central black hole, 4.3 million M☉ (GRAVITY 2019/2022: R₀ = 8.18 kpc).' },
  // ── Local Group ─────────────────────────────────────────────────
  { id: 'lmc', name: 'Large Magellanic Cloud', kind: 'galaxy', ra: h(5, 23, 34.5), dec: dn(69, 45, 22), ly: 163000, mag: 0.9, sizeLy: 32000, galaxy: { type: 'irregular', radiusKpc: 5, massScale: 0.1 }, note: 'Largest Milky Way satellite (49.6 kpc, Pietrzyński 2019).' },
  { id: 'smc', name: 'Small Magellanic Cloud', kind: 'galaxy', ra: h(0, 52, 44.8), dec: dn(72, 49, 43), ly: 203000, mag: 2.7, sizeLy: 19000, galaxy: { type: 'irregular', radiusKpc: 3, massScale: 0.03 }, note: 'Dwarf irregular satellite.' },
  { id: 'sgrdsph', name: 'Sagittarius Dwarf', kind: 'galaxy', ra: h(18, 55, 3), dec: dn(30, 28, 42), ly: 70000, sizeLy: 10000, galaxy: { type: 'elliptical', radiusKpc: 2, massScale: 0.02 }, note: 'Dwarf galaxy being torn apart by the Milky Way.' },
  { id: 'm31', name: 'Andromeda (M31)', kind: 'galaxy', ra: h(0, 42, 44.3), dec: d(41, 16, 9), ly: 2.54e6, mag: 3.44, sizeLy: 152000, galaxy: { type: 'spiral', radiusKpc: 23, massScale: 1.4, index: 1 }, note: 'Nearest large galaxy; approaching at ~110 km/s.' },
  { id: 'm32', name: 'M32', kind: 'galaxy', ra: h(0, 42, 41.8), dec: d(40, 51, 55), ly: 2.49e6, mag: 8.1, galaxy: { type: 'elliptical', radiusKpc: 1.2, massScale: 0.01 }, note: 'Compact elliptical satellite of Andromeda.' },
  { id: 'm33', name: 'Triangulum (M33)', kind: 'galaxy', ra: h(1, 33, 50.9), dec: d(30, 39, 37), ly: 2.73e6, mag: 5.72, sizeLy: 61000, galaxy: { type: 'spiral', radiusKpc: 9, massScale: 0.12, index: 2 }, note: 'Third-largest Local Group galaxy.' },
  { id: 'ngc6822', name: "Barnard's Galaxy", kind: 'galaxy', ra: h(19, 44, 56), dec: dn(14, 47, 21), ly: 1.6e6, mag: 9.3, galaxy: { type: 'irregular', radiusKpc: 1.5, massScale: 0.01 }, note: 'Dwarf irregular in the Local Group.' },
  { id: 'localgroup', name: 'Local Group', kind: 'group', ra: h(0, 42, 44.3), dec: d(41, 16, 9), ly: 1.2e6, sizeLy: 1e7, note: '80+ galaxies within ~5 Mly, dominated by the Milky Way and Andromeda.' },
  // ── nearby galaxies ─────────────────────────────────────────────
  { id: 'cena', name: 'Centaurus A', kind: 'galaxy', ra: h(13, 25, 27.6), dec: dn(43, 1, 9), ly: 1.2e7, mag: 6.84, galaxy: { type: 'elliptical', radiusKpc: 30, massScale: 3 }, note: 'Nearest radio galaxy; giant jets from a 55-million-M☉ black hole.' },
  { id: 'm81', name: "Bode's Galaxy (M81)", kind: 'galaxy', ra: h(9, 55, 33.2), dec: d(69, 3, 55), ly: 1.18e7, mag: 6.94, galaxy: { type: 'spiral', radiusKpc: 14, massScale: 0.8 }, note: 'Grand-design spiral in Ursa Major.' },
  { id: 'm82', name: 'Cigar Galaxy (M82)', kind: 'galaxy', ra: h(9, 55, 52.7), dec: d(69, 40, 46), ly: 1.15e7, mag: 8.41, galaxy: { type: 'irregular', radiusKpc: 6, massScale: 0.3 }, note: 'Starburst galaxy blowing a superwind.' },
  { id: 'ngc253', name: 'Sculptor Galaxy', kind: 'galaxy', ra: h(0, 47, 33), dec: dn(25, 17, 18), ly: 1.14e7, mag: 8.0, galaxy: { type: 'barred', radiusKpc: 14, massScale: 0.6 }, note: 'Bright starburst spiral.' },
  { id: 'm83', name: 'Southern Pinwheel (M83)', kind: 'galaxy', ra: h(13, 37, 0.9), dec: dn(29, 51, 57), ly: 1.5e7, mag: 7.5, galaxy: { type: 'barred', radiusKpc: 9, massScale: 0.4 }, note: 'Barred spiral with many recorded supernovae.' },
  { id: 'm101', name: 'Pinwheel (M101)', kind: 'galaxy', ra: h(14, 3, 12.6), dec: d(54, 20, 57), ly: 2.09e7, mag: 7.86, galaxy: { type: 'spiral', radiusKpc: 26, massScale: 1 }, note: 'Face-on spiral ~170 000 ly across.' },
  { id: 'm51', name: 'Whirlpool (M51)', kind: 'galaxy', ra: h(13, 29, 52.7), dec: d(47, 11, 43), ly: 2.3e7, mag: 8.4, galaxy: { type: 'spiral', radiusKpc: 12, massScale: 0.6 }, note: 'Interacting grand-design spiral.' },
  { id: 'm104', name: 'Sombrero (M104)', kind: 'galaxy', ra: h(12, 39, 59.4), dec: dn(11, 37, 23), ly: 3.1e7, mag: 8.0, galaxy: { type: 'spiral', radiusKpc: 15, massScale: 1.5 }, note: 'Huge bulge and a dust lane seen edge-on.' },
  { id: 'm87', name: 'M87', kind: 'galaxy', ra: h(12, 30, 49.4), dec: d(12, 23, 28), ly: 5.35e7, mag: 8.6, galaxy: { type: 'elliptical', radiusKpc: 40, massScale: 6, index: 3 }, preset: 'm87', note: 'Giant elliptical at the core of the Virgo Cluster; its black hole was the first imaged (2019).' },
  // ── groups, clusters, superclusters ─────────────────────────────
  { id: 'virgo', name: 'Virgo Cluster', kind: 'galaxycluster', ra: h(12, 27), dec: d(12, 43), ly: 5.4e7, sizeLy: 1.5e7, note: '~1 300–2 000 galaxies; the heart of our Local (Virgo) Supercluster.' },
  { id: 'fornax', name: 'Fornax Cluster', kind: 'galaxycluster', ra: h(3, 38), dec: dn(35, 27), ly: 6.2e7, sizeLy: 6e6, note: 'Second-richest cluster within 100 Mly.' },
  { id: 'hydra', name: 'Hydra Cluster', kind: 'galaxycluster', ra: h(10, 36, 51), dec: dn(27, 31, 35), ly: 1.58e8, sizeLy: 1e7, note: 'Abell 1060, part of the Hydra–Centaurus supercluster.' },
  { id: 'centaurus', name: 'Centaurus Cluster', kind: 'galaxycluster', ra: h(12, 48, 49), dec: dn(41, 18, 39), ly: 1.7e8, sizeLy: 1e7, note: 'Abell 3526.' },
  { id: 'norma', name: 'Great Attractor (Norma Cluster)', kind: 'galaxycluster', ra: h(16, 15, 32.8), dec: dn(60, 54, 30), ly: 2.2e8, sizeLy: 1.3e7, note: 'Mass concentration near the centre of Laniakea; hidden behind the Milky Way’s dust.' },
  { id: 'laniakea', name: 'Laniakea Supercluster', kind: 'supercluster', ra: h(16, 15), dec: dn(60, 54), ly: 2.5e8, sizeLy: 5.2e8, note: 'Our home supercluster (Tully et al. 2014): ~100 000 galaxies, 520 Mly across, defined by galaxy flows.' },
  { id: 'perseus', name: 'Perseus Cluster', kind: 'galaxycluster', ra: h(3, 19, 47), dec: d(41, 30, 47), ly: 2.4e8, sizeLy: 1.2e7, note: 'Abell 426; brightest X-ray cluster in the sky.' },
  { id: 'perseuspisces', name: 'Perseus–Pisces Supercluster', kind: 'supercluster', ra: h(2), dec: d(35), ly: 2.5e8, sizeLy: 3e8, note: 'Filamentary chain of clusters.' },
  { id: 'coma', name: 'Coma Cluster', kind: 'galaxycluster', ra: h(12, 59, 48.7), dec: d(27, 58, 50), ly: 3.21e8, z: 0.0231, sizeLy: 2e7, note: 'Where Zwicky first inferred dark matter (1933).' },
  { id: 'cfa2wall', name: 'CfA2 Great Wall', kind: 'wall', ra: h(13), dec: d(30), ly: 3e8, sizeLy: 5e8, note: 'Sheet of galaxies ~500 Mly long (Geller & Huchra 1989).' },
  { id: 'hercules', name: 'Hercules Cluster', kind: 'galaxycluster', ra: h(16, 5, 15), dec: d(17, 44, 55), ly: 5e8, sizeLy: 1e7, note: 'Abell 2151, rich in spirals.' },
  { id: 'shapley', name: 'Shapley Supercluster', kind: 'supercluster', ra: h(13, 27, 57.5), dec: dn(31, 29, 44), ly: 6.5e8, z: 0.048, sizeLy: 2e8, note: 'Largest concentration of galaxies in the nearby universe.' },
  { id: 'bootes', name: 'Boötes Void', kind: 'void', ra: h(14, 50), dec: d(46), ly: 7e8, sizeLy: 3.3e8, note: 'Huge, nearly empty region ~330 Mly across.' },
  { id: 'sloanwall', name: 'Sloan Great Wall', kind: 'wall', ra: h(12), dec: d(0), ly: 1.0e9, sizeLy: 1.37e9, note: 'One of the largest known structures, ~1.4 Gly long (Gott et al. 2005). Position approximate.' },
  { id: 'hcbgw', name: 'Hercules–Corona Borealis Great Wall', kind: 'wall', ra: h(16), dec: d(27), z: 1.8, sizeLy: 1e10, note: 'Claimed ~10 Gly structure traced by gamma-ray bursts — its reality is debated.' },
  // ── quasars & the most distant objects ──────────────────────────
  { id: '3c273', name: '3C 273', kind: 'quasar', ra: h(12, 29, 6.7), dec: d(2, 3, 9), z: 0.158, mag: 12.9, note: 'First quasar identified (1963); visible in a backyard telescope.' },
  { id: 'ton618', name: 'TON 618', kind: 'quasar', ra: h(12, 28, 24.9), dec: d(31, 28, 38), z: 2.219, mag: 15.9, note: 'Hosts one of the most massive black holes known (~40 billion M☉, uncertain).' },
  { id: 'gnz11', name: 'GN-z11', kind: 'highz', ra: h(12, 36, 25.46), dec: d(62, 14, 31.4), z: 10.603, note: 'Bright galaxy 430 Myr after the Big Bang with an active black hole (JWST 2023).' },
  { id: 'jades14', name: 'JADES-GS-z14-0', kind: 'highz', ra: h(3, 32, 19.9), dec: dn(27, 51, 20), z: 14.32, note: 'Among the most distant galaxies spectroscopically confirmed (JWST 2024), ~290 Myr after the Big Bang.' },
  { id: 'hudf', name: 'Hubble Ultra Deep Field', kind: 'field', ra: h(3, 32, 39), dec: dn(27, 47, 29), z: 6, note: '~10 000 galaxies in a patch 1/10 of the full Moon’s width.' },
  { id: 'voyager1', name: 'Voyager 1', kind: 'probe', ra: h(17, 13), dec: d(12, 0), ly: 172 * 1.58125e-5, note: 'Most distant human-made object, in interstellar space since 2012 (~172 AU in 2026, ~3.6 AU/yr; position approximate).' },
];

export const KIND_LABEL: Record<CatKind, string> = {
  star: 'Star', nebula: 'Nebula', cluster: 'Star cluster', blackhole: 'Black hole', galaxy: 'Galaxy', group: 'Galaxy group',
  galaxycluster: 'Galaxy cluster', supercluster: 'Supercluster', void: 'Cosmic void', wall: 'Galaxy wall / filament',
  quasar: 'Quasar', highz: 'Early-universe galaxy', probe: 'Spacecraft', field: 'Deep field',
};

/** CMB features (galactic coordinates). Planck 2018: dipole 3362.08 μK toward (264.021°, 48.253°). */
export const CMB_DIPOLE = { l: 264.021, b: 48.253, amplitudeUK: 3362.08 };
export const CMB_COLD_SPOT = { l: 209, b: -57 };
