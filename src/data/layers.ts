// Real astronomical catalogues → 3-D layers (heliocentric galactic Cartesian, light-years).
// Distances come from the catalogue's own measurement: trigonometric parallax (Gaia,
// Hipparcos), cluster isochrone/parallax fits, redshift-independent indicators
// (Cosmicflows-4 distance moduli), or redshift → comoving distance with this
// universe's cosmology. Objects without any distance are counted but not placed.

import { eqToGalactic, galacticToEq, fromRaDec } from '../sim/ephemeris';
import { kelvinToHex } from '../sim/astro';
import { comovingDistanceLy, type CosmoParams } from '../sim/cosmology';
import { Rng } from '../sim/rng';
import { vizier, simbad, gavoAsync, fetchText, parseCSV, num, type Progress } from './net';

export type Category =
  | 'stars' | 'exoplanets' | 'blackholes' | 'pulsars' | 'whitedwarfs' | 'clusters' | 'nebulae' | 'gas'
  | 'galaxies' | 'groups' | 'superclusters' | 'quasars' | 'darkmatter' | 'darkenergy';

export const CATEGORY_LABEL: Record<Category, string> = {
  stars: 'Stars', exoplanets: 'Exoplanets', blackholes: 'Black holes & X-ray binaries', pulsars: 'Pulsars & neutron stars',
  whitedwarfs: 'White dwarfs', clusters: 'Star clusters', nebulae: 'Nebulae & clouds', gas: 'Gas',
  galaxies: 'Galaxies', groups: 'Galaxy groups & clusters', superclusters: 'Superclusters', quasars: 'Quasars',
  darkmatter: 'Dark matter', darkenergy: 'Dark energy',
};

export interface RealLayer {
  key: string;
  title: string;
  category: Category;
  simulated: boolean;
  n: number;
  pos: Float32Array;               // ly, galactic frame (x → GC, y → l=90°, z → NGP)
  z?: Float32Array;                // redshift per object when the distance came from z (re-scaled if the cosmology changes)
  cosmoKey?: string;               // cosmology the redshift distances were computed with
  rgb: Float32Array;
  size: Float32Array;
  mag: Float32Array;               // apparent magnitude, NaN if unknown
  names: string[];
  types: string[];                 // per-object type label
  details: Record<string, string[]>; // extra per-object fields shown on the info card
  notable: number[];               // indices that get labels / priority in search
  distMethod: string;              // how the distance was measured
  source: string;                  // citation
  skipped: number;                 // rows without a usable distance (not placed)
  loadedAt: string;
}

export interface SourceDef {
  key: string;
  title: string;
  category: Category;
  what: string;
  size: string;                    // human estimate of download
  simulated?: boolean;
  recommended?: boolean;
  load: (ctx: LoadCtx) => Promise<RealLayer>;
}

export interface LoadCtx { cosmo: CosmoParams; progress: Progress; signal?: AbortSignal; layers: Map<string, RealLayer> }

const PC_LY = 3.26156;
const MPC_LY = 3.26156e6;
const C_KMS = 299792.458;

// ── helpers ──────────────────────────────────────────────────────────

class Builder {
  pos: number[] = []; rgb: number[] = []; size: number[] = []; mag: number[] = [];
  names: string[] = []; types: string[] = []; details: Record<string, string[]> = {}; notable: number[] = [];
  zs: number[] = []; hasZ = false;
  skipped = 0;
  private detailKeys: string[];
  constructor(detailKeys: string[] = []) { this.detailKeys = detailKeys; for (const k of detailKeys) this.details[k] = []; }
  get n() { return this.names.length; }
  add(raDeg: number, decDeg: number, distLy: number, rgb: [number, number, number], size: number, name: string, type: string, mag = NaN, det: Record<string, string> = {}, z = NaN) {
    if (!isFinite(raDeg) || !isFinite(decDeg) || !isFinite(distLy) || distLy <= 0) { this.skipped++; return -1; }
    const g = eqToGalactic(fromRaDec(raDeg, decDeg));
    this.pos.push(g[0] * distLy, g[1] * distLy, g[2] * distLy);
    this.rgb.push(...rgb); this.size.push(size); this.mag.push(mag);
    this.names.push(name); this.types.push(type);
    for (const k of this.detailKeys) this.details[k].push(det[k] ?? '');
    this.zs.push(z); if (isFinite(z)) this.hasZ = true;
    return this.n - 1;
  }
  build(meta: Omit<RealLayer, 'n' | 'pos' | 'rgb' | 'size' | 'mag' | 'names' | 'types' | 'details' | 'notable' | 'skipped' | 'loadedAt'>, cosmo?: CosmoParams): RealLayer {
    return {
      z: this.hasZ ? Float32Array.from(this.zs) : undefined, cosmoKey: this.hasZ && cosmo ? cosmoKey(cosmo) : undefined,
      ...meta, n: this.n, pos: Float32Array.from(this.pos), rgb: Float32Array.from(this.rgb), size: Float32Array.from(this.size),
      mag: Float32Array.from(this.mag), names: this.names, types: this.types, details: this.details, notable: this.notable,
      skipped: this.skipped, loadedAt: new Date().toISOString(),
    };
  }
}

const hex = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
const dim = (c: [number, number, number], f: number): [number, number, number] => [c[0] * f, c[1] * f, c[2] * f];

/** B−V → effective temperature (Ballesteros 2012). */
export function bvToTeff(bv: number): number {
  const b = Math.min(Math.max(bv, -0.4), 2.0);
  return 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
}
/** Gaia BP−RP → effective temperature (Mucciarelli & Bellazzini 2020, dwarfs; indicative for giants). */
export function bprpToTeff(c: number): number {
  const x = Math.min(Math.max(c, -0.3), 3.5);
  return 5040 / (0.4929 + 0.5092 * x - 0.0353 * x * x);
}
const starRGB = (teff: number, m: number): [number, number, number] => {
  const c = hex(kelvinToHex(teff));
  const b = Math.min(Math.max(1.15 - 0.07 * (isFinite(m) ? m : 8), 0.35), 1.1);
  return dim(c, b);
};
const starSize = (m: number) => Math.min(Math.max(7.2 - 0.6 * (isFinite(m) ? m : 9), 1.3), 9);

export const cosmoKey = (p: CosmoParams) => `${p.H0}:${p.omegaM}:${p.omegaL}:${p.gMult ?? 1}`;

/** Fast comoving distance for many redshifts (table interpolation, same cosmology as the map). */
export function chiTable(cosmo: CosmoParams) {
  const zs: number[] = [0], ds: number[] = [0];
  for (let i = 1; i <= 240; i++) { const z = Math.pow(10, -4 + (i / 240) * (Math.log10(30) + 4)); zs.push(z); ds.push(comovingDistanceLy(z, cosmo)); }
  return (z: number) => {
    if (!(z > 0)) return NaN;
    if (z >= zs[zs.length - 1]) return ds[ds.length - 1];
    let lo = 0, hi = zs.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (zs[m] <= z) lo = m; else hi = m; }
    const f = (z - zs[lo]) / (zs[hi] - zs[lo]);
    return ds[lo] + f * (ds[hi] - ds[lo]);
  };
}

