// Real-time feeds: what observatories are detecting now and where things are right now.
// Nothing here is simulated. Light takes time to arrive, so "live" means
//   • positions computed for this moment (spacecraft, near-Earth asteroids, the ISS), and
//   • events reported by observatories in the last days/weeks (flares, supernovae, black-hole mergers).
// Sources (all public, no key): NOAA SWPC, NASA JPL Horizons + SBDB close approaches,
// ALeRCE (ZTF survey alert broker), LIGO/Virgo/KAGRA GraceDB, wheretheiss.at, NASA SDO.

import type { Vec3 } from '../sim/ephemeris';
import { julianDate } from '../sim/ephemeris';
import { comovingDistanceLy, type CosmoParams } from '../sim/cosmology';

export type LiveKind = 'flare' | 'neo' | 'spacecraft' | 'supernova' | 'gw' | 'iss';

export interface LiveEvent {
  id: string;
  kind: LiveKind;
  name: string;
  type: string;
  time: number;                 // ms since 1970: detection / peak / closest approach / position epoch
  summary: string;
  rows: [string, string][];
  source: string;
  url?: string;
  helio?: { pos: Vec3; vel: Vec3; jd: number }; // heliocentric ecliptic J2000, AU and AU/day
  geo?: { lat: number; lon: number; altKm: number; t: number };
  sky?: { ra: number; dec: number; dLMpc?: number; distLy?: number; note: string };
  sun?: boolean;               // happens on the Sun
}

export interface FeedDef { key: LiveKind; title: string; what: string; everyMs: number; desktopOnly: boolean }
export const FEEDS: FeedDef[] = [
  { key: 'flare', title: 'Solar flares', what: 'X-ray flares on the Sun from the GOES satellites, last 7 days (NOAA SWPC).', everyMs: 5 * 60e3, desktopOnly: false },
  { key: 'iss', title: 'International Space Station', what: 'Where the ISS is above Earth right now (updates every 5 s).', everyMs: 5e3, desktopOnly: false },
  { key: 'spacecraft', title: 'Spacecraft', what: 'Real positions of Voyager 1 & 2, New Horizons, JWST, Parker Solar Probe and other probes (NASA JPL Horizons).', everyMs: 60 * 60e3, desktopOnly: true },
  { key: 'neo', title: 'Asteroid flybys', what: 'Asteroids passing within 0.05 AU of Earth from 3 days ago to 30 days ahead, at their real positions (NASA JPL).', everyMs: 60 * 60e3, desktopOnly: true },
  { key: 'supernova', title: 'Supernovae & star explosions', what: 'Explosions found by the ZTF survey in the last 45 days, machine-classified by ALeRCE. Distance estimated from peak brightness.', everyMs: 30 * 60e3, desktopOnly: false },
  { key: 'gw', title: 'Black-hole & neutron-star mergers', what: 'Significant gravitational-wave alerts from LIGO/Virgo/KAGRA, placed at their most likely sky position and distance.', everyMs: 30 * 60e3, desktopOnly: true },
];

export type FeedState = { status: 'idle' | 'loading' | 'ok' | 'error'; msg?: string; updated?: number; note?: string };

const SWPC = 'https://services.swpc.noaa.gov';
const ALERCE = 'https://api.alerce.online/ztf/v1/objects/';
const HORIZONS = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const CAD = 'https://ssd-api.jpl.nasa.gov/cad.api';
const GRACEDB = 'https://gracedb.ligo.org/api/superevents/';
const MONTHS: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
/** JPL close-approach date "2026-Nov-05 14:06" → ms. */
const cadTime = (s: string) => { const m = /(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})/.exec(s); return m ? Date.parse(`${m[1]}-${MONTHS[m[2]]}-${m[3]}T${m[4]}:${m[5]}:00Z`) : NaN; };

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  return r.json() as Promise<T>;
}
const ms = (s: string) => Date.parse(s.endsWith('Z') ? s : s.replace(' ', 'T') + 'Z');
const mjdToMs = (mjd: number) => (mjd - 40587) * 86400000;
const fmtUTC = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

// ── Horizons ─────────────────────────────────────────────────────────

