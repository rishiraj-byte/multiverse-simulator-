// Import the NASA Exoplanet Archive "Planetary Systems Composite Parameters"
// table (PSCompPars) exported as CSV: https://exoplanetarchive.ipac.caltech.edu
// Columns used (any may be blank): pl_name, hostname, pl_orbsmax [AU], pl_orbper [d],
// pl_bmasse [M⊕], pl_rade [R⊕], pl_orbeccen, st_mass [M☉], st_teff [K], st_rad [R☉],
// st_lum [log10 L☉], sy_dist [pc]. Missing values are estimated when a system is built.
import type { CatalogHost } from './systems';

/** RFC-4180-ish CSV line splitter (handles quoted fields with commas). */
function splitCSV(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export interface CatalogResult { hosts: CatalogHost[]; planets: number; skipped: number; error?: string }

export function parseExoplanetCSV(text: string): CatalogResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  if (lines.length < 2) return { hosts: [], planets: 0, skipped: 0, error: 'The file has no data rows.' };
  const head = splitCSV(lines[0]).map((h) => h.trim());
  const col = (name: string) => head.indexOf(name);
  const iName = col('pl_name'), iHost = col('hostname');
  if (iName < 0 || iHost < 0) return { hosts: [], planets: 0, skipped: 0, error: 'Missing pl_name / hostname columns — export the PSCompPars table as CSV.' };
  const ix = {
    a: col('pl_orbsmax'), per: col('pl_orbper'), m: col('pl_bmasse'), r: col('pl_rade'), e: col('pl_orbeccen'),
    sm: col('st_mass'), teff: col('st_teff'), sr: col('st_rad'), lum: col('st_lum'), dist: col('sy_dist'),
  };
  const num = (row: string[], i: number) => {
    if (i < 0) return undefined;
    const v = parseFloat(row[i]);
    return Number.isFinite(v) ? v : undefined;
  };
  const hosts = new Map<string, CatalogHost>();
  let planets = 0, skipped = 0;
  for (let li = 1; li < lines.length; li++) {
    const row = splitCSV(lines[li]);
    const host = row[iHost]?.trim(), name = row[iName]?.trim();
    if (!host || !name) { skipped++; continue; }
    let h = hosts.get(host);
    if (!h) {
      h = { name: host, starMass: num(row, ix.sm), teff: num(row, ix.teff), starRad: num(row, ix.sr), lumLog: num(row, ix.lum), distPc: num(row, ix.dist), planets: [] };
      hosts.set(host, h);
    }
    const p = { name, a: num(row, ix.a), periodDays: num(row, ix.per), massE: num(row, ix.m), radE: num(row, ix.r), ecc: num(row, ix.e) };
    if (p.a === undefined && p.periodDays === undefined) { skipped++; continue; }
    h.planets.push(p);
    planets++;
  }
  return { hosts: [...hosts.values()].filter((h) => h.planets.length).sort((x, y) => (x.distPc ?? 1e9) - (y.distPc ?? 1e9)), planets, skipped };
}