/** Spatial hash on the sky for de-duplication between catalogues. */
function skyHash(cellDeg: number) {
  const map = new Map<string, number[]>();
  const key = (ra: number, dec: number) => `${Math.floor(ra / cellDeg)}:${Math.floor((dec + 90) / cellDeg)}`;
  return {
    add(ra: number, dec: number, v: number) { const k = key(ra, dec); const a = map.get(k); if (a) a.push(v); else map.set(k, [v]); },
    near(ra: number, dec: number): number[] {
      const out: number[] = [];
      const i = Math.floor(ra / cellDeg), j = Math.floor((dec + 90) / cellDeg);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const a = map.get(`${i + di}:${j + dj}`); if (a) out.push(...a); }
      return out;
    },
  };
}

/** SIMBAD identifiers → readable names: "NAME Sgr A*" → "Sgr A*", "*  51 Peg b" → "51 Peg b", "M  42" → "M 42". */
export function cleanName(s: string): string {
  return (s ?? '').replace(/^NAME\s+/, '').replace(/^(\*\*|\*|V\*)\s+/, '').replace(/\s{2,}/g, ' ').trim();
}
/** Catalogue designations without zero padding: "MESSIER031" → "M31", "NGC0224" → "NGC 224". */
export function tidyDesignation(s: string): string {
  return s.replace(/^MESSIER0*(\d+)/i, 'M$1').replace(/^(NGC|IC|UGC|PGC|ESO|DDO)\s*0*(\d)/i, '$1 $2');
}

function median(a: number[]): number { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; }

// ── stars ────────────────────────────────────────────────────────────

async function loadHYG(ctx: LoadCtx): Promise<RealLayer> {
  const text = await fetchText('https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv', ctx.progress, 'HYG star database');
  ctx.progress('Parsing 119 000 stars…');
  const { header, rows } = parseCSV(text);
  const ix = (k: string) => header.indexOf(k);
  const I = { id: ix('id'), hip: ix('hip'), hd: ix('hd'), gl: ix('gl'), bf: ix('bf'), proper: ix('proper'), ra: ix('ra'), dec: ix('dec'), dist: ix('dist'), mag: ix('mag'), absmag: ix('absmag'), spect: ix('spect'), ci: ix('ci'), con: ix('con'), lum: ix('lum') };
  const b = new Builder(['Spectral type', 'Absolute magnitude', 'Constellation', 'Luminosity (L☉)', 'Catalogue IDs']);
  for (const r of rows) {
    if (r[I.id] === '0') continue; // the Sun is drawn by the Solar-System layer
    const dpc = num(r[I.dist]);
    if (!(dpc > 0) || dpc >= 100000) { b.skipped++; continue; } // 100000 = unknown in HYG
    const m = num(r[I.mag]), ci = num(r[I.ci]);
    const spect = r[I.spect] ?? '';
    const ids = [r[I.hip] && `HIP ${r[I.hip]}`, r[I.hd] && `HD ${r[I.hd]}`, r[I.gl] && r[I.gl]].filter(Boolean).join(', ');
    const name = r[I.proper] || r[I.bf] || (r[I.hip] ? `HIP ${r[I.hip]}` : r[I.hd] ? `HD ${r[I.hd]}` : r[I.gl] || `HYG ${r[I.id]}`);
    const wd = spect.startsWith('D');
    const idx = b.add(num(r[I.ra]) * 15, num(r[I.dec]), dpc * PC_LY, starRGB(isFinite(ci) ? bvToTeff(ci) : 5800, m), starSize(m), name, wd ? 'White dwarf' : spect ? `Star (${spect.slice(0, 6)})` : 'Star', m,
      { 'Spectral type': spect, 'Absolute magnitude': r[I.absmag], Constellation: r[I.con], 'Luminosity (L☉)': r[I.lum] ? Number(r[I.lum]).toPrecision(3) : '', 'Catalogue IDs': ids });
    if (idx >= 0 && r[I.proper]) b.notable.push(idx);
  }
  return b.build({ key: 'hyg', title: 'HYG stars', category: 'stars', simulated: false, distMethod: 'Trigonometric parallax (Hipparcos / Gaia), via HYG v4.1', source: 'HYG Database v4.1 (Nash, astronexus) — Hipparcos, Yale BSC, Gliese' });
}

function gaiaLoader(gMax: number, key: string): (ctx: LoadCtx) => Promise<RealLayer> {
  return async (ctx) => {
    const rows = await gavoAsync(
      `SELECT source_id, ra, dec, parallax, phot_g_mean_mag, phot_bp_mean_mag, phot_rp_mean_mag FROM gaia.dr3lite WHERE phot_g_mean_mag < ${gMax} AND parallax > 0 AND parallax > 5 * parallax_error`,
      3_000_000, ctx.progress, ctx.signal);
    ctx.progress(`Placing ${rows.length.toLocaleString('en-US')} Gaia stars…`);
    // de-duplicate against HYG (bright stars) when loaded: same position within 0.02° and similar brightness
    const hyg = ctx.layers.get('hyg');
    const hash = skyHash(0.05);
    if (hyg) {
      for (let i = 0; i < hyg.n; i++) {
        const x = hyg.pos[i * 3], y = hyg.pos[i * 3 + 1], z = hyg.pos[i * 3 + 2];
        const eq = galToEqVec([x, y, z]);
        const d = Math.hypot(eq[0], eq[1], eq[2]);
        let ra = Math.atan2(eq[1], eq[0]) * 57.29578; if (ra < 0) ra += 360;
        hash.add(ra, Math.asin(eq[2] / d) * 57.29578, i);
      }
    }
    const b = new Builder(['Gaia DR3 source_id', 'Parallax (mas)', 'G magnitude', 'BP−RP colour']);
    let dupes = 0;
    for (const r of rows) {
      const ra = num(r.ra), dec = num(r.dec), plx = num(r.parallax), g = num(r.phot_g_mean_mag);
      const bp = num(r.phot_bp_mean_mag), rp = num(r.phot_rp_mean_mag);
      if (hyg) {
        const cand = hash.near(ra, dec);
        let dup = false;
        for (const i of cand) {
          if (Math.abs(hyg.mag[i] - g) > 1.2) continue;
          const eq = galToEqVec([hyg.pos[i * 3], hyg.pos[i * 3 + 1], hyg.pos[i * 3 + 2]]);
          const d = Math.hypot(...eq);
          let ra2 = Math.atan2(eq[1], eq[0]) * 57.29578; if (ra2 < 0) ra2 += 360;
          const dec2 = Math.asin(eq[2] / d) * 57.29578;
          if (Math.hypot((ra - ra2) * Math.cos(dec * 0.01745), dec - dec2) < 0.02) { dup = true; break; }
        }
        if (dup) { dupes++; continue; }
      }
      const c = bp - rp;
      b.add(ra, dec, (1000 / plx) * PC_LY, starRGB(isFinite(c) ? bprpToTeff(c) : 5800, g), starSize(g) * 0.9, `Gaia DR3 ${r.source_id}`, 'Star (Gaia DR3)', g,
        { 'Gaia DR3 source_id': r.source_id, 'Parallax (mas)': plx.toFixed(3), 'G magnitude': g.toFixed(2), 'BP−RP colour': isFinite(c) ? c.toFixed(2) : '' });
    }
    return b.build({
      key, title: `Gaia DR3 stars (G < ${gMax})`, category: 'stars', simulated: false,
      distMethod: 'Gaia trigonometric parallax (≥ 5σ), d = 1/ϖ', source: `Gaia DR3 (Gaia Collaboration 2023) via GAVO Heidelberg${dupes ? ` · ${dupes.toLocaleString('en-US')} duplicates of HYG stars removed` : ''}`,
    });
  };
}