/** Heliocentric ecliptic J2000 state (AU, AU/day) of any body Horizons knows, at time t. */
export async function horizonsState(command: string, t: Date, signal?: AbortSignal): Promise<{ pos: Vec3; vel: Vec3; jd: number } | null> {
  const f = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');
  const p = new URLSearchParams({
    format: 'json', COMMAND: `'${command}'`, OBJ_DATA: 'NO', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'VECTORS',
    CENTER: "'500@10'", START_TIME: `'${f(t)}'`, STOP_TIME: `'${f(new Date(t.getTime() + 60000))}'`, STEP_SIZE: "'1'",
    VEC_TABLE: '2', REF_PLANE: 'ECLIPTIC', REF_SYSTEM: 'ICRF', OUT_UNITS: 'AU-D', CSV_FORMAT: 'YES',
  });
  const j = await getJSON<{ result?: string; error?: string }>(`${HORIZONS}?${p}`, signal);
  const res = j.result ?? '';
  const s = res.indexOf('$$SOE');
  if (s < 0) return null;
  const line = res.slice(s + 5).trim().split('\n')[0];
  const f2 = line.split(',').map((x) => x.trim());
  const n = f2.slice(2, 8).map(Number);
  if (n.length < 6 || n.some((v) => !isFinite(v))) return null;
  return { pos: [n[0], n[1], n[2]], vel: [n[3], n[4], n[5]], jd: Number(f2[0]) };
}

const SPACECRAFT: [string, string, string][] = [
  ['-31', 'Voyager 1', 'Launched 1977; the most distant human-made object, in interstellar space since 2012.'],
  ['-32', 'Voyager 2', 'Launched 1977; the only probe to visit Uranus and Neptune; in interstellar space since 2018.'],
  ['-98', 'New Horizons', 'Flew past Pluto (2015) and Arrokoth (2019); now in the Kuiper belt.'],
  ['-96', 'Parker Solar Probe', 'Dives through the Sun’s corona; fastest human-made object.'],
  ['-170', 'James Webb Space Telescope', 'Infrared observatory orbiting the Sun–Earth L2 point, 1.5 million km from Earth.'],
  ['-61', 'Juno', 'Orbiting Jupiter since 2016.'],
  ['-159', 'Europa Clipper', 'On its way to Jupiter’s moon Europa.'],
  ['-28', 'JUICE', 'ESA probe on its way to Jupiter’s icy moons.'],
  ['-255', 'Psyche', 'On its way to the metal-rich asteroid 16 Psyche.'],
  ['-49', 'Lucy', 'Touring Jupiter’s trojan asteroids.'],
  ['-144', 'Solar Orbiter', 'ESA/NASA probe imaging the Sun’s poles.'],
  ['-121', 'BepiColombo', 'ESA/JAXA mission to Mercury.'],
];

// ── HEALPix + FITS (gravitational-wave sky maps) ─────────────────────

const JRLL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4];
const JPLL = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7];
/** HEALPix NESTED pixel → (θ, φ) in radians (standard pix2ang_nest). */
export function pix2angNest(nside: number, ipix: number): [number, number] {
  const npface = nside * nside;
  const face = Math.floor(ipix / npface);
  let ipf = ipix % npface;
  let ix = 0, iy = 0;
  for (let bit = 0; ipf > 0; bit++) { ix += (ipf % 2) * 2 ** bit; ipf = Math.floor(ipf / 2); iy += (ipf % 2) * 2 ** bit; ipf = Math.floor(ipf / 2); }
  const jr = JRLL[face] * nside - ix - iy - 1;
  let nr: number, z: number, kshift: number;
  if (jr < nside) { nr = jr; z = 1 - (nr * nr) / (3 * npface); kshift = 0; }
  else if (jr > 3 * nside) { nr = 4 * nside - jr; z = -1 + (nr * nr) / (3 * npface); kshift = 0; }
  else { nr = nside; z = ((2 * nside - jr) * 2) / (3 * nside); kshift = (jr - nside) & 1; }
  let jp = (JPLL[face] * nr + ix - iy + 1 + kshift) / 2;
  if (jp > 4 * nside) jp -= 4 * nside;
  if (jp < 1) jp += 4 * nside;
  return [Math.acos(Math.max(-1, Math.min(1, z))), (jp - (kshift + 1) * 0.5) * (Math.PI / 2 / nr)];
}

