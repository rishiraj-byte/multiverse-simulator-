// Browser-side access to public astronomy archives. All of these allow cross-origin
// requests from a web page (verified Oct 2026 for the main sites; mirrors are reached through
// the desktop app's header hook): SIMBAD TAP (CDS), VizieR ASU (CDS),
// GAVO Heidelberg TAP (Gaia DR3 mirror), GitHub raw (HYG database).

export type Progress = (msg: string, frac?: number) => void;

/** Fetch text with download progress. */
export async function fetchText(url: string, onProgress?: Progress, label = 'Downloading', init?: RequestInit): Promise<string> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} from ${new URL(url).host}`);
  const total = Number(r.headers.get('content-length')) || 0;
  if (!r.body || !onProgress) return r.text();
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(`${label} ${(got / 1e6).toFixed(1)} MB${total ? ` / ${(total / 1e6).toFixed(1)} MB` : ''}`, total ? got / total : undefined);
  }
  const all = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return new TextDecoder().decode(all);
}

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes). Returns header + rows of strings. */
export function parseCSV(text: string): { header: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (q) {
      if (c === 34) { if (text.charCodeAt(i + 1) === 34) { field += '"'; i++; } else q = false; }
      else field += text[i];
    } else if (c === 34) q = true;
    else if (c === 44) { row.push(field); field = ''; }
    else if (c === 10 || c === 13) {
      if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += text[i];
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = (rows.shift() ?? []).map((h) => h.trim());
  return { header, rows };
}

// CDS (Strasbourg) runs SIMBAD and VizieR; official mirrors carry the same data. If the main
// site is unreachable from the user's network, the first mirror that answers a tiny test
// query is used for the rest of the session.
const VIZIER_HOSTS = ['vizier.cds.unistra.fr', 'vizier.cfa.harvard.edu', 'vizier.iucaa.in', 'vizier.nao.ac.jp', 'vizier.idia.ac.za', 'vizier.china-vo.org'];
const SIMBAD_HOSTS = ['simbad.cds.unistra.fr', 'simbad.harvard.edu', 'simbad.idia.ac.za'];
const PROBE: Record<string, string> = {
  vizier: '/viz-bin/asu-tsv?-source=I/239/hip_main&-out=HIP&-out.max=1',
  simbad: '/simbad/sim-tap/sync?request=doQuery&lang=adql&format=csv&query=' + encodeURIComponent('SELECT TOP 1 oid FROM basic'),
};
const chosen = new Map<string, Promise<string>>();
const failed = new Set<string>();

async function choose(group: string, hosts: string[]): Promise<string> {
  const live = hosts.filter((h) => !failed.has(h));
  const ok = live.map((h) => fetch(`https://${h}${PROBE[group]}`, { signal: AbortSignal.timeout(12000) }).then((r) => r.ok, () => false));
  for (let i = 0; i < live.length; i++) if (await ok[i]) return live[i]; // keep the preferred order
  throw new Error(`${group === 'vizier' ? 'VizieR' : 'SIMBAD'} (CDS) and its mirrors are unreachable from this network right now — try again later`);
}
function mirror(group: 'vizier' | 'simbad'): Promise<string> {
  let p = chosen.get(group);
  if (!p) {
    p = choose(group, group === 'vizier' ? VIZIER_HOSTS : SIMBAD_HOSTS);
    chosen.set(group, p);
    p.catch(() => chosen.delete(group));
  }
  return p;
}
/** Run a request against the chosen mirror; on a network failure, drop that mirror and try the next once. */
async function viaMirror<T>(group: 'vizier' | 'simbad', run: (host: string) => Promise<T>): Promise<T> {
  const host = await mirror(group);
  try { return await run(host); } catch (e) {
    if (!(e instanceof TypeError)) throw e; // HTTP errors are real answers; TypeError = could not connect
    failed.add(host); chosen.delete(group);
    return run(await mirror(group));
  }
}
/** VizieR ASU-TSV rows as records. Adds decimal J2000 _RAJ2000/_DEJ2000 columns. */
export async function vizier(source: string, cols: string[], constraints: Record<string, string> = {}, onProgress?: Progress): Promise<Record<string, string>[]> {
  const params = new URLSearchParams({ '-source': source, '-out': cols.join(','), '-out.add': '_RAJ,_DEJ', '-oc.form': 'dec', '-out.max': 'unlimited' });
  for (const [k, v] of Object.entries(constraints)) params.set(k, v);
  const get = () => viaMirror('vizier', (h) => fetchText(`https://${h}/viz-bin/asu-tsv?${params}`, onProgress, `VizieR ${source}`));
  let text = await get();
  let lines = text.split('\n').filter((l) => l && !l.startsWith('#'));
  if (lines.length < 3) {
    // a column name not in this catalogue makes VizieR refuse the query: retry asking for every column
    params.delete('-out'); params.set('-out.all', '1');
    text = await get();
    lines = text.split('\n').filter((l) => l && !l.startsWith('#'));
  }
  if (lines.length < 3) throw new Error(`VizieR returned no rows for ${source}`);
  // a catalogue can hold several tables, each with its own header / units / dashes lines
  const isDashes = (l: string | undefined) => !!l && /^[-\t ]+$/.test(l) && l.includes('-');
  const tables: { header: string[]; rows: string[][] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isDashes(lines[i + 2])) { tables.push({ header: lines[i].split('\t').map((h) => h.trim()), rows: [] }); i += 2; continue; }
    const t = tables[tables.length - 1];
    if (t) t.rows.push(lines[i].split('\t'));
  }
  // use the tables that carry every requested column (falls back to any table with the first column)
  let use = tables.filter((t) => cols.every((c) => t.header.includes(c)));
  if (!use.length) use = tables.filter((t) => t.header.includes(cols[0]));
  const out: Record<string, string>[] = [];
  for (const t of use) for (const f of t.rows) {
    if (f.length < t.header.length - 1) continue;
    const rec: Record<string, string> = {};
    t.header.forEach((h, k) => (rec[h] = (f[k] ?? '').trim()));
    out.push(rec);
  }
  return out;
}