async function loadWD(ctx: LoadCtx): Promise<RealLayer> {
  const rows = await vizier('J/MNRAS/508/3877/maincat', ['WDJname', 'Plx', 'Pwd'], { Pwd: '>0.9', RPlx: '>10' }, ctx.progress);
  const b = new Builder(['Parallax (mas)', 'Probability of being a WD']);
  for (const r of rows) {
    const plx = num(r.Plx);
    b.add(num(r._RAJ2000), num(r._DEJ2000), (1000 / plx) * PC_LY, [0.75, 0.85, 1.0], 1.8, r.WDJname, 'White dwarf', NaN, { 'Parallax (mas)': r.Plx, 'Probability of being a WD': r.Pwd });
  }
  return b.build({ key: 'wd', title: 'Gaia white dwarfs', category: 'whitedwarfs', simulated: false, distMethod: 'Gaia EDR3 parallax (> 10σ)', source: 'Gentile Fusillo et al. 2021, MNRAS 508, 3877 (VizieR J/MNRAS/508/3877)' });
}

async function loadPulsars(ctx: LoadCtx): Promise<RealLayer> {
  const rows = await vizier('B/psr/psr', ['PSRJ', 'Name', 'P0', 'DM', 'Dist', 'DistDM', 'Type', 'Assoc'], {}, ctx.progress);
  const b = new Builder(['Spin period', 'Dispersion measure', 'Distance source', 'Association']);
  for (const r of rows) {
    const dist = num(r.Dist) || num(r.DistDM);
    const p = num(r.P0);
    const idx = b.add(num(r._RAJ2000), num(r._DEJ2000), dist * 1000 * PC_LY, [0.55, 1.0, 0.85], 2.6, r.PSRJ || r.Name, p < 0.03 ? 'Millisecond pulsar' : 'Pulsar', NaN,
      { 'Spin period': isFinite(p) ? (p < 1 ? `${(p * 1000).toFixed(2)} ms` : `${p.toFixed(3)} s`) : '', 'Dispersion measure': isFinite(num(r.DM)) ? `${num(r.DM)} pc/cm³` : '', 'Distance source': num(r.Dist) ? 'best estimate (ATNF)' : 'from dispersion measure (model, ±~30 %)', Association: r.Assoc });
    if (idx >= 0 && /Crab|Vela|B1919|B1913|J0437|J1748-2446ad/i.test(`${r.Name} ${r.PSRJ} ${r.Assoc}`)) b.notable.push(idx);
  }
  return b.build({ key: 'psr', title: 'ATNF pulsars', category: 'pulsars', simulated: false, distMethod: 'ATNF best distance (parallax, association or dispersion-measure model)', source: 'ATNF Pulsar Catalogue (Manchester et al. 2005), VizieR B/psr' });
}

async function loadBH(ctx: LoadCtx): Promise<RealLayer> {
  const rows = await simbad(`SELECT b.main_id, b.ra, b.dec, b.otype, b.plx_value, b.plx_err, d.dist, d.unit FROM basic b LEFT JOIN mesDistance d ON d.oidref = b.oid WHERE b.otype IN ('BH','BH?','HXB','LXB','ULX')`, ctx.progress);
  const by = new Map<string, { ra: number; dec: number; otype: string; plx: number; plxErr: number; d: number[] }>();
  for (const r of rows) {
    let o = by.get(cleanName(r.main_id));
    if (!o) { o = { ra: num(r.ra), dec: num(r.dec), otype: r.otype, plx: num(r.plx_value), plxErr: num(r.plx_err), d: [] }; by.set(cleanName(r.main_id), o); }
    const v = num(r.dist), u = (r.unit ?? '').trim();
    if (isFinite(v) && v > 0) o.d.push(u === 'kpc' ? v * 1000 : u === 'Mpc' ? v * 1e6 : v); // → pc
  }
  const b = new Builder(['SIMBAD type', 'Distance measurements']);
  const label: Record<string, string> = { BH: 'Black hole', 'BH?': 'Black-hole candidate', HXB: 'High-mass X-ray binary', LXB: 'Low-mass X-ray binary', ULX: 'Ultraluminous X-ray source' };
  for (const [name, o] of by) {
    const pc = o.plx > 0 && o.plxErr > 0 && o.plx / o.plxErr > 5 ? 1000 / o.plx : median(o.d);
    const idx = b.add(o.ra, o.dec, pc * PC_LY, o.otype.startsWith('BH') ? [1, 0.55, 0.25] : [1, 0.75, 0.4], o.otype.startsWith('BH') ? 6 : 3.2, name, label[o.otype] ?? o.otype, NaN,
      { 'SIMBAD type': o.otype, 'Distance measurements': o.d.length ? `${o.d.length} (median used)` : 'parallax' });
    if (idx >= 0 && o.otype !== 'ULX') b.notable.push(idx);
  }
  return b.build({ key: 'bh', title: 'Black holes & X-ray binaries', category: 'blackholes', simulated: false, distMethod: 'Gaia parallax (≥ 5σ) or median of published distances (SIMBAD mesDistance)', source: 'SIMBAD (Wenger et al. 2000), object types BH, BH?, HXB, LXB, ULX' });
}

async function loadExoplanets(ctx: LoadCtx): Promise<RealLayer> {
  const rows = await simbad(`SELECT b.main_id, h.main_id AS host, h.ra, h.dec, h.plx_value, h.sp_type, h.otype AS htype FROM basic b JOIN h_link l ON l.child = b.oid JOIN basic h ON h.oid = l.parent WHERE b.otype = 'Pl' AND h.plx_value > 0`, ctx.progress);
  const seen = new Set<string>();
  const b = new Builder(['Host', 'Host spectral type', 'Host parallax (mas)']);
  for (const r of rows) {
    if (seen.has(cleanName(r.main_id))) continue;
    seen.add(cleanName(r.main_id));
    b.add(num(r.ra), num(r.dec), (1000 / num(r.plx_value)) * PC_LY, [0.45, 1.0, 0.55], 3.2, cleanName(r.main_id), 'Exoplanet', NaN,
      { Host: cleanName(r.host), 'Host spectral type': r.sp_type, 'Host parallax (mas)': Number(r.plx_value).toFixed(3) });
  }
  return b.build({ key: 'exo', title: 'Exoplanets', category: 'exoplanets', simulated: false, distMethod: 'Parallax of the host star (planets drawn at their star)', source: 'SIMBAD planets (otype Pl) with host-star parallax' });
}