/** Most probable direction, 90 % area and distance from a multi-order (NUNIQ) sky map in FITS. */
export function readSkymap(fits: Uint8Array): { ra: number; dec: number; area90: number; distMean: number; distStd: number } | null {
  const td = new TextDecoder('latin1');
  const card = (block: number) => td.decode(fits.subarray(block, block + 2880));
  let off = 0;
  const hdrs: Record<string, string>[] = [];
  let dataStart = -1;
  for (let h = 0; h < 2 && off < fits.length; h++) {
    const kv: Record<string, string> = {};
    for (;;) {
      const blk = card(off); off += 2880;
      let end = false;
      for (let c = 0; c < 36; c++) {
        const line = blk.slice(c * 80, c * 80 + 80);
        const key = line.slice(0, 8).trim();
        if (key === 'END') { end = true; break; }
        if (line[8] === '=') kv[key] = line.slice(10).split('/')[0].trim().replace(/^'|'\s*$/g, '').trim();
      }
      if (end) break;
    }
    hdrs.push(kv);
    if (h === 0) { const nax = Number(kv.NAXIS ?? 0); if (nax > 0) return null; }
    else dataStart = off;
  }
  const ext = hdrs[1];
  if (!ext || dataStart < 0 || ext.ORDERING !== 'NUNIQ') return null;
  const rowBytes = Number(ext.NAXIS1), rows = Number(ext.NAXIS2), nf = Number(ext.TFIELDS);
  const sizes: Record<string, number> = { K: 8, D: 8, E: 4, J: 4 };
  let uOff = -1, pOff = -1, cur = 0;
  for (let k = 1; k <= nf; k++) {
    const name = ext[`TTYPE${k}`], form = (ext[`TFORM${k}`] ?? '').replace(/^1/, '');
    if (name === 'UNIQ') uOff = cur;
    if (name === 'PROBDENSITY') pOff = cur;
    cur += sizes[form[0]] ?? 8;
  }
  if (uOff < 0 || pOff < 0) return null;
  const dv = new DataView(fits.buffer, fits.byteOffset + dataStart, rowBytes * rows);
  const pix: { p: number; a: number; uniq: number }[] = [];
  let best = -1, bestP = -1;
  for (let i = 0; i < rows; i++) {
    const uniq = Number(dv.getBigInt64(i * rowBytes + uOff));
    const dens = dv.getFloat64(i * rowBytes + pOff);
    const order = Math.floor(Math.log2(uniq / 4) / 2);
    const area = (4 * Math.PI) / (12 * 4 ** order);
    pix.push({ p: dens * area, a: area, uniq });
    if (dens > bestP) { bestP = dens; best = i; }
  }
  const u = pix[best].uniq, order = Math.floor(Math.log2(u / 4) / 2);
  const [th, ph] = pix2angNest(2 ** order, u - 4 * 4 ** order);
  pix.sort((a, b) => b.p / b.a - a.p / a.a);
  let cum = 0, area = 0;
  for (const q of pix) { cum += q.p; area += q.a; if (cum >= 0.9) break; }
  return { ra: (ph * 180) / Math.PI, dec: 90 - (th * 180) / Math.PI, area90: area * (180 / Math.PI) ** 2, distMean: Number(ext.DISTMEAN), distStd: Number(ext.DISTSTD) };
}

/** Luminosity distance (ly) → comoving distance (ly) for a given cosmology. */
export function comovingFromLuminosity(dLly: number, cosmo: CosmoParams): number {
  let lo = 0, hi = 20;
  for (let k = 0; k < 50; k++) { const z = 0.5 * (lo + hi); if ((1 + z) * comovingDistanceLy(z, cosmo) < dLly) lo = z; else hi = z; }
  return comovingDistanceLy(0.5 * (lo + hi), cosmo);
}

// Typical peak absolute magnitudes used as standard candles (ZTF g/r bands, approximate).
const PEAK_M: Record<string, [number, string]> = {
  SNIa: [-19.3, 'Type Ia supernova (a white dwarf exploding)'],
  SNIbc: [-17.5, 'Type Ib/c supernova (a stripped massive star collapsing)'],
  SNII: [-16.8, 'Type II supernova (a massive star collapsing)'],
  SLSN: [-21.5, 'Superluminous supernova'],
  TDE: [-19.5, 'Tidal disruption event (a black hole tearing a star apart)'],
};