/** SIMBAD TAP (synchronous ADQL). */
export async function simbad(adql: string, onProgress?: Progress): Promise<Record<string, string>[]> {
  const q = '/simbad/sim-tap/sync?request=doQuery&lang=adql&format=csv&MAXREC=2000000&query=' + encodeURIComponent(adql);
  const { header, rows } = parseCSV(await viaMirror('simbad', (h) => fetchText(`https://${h}${q}`, onProgress, h.includes('cds') ? 'SIMBAD' : `SIMBAD (mirror ${h})`)));
  return rows.map((r) => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ''])));
}

/** GAVO Heidelberg TAP, asynchronous job (long queries, e.g. Gaia DR3). */
export async function gavoAsync(adql: string, maxrec: number, onProgress?: Progress, signal?: AbortSignal): Promise<Record<string, string>[]> {
  const base = 'https://dc.zah.uni-heidelberg.de/tap/async';
  const r = await fetch(base, { method: 'POST', body: new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', MAXREC: String(maxrec), QUERY: adql }), signal });
  if (!r.ok) throw new Error(`Gaia archive refused the job (${r.status})`);
  const job = r.url.replace(/\/$/, '');
  await fetch(`${job}/phase`, { method: 'POST', body: new URLSearchParams({ PHASE: 'RUN' }), signal });
  const t0 = performance.now();
  for (;;) {
    await new Promise((res) => setTimeout(res, 2500));
    if (signal?.aborted) throw new Error('Cancelled');
    const phase = (await (await fetch(`${job}/phase`, { signal })).text()).trim();
    onProgress?.(`Gaia archive is running the query… ${Math.round((performance.now() - t0) / 1000)} s (${phase.toLowerCase()})`);
    if (phase === 'COMPLETED') break;
    if (phase === 'ERROR' || phase === 'ABORTED') throw new Error(`Gaia query ${phase.toLowerCase()}: ${(await (await fetch(`${job}/error`)).text()).slice(0, 200)}`);
    if (performance.now() - t0 > 15 * 60 * 1000) throw new Error('Gaia query took longer than 15 minutes');
  }
  const { header, rows } = parseCSV(await fetchText(`${job}/results/result`, onProgress, 'Gaia DR3', { signal }));
  return rows.map((row) => Object.fromEntries(header.map((h, k) => [h, row[k] ?? ''])));
}

export const num = (s: string | undefined): number => {
  if (s === undefined) return NaN;
  const t = s.trim();
  return t === '' ? NaN : Number(t);
};