async function loadOpenClusters(ctx: LoadCtx): Promise<RealLayer> {
  const rows = await vizier('J/A+A/673/A114/clusters', ['Name', 'Type', 'dist50', 'N', 'logAge50', 'r50pc'], {}, ctx.progress);
  const T: Record<string, string> = { o: 'Open cluster', g: 'Globular cluster', m: 'Moving group', r: 'Unreliable candidate', d: 'Dissolving cluster' };
  const b = new Builder(['Member stars (Gaia)', 'Age', 'Half-mass radius']);
  const order = rows.map((r, i) => [num(r.N), i] as [number, number]).sort((a, c) => c[0] - a[0]);
  const rank = new Map(order.map(([, i], k) => [i, k]));
  rows.forEach((r, i) => {
    const age = num(r.logAge50);
    const idx = b.add(num(r._RAJ2000), num(r._DEJ2000), num(r.dist50) * PC_LY, r.Type === 'g' ? [1, 0.85, 0.55] : [0.6, 0.8, 1], r.Type === 'g' ? 5 : 3.4, r.Name.replace(/_/g, ' '), T[r.Type] ?? 'Star cluster', NaN,
      { 'Member stars (Gaia)': r.N, Age: isFinite(age) ? `${(Math.pow(10, age) / 1e6).toPrecision(3)} million years` : '', 'Half-mass radius': r.r50pc ? `${Number(r.r50pc).toFixed(1)} pc` : '' });
    if (idx >= 0 && (rank.get(i) ?? 1e9) < 150) b.notable.push(idx);
  });
  return b.build({ key: 'oc', title: 'Star clusters (Gaia)', category: 'clusters', simulated: false, distMethod: 'Gaia DR3 parallaxes of cluster members (Bayesian)', source: 'Hunt & Reffert 2023, A&A 673, A114 (VizieR J/A+A/673/A114)' });
}

async function loadGlobulars(ctx: LoadCtx): Promise<RealLayer> {
  const rows = await vizier('VII/202/catalog', ['ID', 'Name', 'Rsun', '[Fe/H]', 'MVt'], {}, ctx.progress);
  const b = new Builder(['Catalogue ID', 'Metallicity [Fe/H]', 'Absolute V magnitude']);
  for (const r of rows) {
    const idx = b.add(num(r._RAJ2000), num(r._DEJ2000), num(r.Rsun) * 1000 * PC_LY, [1, 0.85, 0.5], 6, (r.Name ? `${r.Name} (${r.ID})` : r.ID).trim(), 'Globular cluster', NaN,
      { 'Catalogue ID': r.ID, 'Metallicity [Fe/H]': r['[Fe/H]'], 'Absolute V magnitude': r.MVt });
    if (idx >= 0) b.notable.push(idx);
  }
  return b.build({ key: 'gc', title: 'Milky Way globular clusters', category: 'clusters', simulated: false, distMethod: 'Horizontal-branch distance moduli (Harris 2010)', source: 'Harris 1996 (2010 edition), VizieR VII/202' });
}

async function loadNebulae(ctx: LoadCtx): Promise<RealLayer> {
  const rows = await simbad(`SELECT b.main_id, b.ra, b.dec, b.otype, d.dist, d.unit FROM basic b JOIN mesDistance d ON d.oidref = b.oid WHERE b.otype IN ('PN','HII','SNR','DNe','RNe','MoC','Neb','EmO','Cld')`, ctx.progress);
  const by = new Map<string, { ra: number; dec: number; otype: string; d: number[] }>();
  const named = new Set<string>();
  for (const r of rows) {
    let o = by.get(cleanName(r.main_id));
    if (!o) { o = { ra: num(r.ra), dec: num(r.dec), otype: r.otype, d: [] }; by.set(cleanName(r.main_id), o); if (r.main_id.startsWith('NAME ')) named.add(cleanName(r.main_id)); }
    const v = num(r.dist), u = (r.unit ?? '').trim();
    if (isFinite(v) && v > 0) o.d.push(u === 'kpc' ? v * 1000 : u === 'Mpc' ? v * 1e6 : v);
  }
  const L: Record<string, [string, number]> = { PN: ['Planetary nebula', 0x7fffd4], HII: ['H II region (star-forming gas)', 0xff6a8a], SNR: ['Supernova remnant', 0xffa060], DNe: ['Dark nebula', 0x8a7aa0], RNe: ['Reflection nebula', 0x9ab8ff], MoC: ['Molecular cloud', 0xc08aff], Neb: ['Nebula', 0xff9ad5], EmO: ['Emission object', 0xff9ad5], Cld: ['Cloud', 0xb0a0d0] };
  const b = new Builder(['SIMBAD type', 'Distance measurements']);
  for (const [name, o] of by) {
    const [label, col] = L[o.otype] ?? ['Nebula', 0xff9ad5];
    const idx = b.add(o.ra, o.dec, median(o.d) * PC_LY, hex(col), 3.4, name, label, NaN, { 'SIMBAD type': o.otype, 'Distance measurements': `${o.d.length} (median used)` });
    if (idx >= 0 && (named.has(name) || /^(M|NGC|IC|Sh ?2-|RCW|Barnard|LDN) ?\d/.test(name))) b.notable.push(idx);
  }
  return b.build({ key: 'neb', title: 'Nebulae & molecular clouds', category: 'nebulae', simulated: false, distMethod: 'Median of published distances (SIMBAD mesDistance)', source: 'SIMBAD: PN, H II, SNR, dark/reflection nebulae, molecular clouds with measured distances' });
}

// ── galaxies & large-scale structure ─────────────────────────────────

const GAL_RGB: Record<string, [number, number, number]> = { E: [1, 0.82, 0.6], S: [0.72, 0.82, 1], I: [0.6, 0.95, 1] };

async function loadUNGC(ctx: LoadCtx): Promise<RealLayer> {
  const rows = await vizier('J/AJ/145/101', ['Name', 'Dist', 'KLum', 'TT', 'SimbadName', 'HRV'], {}, ctx.progress);
  const b = new Builder(['Morphological type T', 'K-band luminosity', 'Heliocentric velocity']);
  for (const r of rows) {
    const tt = num(r.TT);
    const idx = b.add(num(r._RAJ2000), num(r._DEJ2000), num(r.Dist) * MPC_LY, tt <= -1 ? GAL_RGB.E : tt >= 9 ? GAL_RGB.I : GAL_RGB.S, 4.2, tidyDesignation(r.Name), tt <= -1 ? 'Elliptical / spheroidal galaxy' : tt >= 9 ? 'Irregular / dwarf galaxy' : 'Spiral galaxy', NaN,
      { 'Morphological type T': r.TT, 'K-band luminosity': r.KLum ? `10^${r.KLum} L☉` : '', 'Heliocentric velocity': r.HRV ? `${r.HRV} km/s` : '' });
    if (idx >= 0) b.notable.push(idx);
  }
  return b.build({ key: 'ungc', title: 'Nearby galaxies (< 36 Mly)', category: 'galaxies', simulated: false, distMethod: 'TRGB, Cepheids and other redshift-independent distances', source: 'Updated Nearby Galaxy Catalog, Karachentsev et al. 2013 (VizieR J/AJ/145/101)' });
}

async function loadCF4(ctx: LoadCtx): Promise<RealLayer> {
  const rows = await vizier('J/ApJ/944/94', ['PGC', 'DM', 'e_DM', 'Vcmb'], {}, ctx.progress);
  const ungc = ctx.layers.get('ungc');
  const b = new Builder(['Distance modulus', 'CMB-frame velocity', 'Distance uncertainty']);
  for (const r of rows) {
    const dm = num(r.DM), v = num(r.Vcmb);
    const dL = Math.pow(10, (dm + 5) / 5) * PC_LY; // luminosity distance
    const z = isFinite(v) ? Math.max(v, 0) / C_KMS : 0;
    const dC = dL / (1 + z);
    if (ungc && dC < 3.6e7) { b.skipped++; continue; } // nearby galaxies come from UNGC
    const e = num(r.e_DM);
    b.add(num(r._RAJ2000), num(r._DEJ2000), dC, GAL_RGB.S, 2.6, `PGC ${r.PGC}`, 'Galaxy', NaN,
      { 'Distance modulus': `${r.DM} mag`, 'CMB-frame velocity': r.Vcmb ? `${r.Vcmb} km/s` : '', 'Distance uncertainty': isFinite(e) ? `±${Math.round((Math.pow(10, e / 5) - 1) * 100)} %` : '' });
  }
  return b.build({ key: 'cf4', title: 'Cosmicflows-4 galaxies', category: 'galaxies', simulated: false, distMethod: 'Redshift-independent distances (Tully–Fisher, fundamental plane, SN Ia, TRGB, Cepheids…)', source: 'Cosmicflows-4, Tully et al. 2023, ApJ 944, 94 (VizieR J/ApJ/944/94)' });
}