// ── the store ────────────────────────────────────────────────────────

class LiveStore {
  readonly events = new Map<string, LiveEvent>();
  readonly state = new Map<LiveKind, FeedState>();
  private subs = new Set<() => void>();
  private timers = new Map<LiveKind, ReturnType<typeof setTimeout>>();
  private gwCache = new Map<string, LiveEvent | null>();
  version = 0;
  started = false;
  solar: { xray?: string; kp?: number; kpTime?: string } = {};

  constructor() { for (const f of FEEDS) this.state.set(f.key, { status: 'idle' }); }
  subscribe(f: () => void) { this.subs.add(f); return () => { this.subs.delete(f); }; }
  private emit() { this.version++; for (const f of this.subs) f(); }
  private set(k: LiveKind, s: FeedState) { this.state.set(k, { ...this.state.get(k), ...s }); this.emit(); }

  list(kind?: LiveKind): LiveEvent[] { return [...this.events.values()].filter((e) => !kind || e.kind === kind).sort((a, b) => b.time - a.time); }

  private replace(kind: LiveKind, evs: LiveEvent[]) {
    for (const [id, e] of this.events) if (e.kind === kind) this.events.delete(id);
    for (const e of evs) this.events.set(e.id, e);
  }

  start() {
    if (this.started) return;
    this.started = true;
    for (const f of FEEDS) void this.refresh(f.key);
  }

  async refresh(k: LiveKind) {
    clearTimeout(this.timers.get(k));
    const def = FEEDS.find((f) => f.key === k)!;
    if (this.state.get(k)?.status !== 'ok') this.set(k, { status: 'loading', msg: 'Contacting…' });
    try {
      const evs = await this.fetchers[k]();
      this.replace(k, evs);
      this.set(k, { status: 'ok', updated: Date.now(), msg: undefined });
    } catch (e) {
      const m = (e as Error).message || String(e);
      this.set(k, { status: 'error', msg: /fetch/i.test(m) && def.desktopOnly ? 'This source only works in the Cosmos desktop app (the browser blocks it).' : m });
    }
    this.timers.set(k, setTimeout(() => void this.refresh(k), def.everyMs));
  }