async function load2MRS(ctx: LoadCtx): Promise<RealLayer> {
  const rows = await vizier('J/ApJS/199/26', ['ID', 'Kcmag', 'cz', 'type', 'SimbadName'], {}, ctx.progress);
  const chi = chiTable(ctx.cosmo);
  const cf4 = ctx.layers.get('cf4');
  const hash = skyHash(0.02);
  if (cf4) for (let i = 0; i < cf4.n; i++) { const eq = galToEqVec([cf4.pos[i * 3], cf4.pos[i * 3 + 1], cf4.pos[i * 3 + 2]]); const d = Math.hypot(...eq); let ra = Math.atan2(eq[1], eq[0]) * 57.29578; if (ra < 0) ra += 360; hash.add(ra, Math.asin(eq[2] / d) * 57.29578, i); }
  const b = new Builder(['K magnitude', 'Redshift cz', 'Morphology code']);
  for (const r of rows) {
    const cz = num(r.cz), ra = num(r._RAJ2000), dec = num(r._DEJ2000);
    if (!(cz > 1500)) { b.skipped++; continue; } // peculiar velocities dominate below ~1 500 km/s
    if (cf4 && hash.near(ra, dec).length) { b.skipped++; continue; } // CF4 already has a better distance
    const t = r.type ?? '';
    const col = t.startsWith('-') || t.startsWith('E') ? GAL_RGB.E : GAL_RGB.S;
    b.add(ra, dec, chi(cz / C_KMS), col, 2.4, r.SimbadName || `2MASX J${r.ID}`, 'Galaxy', num(r.Kcmag), { 'K magnitude': r.Kcmag, 'Redshift cz': `${r.cz} km/s`, 'Morphology code': t }, cz / C_KMS);
  }
  return b.build({ key: '2mrs', title: '2MASS Redshift Survey galaxies', category: 'galaxies', simulated: false, distMethod: 'Redshift → comoving distance (this universe’s cosmology)', source: '2MASS Redshift Survey, Huchra et al. 2012, ApJS 199, 26 (VizieR J/ApJS/199/26)' }, ctx.cosmo);
}

async function loadSimbadGalaxies(ctx: LoadCtx): Promise<RealLayer> {
  const rows = await simbad(`SELECT TOP 60000 main_id, ra, dec, rvz_redshift, galdim_majaxis, nbref FROM basic WHERE otype = 'G' AND rvz_redshift > 0.005 ORDER BY nbref DESC`, ctx.progress);
  const chi = chiTable(ctx.cosmo);
  const b = new Builder(['Redshift z', 'Studies (references)']);
  rows.forEach((r, k) => {
    const z = num(r.rvz_redshift);
    const idx = b.add(num(r.ra), num(r.dec), chi(z), GAL_RGB.S, 2.6, cleanName(r.main_id), 'Galaxy', NaN, { 'Redshift z': z.toFixed(4), 'Studies (references)': r.nbref }, z);
    if (idx >= 0 && k < 300) b.notable.push(idx);
  });
  return b.build({ key: 'simgal', title: 'Most-studied galaxies', category: 'galaxies', simulated: false, distMethod: 'Redshift → comoving distance', source: 'SIMBAD galaxies with redshift, ranked by number of references' }, ctx.cosmo);
}

async function loadAbell(ctx: LoadCtx): Promise<RealLayer> {
  const rows = await vizier('VII/110A', ['ACO', 'z', 'Rich', 'BMtype', 'Count'], { z: '>0' }, ctx.progress);
  const chi = chiTable(ctx.cosmo);
  const b = new Builder(['Richness class', 'Bautz–Morgan type', 'Galaxy count', 'Redshift z']);
  for (const r of rows) {
    const rich = num(r.Rich);
    const idx = b.add(num(r._RAJ2000), num(r._DEJ2000), chi(num(r.z)), [1, 0.78, 0.4], 4 + rich, `Abell ${r.ACO}`, 'Galaxy cluster', NaN,
      { 'Richness class': r.Rich, 'Bautz–Morgan type': r.BMtype, 'Galaxy count': r.Count, 'Redshift z': r.z }, num(r.z));
    if (idx >= 0 && rich >= 3) b.notable.push(idx);
  }
  return b.build({ key: 'abell', title: 'Abell galaxy clusters', category: 'groups', simulated: false, distMethod: 'Redshift → comoving distance', source: 'Abell, Corwin & Olowin 1989 (VizieR VII/110A)' }, ctx.cosmo);
}

async function loadSimbadClusters(ctx: LoadCtx): Promise<RealLayer> {
  const rows = await simbad(`SELECT TOP 40000 main_id, ra, dec, rvz_redshift, otype, nbref FROM basic WHERE otype IN ('ClG','GrG','CGG','PCG') AND rvz_redshift > 0 ORDER BY nbref DESC`, ctx.progress);
  const chi = chiTable(ctx.cosmo);
  const L: Record<string, string> = { ClG: 'Galaxy cluster', GrG: 'Galaxy group', CGG: 'Compact group', PCG: 'Proto-cluster' };
  const b = new Builder(['Redshift z', 'Studies (references)']);
  rows.forEach((r, k) => {
    const z = num(r.rvz_redshift);
    const idx = b.add(num(r.ra), num(r.dec), chi(z), r.otype === 'GrG' ? [0.95, 0.85, 0.6] : [1, 0.75, 0.35], r.otype === 'GrG' ? 3 : 4, cleanName(r.main_id), L[r.otype] ?? 'Galaxy cluster', NaN, { 'Redshift z': z.toFixed(4), 'Studies (references)': r.nbref }, z);
    if (idx >= 0 && k < 200) b.notable.push(idx);
  });
  return b.build({ key: 'clg', title: 'Galaxy groups & clusters', category: 'groups', simulated: false, distMethod: 'Redshift → comoving distance', source: 'SIMBAD (ClG, GrG, compact groups, proto-clusters), ranked by references' }, ctx.cosmo);
}

async function loadSuperclusters(ctx: LoadCtx): Promise<RealLayer> {
  const rows = await simbad(`SELECT main_id, ra, dec, rvz_redshift, nbref FROM basic WHERE otype = 'SCG' AND rvz_redshift > 0`, ctx.progress);
  const chi = chiTable(ctx.cosmo);
  const b = new Builder(['Redshift z', 'Studies (references)']);
  for (const r of rows) {
    const z = num(r.rvz_redshift);
    const idx = b.add(num(r.ra), num(r.dec), chi(z), [0.8, 0.62, 1], 7, cleanName(r.main_id), 'Supercluster', NaN, { 'Redshift z': z.toFixed(4), 'Studies (references)': r.nbref }, z);
    if (idx >= 0) b.notable.push(idx);
  }
  return b.build({ key: 'scg', title: 'Superclusters', category: 'superclusters', simulated: false, distMethod: 'Redshift → comoving distance', source: 'SIMBAD superclusters (otype SCG) with redshift' }, ctx.cosmo);
}

async function loadQuasars(ctx: LoadCtx): Promise<RealLayer> {
  const rows = await simbad(`SELECT TOP 150000 main_id, ra, dec, rvz_redshift, nbref FROM basic WHERE otype = 'QSO' AND rvz_redshift > 0 ORDER BY nbref DESC`, ctx.progress);
  const chi = chiTable(ctx.cosmo);
  const b = new Builder(['Redshift z', 'Studies (references)']);
  rows.forEach((r, k) => {
    const z = num(r.rvz_redshift);
    const red = Math.min(z / 6, 1);
    const idx = b.add(num(r.ra), num(r.dec), chi(z), [1, 0.5 - 0.25 * red, 0.95 - 0.5 * red], 2.4, cleanName(r.main_id), 'Quasar', NaN, { 'Redshift z': z.toFixed(3), 'Studies (references)': r.nbref }, z);
    if (idx >= 0 && k < 100) b.notable.push(idx);
  });
  return b.build({ key: 'qso', title: 'Quasars (most-studied 150 000)', category: 'quasars', simulated: false, distMethod: 'Redshift → comoving distance', source: 'SIMBAD quasars (otype QSO) with redshift, ranked by references' }, ctx.cosmo);
}

// ── simulated components (real physics, real parameters, not observed point-by-point) ──

// Moster et al. 2013 (z = 0): Mstar/Mh = 2N / [(Mh/M1)^-beta + (Mh/M1)^gamma]. Inverted numerically.
export function haloFromStellar(mStar: number): number {
  const N = 0.0351, M1 = Math.pow(10, 11.59), beta = 1.376, gamma = 0.608;
  const f = (mh: number) => mh * 2 * N / (Math.pow(mh / M1, -beta) + Math.pow(mh / M1, gamma));
  let lo = 8, hi = 16;
  for (let i = 0; i < 60; i++) { const m = 0.5 * (lo + hi); if (f(Math.pow(10, m)) < mStar) lo = m; else hi = m; }
  return Math.pow(10, 0.5 * (lo + hi));
}
/** r200 (ly) for a halo of mass M (M☉): M = (4/3)π r³ · 200 ρcrit. */
export function r200Ly(mHalo: number, cosmo: CosmoParams): number {
  const h = cosmo.H0 / 100;
  const rhoCrit = 2.775e11 * h * h; // M☉ / Mpc³
  return Math.cbrt((3 * mHalo) / (4 * Math.PI * 200 * rhoCrit)) * MPC_LY;
}
/** Sample a radius from an NFW profile (concentration c) by inverse transform on the enclosed mass. */
function nfwRadius(rng: Rng, r200: number, c: number): number {
  const mu = (x: number) => Math.log(1 + x) - x / (1 + x);
  const target = rng.next() * mu(c);
  let lo = 0, hi = c;
  for (let i = 0; i < 40; i++) { const m = 0.5 * (lo + hi); if (mu(m) < target) lo = m; else hi = m; }
  return (0.5 * (lo + hi)) * (r200 / c);
}
function isoDir(rng: Rng): [number, number, number] { const u = rng.range(-1, 1), t = rng.range(0, 6.2832), s = Math.sqrt(1 - u * u); return [s * Math.cos(t), s * Math.sin(t), u]; }

const GC_LY = 26670; // Sun → Galactic Centre (GRAVITY 2019: 8.178 kpc)

async function simDarkMatter(ctx: LoadCtx): Promise<RealLayer> {
  const rng = new Rng(9001);
  const pos: number[] = [], names: string[] = [], types: string[] = [];
  const hosts: string[] = [], masses: string[] = [];
  const add = (x: number, y: number, z: number, host: string, m: number) => { pos.push(x, y, z); names.push(''); types.push('Dark matter (simulated)'); hosts.push(host); masses.push(m.toExponential(1)); };
  // Milky Way halo: NFW, M200 ≈ 1×10¹² M☉ (published estimates span ≈ 0.5–2×10¹²), c ≈ 10
  const mwM = 1e12, mwR = r200Ly(mwM, ctx.cosmo);
  for (let i = 0; i < 30000; i++) { const r = nfwRadius(rng, mwR, 10), d = isoDir(rng); add(GC_LY + d[0] * r, d[1] * r, d[2] * r, 'Milky Way', mwM); }
  // a halo around every loaded real galaxy and cluster (mass from light where known)
  let budget = 260000;
  for (const L of ctx.layers.values()) {
    if (L.simulated || (L.category !== 'galaxies' && L.category !== 'groups')) continue;
    for (let i = 0; i < L.n && budget > 0; i++) {
      let mh: number;
      if (L.category === 'groups') mh = L.types[i] === 'Galaxy group' ? 3e13 : 2e14 * (1 + Number(L.details['Richness class']?.[i] || 0));
      else {
        const klum = Number((L.details['K-band luminosity']?.[i] ?? '').replace('10^', '').replace(' L☉', ''));
        const mStar = isFinite(klum) && klum > 0 ? 0.6 * Math.pow(10, klum) : 3e10; // M/L_K ≈ 0.6; else a typical galaxy
        mh = haloFromStellar(mStar);
      }
      if (!isFinite(mh) || mh <= 0) mh = L.category === 'groups' ? 1e14 : 1e12;
      const r = r200Ly(mh, ctx.cosmo), n = Math.min(Math.max(Math.round(2 + 3 * Math.log10(mh / 1e10)), 2), 40);
      const cx = L.pos[i * 3], cy = L.pos[i * 3 + 1], cz = L.pos[i * 3 + 2];
      for (let k = 0; k < n; k++) { const rr = nfwRadius(rng, r, L.category === 'groups' ? 5 : 10), d = isoDir(rng); add(cx + d[0] * rr, cy + d[1] * rr, cz + d[2] * rr, L.names[i], mh); }
      budget -= n;
    }
  }
  const n = names.length;
  const rgb = new Float32Array(n * 3), size = new Float32Array(n), mag = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i++) { rgb.set([0.32, 0.22, 0.62], i * 3); size[i] = 2; }
  return {
    key: 'dm', title: 'Dark matter halos', category: 'darkmatter', simulated: true, n, pos: Float32Array.from(pos), rgb, size, mag, names, types,
    details: { 'Halo of': hosts, 'Halo mass (M☉)': masses }, notable: [], skipped: 0, loadedAt: new Date().toISOString(),
    distMethod: 'Placed around real galaxies; NFW profile; mass from stellar light via Moster et al. 2013 abundance matching',
    source: 'Simulated from real galaxy positions. Dark matter itself has never been seen — it is inferred from rotation curves, lensing, cluster dynamics and the CMB (Ωc h² = 0.120, Planck 2018).',
  };
}