  private fetchers: Record<LiveKind, () => Promise<LiveEvent[]>> = {
    flare: async () => {
      const [latest, week, kp] = await Promise.all([
        getJSON<{ current_class?: string; time_tag?: string }[]>(`${SWPC}/json/goes/primary/xray-flares-latest.json`).catch(() => []),
        getJSON<{ begin_time: string; max_time: string; end_time?: string; max_class: string; satellite?: number }[]>(`${SWPC}/json/goes/primary/xray-flares-7-day.json`),
        getJSON<{ time_tag: string; Kp: number }[]>(`${SWPC}/products/noaa-planetary-k-index.json`).catch(() => []),
      ]);
      this.solar.xray = latest[0]?.current_class;
      const k = kp[kp.length - 1];
      if (k) { this.solar.kp = k.Kp; this.solar.kpTime = k.time_tag; }
      return week.filter((f) => f.max_class).map((f) => {
        const cls = f.max_class[0];
        const strength = cls === 'X' ? 'X-class (major)' : cls === 'M' ? 'M-class (medium)' : cls === 'C' ? 'C-class (small)' : 'B/A-class (minor)';
        return {
          id: `flare:${f.max_time}`, kind: 'flare' as const, name: `${f.max_class} solar flare`, type: `Solar flare · ${strength}`,
          time: ms(f.max_time), sun: true, source: 'NOAA Space Weather Prediction Center (GOES X-ray sensors)',
          summary: `X-ray burst from the Sun peaking at class ${f.max_class}. Its light reached Earth 8.3 minutes after it happened.`,
          rows: [['Began', fmtUTC(ms(f.begin_time))], ['Peak', fmtUTC(ms(f.max_time))], ['Ended', f.end_time ? fmtUTC(ms(f.end_time)) : 'ongoing'], ['Peak class', f.max_class]],
        };
      });
    },

    iss: async () => {
      const j = await getJSON<{ latitude: number; longitude: number; altitude: number; velocity: number; visibility: string; timestamp: number }>('https://api.wheretheiss.at/v1/satellites/25544');
      return [{
        id: 'iss', kind: 'iss', name: 'International Space Station', type: 'Crewed space station', time: j.timestamp * 1000,
        geo: { lat: j.latitude, lon: j.longitude, altKm: j.altitude, t: j.timestamp * 1000 }, source: 'wheretheiss.at (NORAD orbital elements)',
        summary: 'Orbits Earth every ~92 minutes. At this map scale it sits on top of Earth; its exact place over the ground is below.',
        rows: [['Over', `${j.latitude.toFixed(2)}°, ${j.longitude.toFixed(2)}°`], ['Altitude', `${j.altitude.toFixed(0)} km`], ['Speed', `${Math.round(j.velocity).toLocaleString('en-US')} km/h`], ['In', j.visibility === 'daylight' ? 'sunlight' : 'Earth’s shadow']],
      }];
    },

    spacecraft: async () => {
      const now = new Date(), out: LiveEvent[] = [];
      for (const [cmd, name, info] of SPACECRAFT) {
        const s = await horizonsState(cmd, now).catch(() => null);
        if (!s) continue;
        const r = Math.hypot(...s.pos), v = Math.hypot(...s.vel) * 1731.456; // AU/day → km/s
        out.push({
          id: `sc:${cmd}`, kind: 'spacecraft', name, type: 'Spacecraft', time: now.getTime(), helio: s, source: 'NASA JPL Horizons',
          summary: info,
          rows: [['Distance from the Sun', `${r.toFixed(r < 10 ? 3 : 1)} AU`], ['Speed (vs the Sun)', `${v.toFixed(1)} km/s`], ['Signal travel time to here', `${((r * 499.005) / 3600).toFixed(r < 10 ? 2 : 1)} h from the Sun`]],
        });
      }
      if (!out.length) throw new Error('JPL Horizons did not answer');
      return out;
    },

    neo: async () => {
      const d0 = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
      const j = await getJSON<{ data?: string[][]; fields: string[] }>(`${CAD}?date-min=${d0}&date-max=%2B30&dist-max=0.05&sort=dist&fullname=true`);
      const rows = (j.data ?? []).slice(0, 18);
      const F = (r: string[], k: string) => r[j.fields.indexOf(k)];
      const now = new Date(), out: LiveEvent[] = [];
      for (const r of rows) {
        const des = F(r, 'des'), dist = Number(F(r, 'dist')), vrel = Number(F(r, 'v_rel')), h = Number(F(r, 'h'));
        const tca = cadTime(F(r, 'cd'));
        const cmd = /^\d+$/.test(des) ? `${des};` : `DES=${des};`;
        const s = await horizonsState(cmd, now).catch(() => null);
        const sizeM = isFinite(h) ? (1329 / Math.sqrt(0.14)) * Math.pow(10, -h / 5) * 1000 : NaN; // D(km) = 1329/√albedo · 10^(−H/5), albedo 0.14 assumed
        out.push({
          id: `neo:${des}`, kind: 'neo', name: (F(r, 'fullname') || des).trim().replace(/^\(|\)$/g, ''), type: 'Near-Earth asteroid flyby',
          time: tca, helio: s ?? undefined, source: 'NASA JPL Center for Near-Earth Object Studies',
          summary: `${tca > Date.now() ? 'Will pass' : 'Passed'} ${(dist * 389.17).toFixed(1)} times the Moon’s distance from Earth.`,
          rows: [['Closest approach', fmtUTC(tca)], ['Miss distance', `${(dist * 149597870.7).toLocaleString('en-US', { maximumFractionDigits: 0 })} km (${(dist * 389.17).toFixed(2)} lunar distances)`],
            ['Speed relative to Earth', `${vrel.toFixed(1)} km/s`], ['Size (estimated)', isFinite(sizeM) ? `≈ ${sizeM < 1000 ? Math.round(sizeM) + ' m' : (sizeM / 1000).toFixed(1) + ' km'} (from brightness)` : 'unknown']],
        });
      }
      return out;
    },

    supernova: async () => {
      const mjdNow = julianDate(new Date()) - 2400000.5, since = Math.floor(mjdNow - 45);
      type Obj = { oid: string; meanra: number; meandec: number; firstmjd: number; lastmjd: number; class: string; probability: number; ndet: number };
      const lists = await Promise.all(Object.keys(PEAK_M).map((cls) =>
        getJSON<{ items: Obj[] }>(`${ALERCE}?classifier=lc_classifier&class=${cls}&probability=0.3&firstmjd=${since}&page_size=15&order_by=probability&order_mode=DESC`).then((j) => j.items).catch(() => [] as Obj[])));
      const objs = lists.flat().filter((o) => o.ndet >= 3);
      if (!objs.length && lists.every((l) => !l.length)) throw new Error('ALeRCE returned nothing');
      const out: LiveEvent[] = [];
      for (let i = 0; i < objs.length; i += 6) {
        await Promise.all(objs.slice(i, i + 6).map(async (o) => {
          const stats = await getJSON<{ fid: number; magmin: number }[]>(`${ALERCE}${o.oid}/magstats`).catch(() => []);
          const peak = Math.min(...stats.map((s) => s.magmin).filter((m) => isFinite(m)));
          const [M, label] = PEAK_M[o.class] ?? [-17.5, o.class];
          const dLMpc = isFinite(peak) ? Math.pow(10, (peak - M + 5) / 5) / 1e6 : undefined;
          out.push({
            id: `sn:${o.oid}`, kind: 'supernova', name: o.oid, type: label, time: mjdToMs(o.firstmjd),
            sky: { ra: o.meanra, dec: o.meandec, dLMpc, note: 'Estimated from peak brightness, assuming a typical explosion of this type (±30–50 %). Dust and an unfinished rise make it less certain.' },
            source: 'ZTF survey (Palomar) via the ALeRCE broker — machine classification', url: `https://alerce.online/object/${o.oid}`,
            summary: `First seen ${fmtUTC(mjdToMs(o.firstmjd))}; ${Math.round(o.probability * 100)} % likely to be a ${o.class} by the ALeRCE classifier (not yet confirmed by a spectrum).`,
            rows: [['First detected', fmtUTC(mjdToMs(o.firstmjd))], ['Last detected', fmtUTC(mjdToMs(o.lastmjd))], ['Detections', String(o.ndet)],
              ['Brightest so far', isFinite(peak) ? `magnitude ${peak.toFixed(2)}` : 'unknown'], ['Classifier confidence', `${Math.round(o.probability * 100)} %`]],
          });
        }));
      }
      // brand-new candidates (first seen in the last 3 days): direction known, distance not yet
      const fresh = await getJSON<{ items: Obj[] }>(`${ALERCE}?classifier=stamp_classifier&class=SN&probability=0.6&firstmjd=${Math.floor(mjdNow - 3)}&page_size=20&order_by=firstmjd&order_mode=DESC`).then((j) => j.items).catch(() => [] as Obj[]);
      for (const o of fresh) {
        if (out.some((e) => e.id === `sn:${o.oid}`)) continue;
        out.push({
          id: `sn:${o.oid}`, kind: 'supernova', name: o.oid, type: 'New supernova candidate (hours–days old)', time: mjdToMs(o.firstmjd),
          sky: { ra: o.meanra, dec: o.meandec, note: 'Too new to estimate a distance — it appears on the map once its brightness has been measured for a few nights.' },
          source: 'ZTF survey (Palomar) via the ALeRCE broker — image-based classification', url: `https://alerce.online/object/${o.oid}`,
          summary: `A new point of light first seen ${fmtUTC(mjdToMs(o.firstmjd))}, ${Math.round(o.probability * 100)} % likely to be a supernova from its first image.`,
          rows: [['First detected', fmtUTC(mjdToMs(o.firstmjd))], ['Sky position', `RA ${o.meanra.toFixed(3)}°, Dec ${o.meandec.toFixed(3)}°`], ['Classifier confidence', `${Math.round(o.probability * 100)} %`]],
        });
      }
      return out;
    },

    gw: async () => {
      const q = encodeURIComponent('category: Production label: SIGNIF_LOCKED');
      const j = await getJSON<{ superevents: { superevent_id: string; created: string; t_0: number; far: number; labels: string[] }[] }>(`${GRACEDB}?format=json&count=10&orderby=-created&query=${q}`);
      const out: LiveEvent[] = [];
      for (const s of j.superevents.filter((x) => !x.labels.includes('RETRACTED'))) {
        if (!this.gwCache.has(s.superevent_id)) this.gwCache.set(s.superevent_id, await this.gwEvent(s).catch(() => null));
        const e = this.gwCache.get(s.superevent_id);
        if (e) out.push(e);
      }
      const newest = j.superevents[0];
      const age = newest ? (Date.now() - ms(newest.created)) / 86400000 : Infinity;
      this.state.set('gw', { ...this.state.get('gw')!, note: age > 14 ? `No new significant alert for ${Math.round(age)} days — the detectors are probably between observing runs.` : undefined });
      return out;
    },
  };