async function simDarkEnergy(ctx: LoadCtx): Promise<RealLayer> {
  const rng = new Rng(68);
  const R = comovingDistanceLy(1090, ctx.cosmo), n = 14000;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const r = R * Math.cbrt(rng.next()), d = isoDir(rng); pos.set([d[0] * r, d[1] * r, d[2] * r], i * 3); }
  const h = ctx.cosmo.H0 / 100;
  const rhoL = ctx.cosmo.omegaL * 1.878e-26 * h * h; // kg/m³ (ρcrit = 1.878e-26 h² kg/m³)
  const rgb = new Float32Array(n * 3); for (let i = 0; i < n; i++) rgb.set([0.1, 0.32, 0.3], i * 3);
  return {
    key: 'de', title: 'Dark energy', category: 'darkenergy', simulated: true, n, pos, rgb, size: new Float32Array(n).fill(1.4), mag: new Float32Array(n).fill(NaN),
    names: new Array(n).fill(''), types: new Array(n).fill('Dark energy (uniform)'), details: {}, notable: [], skipped: 0, loadedAt: new Date().toISOString(),
    distMethod: 'Uniform everywhere (cosmological constant)',
    source: `Markers are spread uniformly in space: dark energy has the same density everywhere, ≈ ${rhoL.toExponential(2)} kg/m³ (≈ ${(rhoL / 1.6726e-27).toFixed(1)} proton masses per cubic metre). Its nature is unknown; measured through supernovae, BAO and the CMB.`,
  };
}

async function simGas(ctx: LoadCtx): Promise<RealLayer> {
  const rng = new Rng(21);
  const pos: number[] = [], rgb: number[] = [], types: string[] = [];
  const add = (p: [number, number, number], c: [number, number, number], t: string) => { pos.push(...p); rgb.push(...c); types.push(t); };
  const kpc = 3261.56;
  // Milky Way atomic hydrogen (HI): extends to ~25 kpc, flaring thickness
  for (let i = 0; i < 26000; i++) {
    const R = (3 + 22 * Math.pow(rng.next(), 0.8)) * kpc, phi = rng.range(0, 6.2832);
    const h = 0.15 * kpc * Math.exp(Math.max(R / kpc - 8.2, 0) / 9.8);
    add([GC_LY - R * Math.cos(phi), R * Math.sin(phi), rng.gauss() * h], [0.25, 0.42, 0.62], 'Atomic hydrogen (Milky Way disk)');
  }
  // molecular gas (H2) concentrated in a 4–8 kpc ring, thin
  for (let i = 0; i < 9000; i++) {
    const R = Math.abs(5.5 + rng.gauss() * 1.6) * kpc, phi = rng.range(0, 6.2832);
    add([GC_LY - R * Math.cos(phi), R * Math.sin(phi), rng.gauss() * 0.05 * kpc], [0.6, 0.3, 0.55], 'Molecular gas (Milky Way)');
  }
  // hot intracluster gas around loaded real clusters
  for (const L of ctx.layers.values()) {
    if (L.category !== 'groups' || L.simulated) continue;
    for (let i = 0; i < L.n; i++) for (let k = 0; k < 10; k++) {
      const d = isoDir(rng), r = Math.abs(rng.gauss()) * 1.6e6;
      add([L.pos[i * 3] + d[0] * r, L.pos[i * 3 + 1] + d[1] * r, L.pos[i * 3 + 2] + d[2] * r], [0.7, 0.32, 0.18], 'Hot intracluster gas (X-ray)');
    }
  }
  // warm-hot intergalactic gas around loaded galaxies (most of the universe's ordinary matter)
  for (const L of ctx.layers.values()) {
    if (L.category !== 'galaxies' || L.simulated) continue;
    for (let i = 0; i < L.n; i += 2) {
      const d = isoDir(rng), r = Math.abs(rng.gauss()) * 4e6;
      add([L.pos[i * 3] + d[0] * r, L.pos[i * 3 + 1] + d[1] * r, L.pos[i * 3 + 2] + d[2] * r], [0.18, 0.4, 0.45], 'Warm-hot intergalactic gas');
    }
  }
  const n = types.length;
  return {
    key: 'gas', title: 'Gas', category: 'gas', simulated: true, n, pos: Float32Array.from(pos), rgb: Float32Array.from(rgb), size: new Float32Array(n).fill(1.9), mag: new Float32Array(n).fill(NaN),
    names: new Array(n).fill(''), types, details: {}, notable: [], skipped: 0, loadedAt: new Date().toISOString(),
    distMethod: 'Milky Way gas from measured disk models; cluster and intergalactic gas placed around real clusters and galaxies',
    source: 'Simulated with measured parameters (HI disk to ~25 kpc with flaring; H₂ ring at 4–8 kpc). Most ordinary matter is intergalactic gas, not stars. Real nebulae and clouds are in the “Nebulae” catalogue.',
  };
}

// ── registry ─────────────────────────────────────────────────────────

export const SOURCES: SourceDef[] = [
  { key: 'hyg', title: 'Named & nearby stars (HYG)', category: 'stars', what: '119 600 stars with names, spectral types and parallax distances — every star visible to the eye and far beyond.', size: '34 MB', recommended: true, load: loadHYG },
  { key: 'gaia9', title: 'Gaia DR3 stars, G < 9', category: 'stars', what: '~170 000 stars with precise Gaia parallaxes; ~94 000 added after removing HYG duplicates (≈ 1–2 min).', size: '13 MB', recommended: true, load: gaiaLoader(9, 'gaia9') },
  { key: 'gaia10', title: 'Gaia DR3 stars, G < 10', category: 'stars', what: '~450 000 stars (≈ 2–4 min). Replaces nothing — load instead of G < 9 for more.', size: '≈ 35 MB', load: gaiaLoader(10, 'gaia10') },
  { key: 'gaia11', title: 'Gaia DR3 stars, G < 11', category: 'stars', what: '~1.2 million stars (several minutes; heavy on memory).', size: '≈ 95 MB', load: gaiaLoader(11, 'gaia11') },
  { key: 'exo', title: 'Exoplanets', category: 'exoplanets', what: 'Every planet in SIMBAD whose host star has a parallax.', size: '1 MB', recommended: true, load: loadExoplanets },
  { key: 'bh', title: 'Black holes & X-ray binaries', category: 'blackholes', what: 'Confirmed and candidate stellar black holes, X-ray binaries, ULXs.', size: '< 1 MB', recommended: true, load: loadBH },
  { key: 'psr', title: 'Pulsars (ATNF)', category: 'pulsars', what: '~2 500 radio pulsars (neutron stars) from the VizieR copy of the ATNF catalogue.', size: '1 MB', recommended: true, load: loadPulsars },
  { key: 'wd', title: 'White dwarfs (Gaia)', category: 'whitedwarfs', what: '~134 000 high-confidence Gaia white dwarfs with > 10σ parallax.', size: '≈ 4 MB', load: loadWD },
  { key: 'oc', title: 'Star clusters (Gaia)', category: 'clusters', what: '~7 000 open clusters, moving groups and globulars with Gaia distances.', size: '1 MB', recommended: true, load: loadOpenClusters },
  { key: 'gc', title: 'Globular clusters (Harris)', category: 'clusters', what: 'The Milky Way’s catalogued globular clusters with distances (~145).', size: '< 1 MB', recommended: true, load: loadGlobulars },
  { key: 'neb', title: 'Nebulae & molecular clouds', category: 'nebulae', what: 'Planetary nebulae, star-forming regions, supernova remnants and clouds with measured distances.', size: '≈ 2 MB', recommended: true, load: loadNebulae },
  { key: 'ungc', title: 'Nearby galaxies (UNGC)', category: 'galaxies', what: '~870 galaxies within ~36 Mly (2013 census) with accurate distances.', size: '< 1 MB', recommended: true, load: loadUNGC },
  { key: 'cf4', title: 'Cosmicflows-4 galaxies', category: 'galaxies', what: '~56 000 galaxies with redshift-independent distances — the best real 3-D map of nearby structure.', size: '≈ 4 MB', recommended: true, load: loadCF4 },
  { key: '2mrs', title: '2MASS Redshift Survey', category: 'galaxies', what: '~45 000 bright galaxies across the whole sky (redshift distances).', size: '≈ 4 MB', recommended: true, load: load2MRS },
  { key: 'simgal', title: 'Most-studied galaxies (SIMBAD)', category: 'galaxies', what: '60 000 galaxies with redshifts, ranked by research attention.', size: '≈ 4 MB', load: loadSimbadGalaxies },
  { key: 'abell', title: 'Abell galaxy clusters', category: 'groups', what: 'Rich clusters of galaxies with measured redshifts.', size: '< 1 MB', recommended: true, load: loadAbell },
  { key: 'clg', title: 'Galaxy groups & clusters (SIMBAD)', category: 'groups', what: '40 000 groups, clusters and proto-clusters with redshifts.', size: '≈ 3 MB', load: loadSimbadClusters },
  { key: 'scg', title: 'Superclusters', category: 'superclusters', what: 'All superclusters in SIMBAD with a redshift.', size: '< 1 MB', recommended: true, load: loadSuperclusters },
  { key: 'qso', title: 'Quasars', category: 'quasars', what: 'The 150 000 most-studied quasars, out to z > 7.', size: '≈ 10 MB', recommended: true, load: loadQuasars },
  { key: 'dm', title: 'Dark matter (simulated)', category: 'darkmatter', what: 'NFW halos around the Milky Way and every loaded galaxy and cluster. Load galaxies first.', size: 'generated', simulated: true, recommended: true, load: simDarkMatter },
  { key: 'gas', title: 'Gas (simulated)', category: 'gas', what: 'Milky Way hydrogen, hot cluster gas, intergalactic gas around loaded galaxies.', size: 'generated', simulated: true, recommended: true, load: simGas },
  { key: 'de', title: 'Dark energy (uniform)', category: 'darkenergy', what: 'Shows that dark energy fills all space evenly.', size: 'generated', simulated: true, load: simDarkEnergy },
];