  private async gwEvent(s: { superevent_id: string; created: string; far: number }): Promise<LiveEvent | null> {
    const id = s.superevent_id;
    const files = await getJSON<Record<string, string>>(`${GRACEDB}${id}/files/?format=json`);
    const name = [`${id}-update.json`, `${id}-initial.json`, `${id}-preliminary.json`].find((n) => files[n]);
    if (!name) return null;
    const alert = await getJSON<{ event?: { time?: string; classification?: Record<string, number>; skymap?: string; instruments?: string[] } }>(files[name]);
    const ev = alert.event;
    if (!ev) return null;
    let sky: LiveEvent['sky'];
    let area = '';
    if (ev.skymap) {
      const bin = atob(ev.skymap);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const m = readSkymap(buf);
      if (m) {
        sky = { ra: m.ra, dec: m.dec, dLMpc: m.distMean, note: `Most probable point of a ${Math.round(m.area90).toLocaleString('en-US')} square-degree region (90 %); distance ${Math.round(m.distMean)} ± ${Math.round(m.distStd)} Mpc.` };
        area = `${Math.round(m.area90).toLocaleString('en-US')} deg² (90 %)`;
      }
    }
    const cls = Object.entries(ev.classification ?? {}).sort((a, b) => b[1] - a[1])[0];
    const kind: Record<string, string> = { BBH: 'Two black holes merging', BNS: 'Two neutron stars merging', NSBH: 'A neutron star and a black hole merging', Terrestrial: 'Probably noise' };
    const t = ev.time ? Date.parse(ev.time) : ms(s.created);
    return {
      id: `gw:${id}`, kind: 'gw', name: id, type: cls ? kind[cls[0]] ?? cls[0] : 'Compact-object merger', time: t, sky,
      source: 'LIGO / Virgo / KAGRA public alerts (GraceDB)', url: `https://gracedb.ligo.org/superevents/${id}/view/`,
      summary: `Gravitational waves detected ${fmtUTC(t)}${cls ? ` — ${Math.round(cls[1] * 100)} % ${cls[0]}` : ''}. ${sky?.dLMpc ? `Luminosity distance ≈ ${Math.round(sky.dLMpc).toLocaleString('en-US')} Mpc; the map places it at the matching comoving distance.` : ''}`,
      rows: [['Detected', fmtUTC(t)], ['Classification', cls ? `${kind[cls[0]] ?? cls[0]} (${Math.round(cls[1] * 100)} %)` : 'unknown'],
        ['False-alarm rate', `once per ${fmtYears(1 / s.far / 3.15576e7)}`], ['Sky region', area || 'unknown'], ['Detectors', (ev.instruments ?? []).join(', ')]],
    };
  }

  toggleAll(on: boolean) { if (on) this.start(); else { for (const t of this.timers.values()) clearTimeout(t); this.timers.clear(); this.started = false; } }
}

function fmtYears(y: number): string {
  if (!isFinite(y)) return '—';
  if (y > 1e9) return `${(y / 1e9).toFixed(0)} billion years`;
  if (y > 1e6) return `${(y / 1e6).toFixed(0)} million years`;
  if (y > 1e3) return `${(y / 1e3).toFixed(0)} thousand years`;
  return `${y.toPrecision(2)} years`;
}

export const liveStore = new LiveStore();

/** Whether an event has a position that can be drawn on the map. */
export const placeable = (e: LiveEvent) => !!(e.helio || e.geo || e.sun || e.sky?.dLMpc || e.sky?.distLy);

/** Time since an event, in words. */
export function ago(t: number, now = Date.now()): string {
  const s = (now - t) / 1000, a = Math.abs(s), fut = s < 0;
  const w = a < 90 ? `${Math.round(a)} s` : a < 5400 ? `${Math.round(a / 60)} min` : a < 172800 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} days`;
  return fut ? `in ${w}` : `${w} ago`;
}