function galToEqVec(g: [number, number, number]): [number, number, number] { return galacticToEq(g) as [number, number, number]; }
export { galToEqVec };

// ── live name lookup (any object SIMBAD knows) ───────────────────────

export interface Lookup { name: string; ra: number; dec: number; distLy: number; otype: string; method: string; z: number; category: Category }

/** SIMBAD object type → this app's category. */
export function categoryOfOtype(o: string): Category {
  const t = o.trim();
  if (t === 'Pl' || t === 'Pl?') return 'exoplanets';
  if (/^(BH|BH\?|HXB|LXB|XB|ULX|X)$/.test(t)) return 'blackholes';
  if (/^(Psr|PSR|N\*|N\*\?|Mag)/.test(t)) return 'pulsars';
  if (/^WD/.test(t)) return 'whitedwarfs';
  if (/^(OpC|GlC|Cl\*|As\*|MGr|C\?\*|Gl\?|St\*)/.test(t)) return 'clusters';
  if (/^(PN|HII|SNR|MoC|DNe|RNe|ISM|Cld|GNe|Neb|EmO|bub|SFR|cor|glb|CGb|HVC|of\?)/.test(t)) return 'nebulae';
  if (t === 'SCG' || t === 'vid') return 'superclusters';
  if (/^(ClG|GrG|CGG|PCG|C\?G)/.test(t)) return 'groups';
  if (/^(QSO|Bla|BLL|Q\?|Bz\?|BL\?)/.test(t)) return 'quasars';
  if (/^(G|LSB|bCG|SBG|H2G|EmG|AGN|SyG|Sy1|Sy2|rG|LIN|GiP|BiC|GiC|GiG|IG|PaG|LyA|DLA|mAL|LLS|BAL|gLe|LeG|HzG|ERO|BClG)/.test(t)) return 'galaxies';
  return 'stars';
}

export async function resolveSimbad(name: string, cosmo: CosmoParams): Promise<Lookup | null> {
  const esc = name.trim().replace(/'/g, "''");
  if (!esc) return null;
  for (const id of [esc, `NAME ${esc}`]) {
    const rows = await simbad(`SELECT b.oid, b.main_id, b.ra, b.dec, b.plx_value, b.plx_err, b.rvz_redshift, b.otype FROM basic b JOIN ident i ON i.oidref = b.oid WHERE i.id = '${id}'`);
    if (!rows.length) continue;
    const r = rows[0];
    const ra = num(r.ra), dec = num(r.dec), plx = num(r.plx_value), plxErr = num(r.plx_err), z = num(r.rvz_redshift);
    if (!isFinite(ra) || !isFinite(dec)) return null;
    let distLy = NaN, method = '';
    if (plx > 0 && (!(plxErr > 0) || plx / plxErr > 3)) { distLy = (1000 / plx) * PC_LY; method = `parallax ${plx.toFixed(3)} mas`; }
    if (!isFinite(distLy)) {
      const ds = await simbad(`SELECT dist, unit, method FROM mesDistance WHERE oidref = ${r.oid}`);
      const pc = ds.map((d) => { const v = num(d.dist), u = (d.unit ?? '').trim(); return u === 'kpc' ? v * 1e3 : u === 'Mpc' ? v * 1e6 : u === 'Gpc' ? v * 1e9 : v; }).filter((v) => v > 0);
      if (pc.length) { distLy = median(pc) * PC_LY; method = `median of ${pc.length} published distance${pc.length > 1 ? 's' : ''}`; }
    }
    if (!isFinite(distLy) && z > 0.003) { distLy = chiTable(cosmo)(z); method = `redshift z = ${z.toFixed(4)} → comoving distance`; }
    if (!isFinite(distLy)) return { name: cleanName(r.main_id), ra, dec, distLy: NaN, otype: r.otype, method: 'no distance in SIMBAD', z, category: categoryOfOtype(r.otype) };
    return { name: cleanName(r.main_id), ra, dec, distLy, otype: r.otype, method, z, category: categoryOfOtype(r.otype) };
  }
  return null;
}

/** Turn looked-up objects into small layers, one per category (so "show only a category" includes them). */
export function lookupLayers(list: Lookup[]): RealLayer[] {
  const byCat = new Map<Category, Lookup[]>();
  for (const l of list) { const a = byCat.get(l.category); if (a) a.push(l); else byCat.set(l.category, [l]); }
  const out: RealLayer[] = [];
  for (const [cat, items] of byCat) {
    const b = new Builder(['SIMBAD type', 'Distance from']);
    for (const l of items) {
      const i = b.add(l.ra, l.dec, l.distLy, [1, 0.95, 0.55], 7, l.name, `${CATEGORY_LABEL[cat]} (looked up)`, NaN, { 'SIMBAD type': l.otype, 'Distance from': l.method });
      if (i >= 0) b.notable.push(i);
    }
    out.push(b.build({ key: `lookup:${cat}`, title: `Looked up: ${CATEGORY_LABEL[cat]}`, category: cat, simulated: false, distMethod: 'SIMBAD: parallax, published distances or redshift', source: 'SIMBAD name lookup (CDS Strasbourg)' }));
  }
  return out;
}
