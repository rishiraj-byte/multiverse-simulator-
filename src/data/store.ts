// Shared store of loaded catalogue layers. One copy for every parallel universe; each
// universe's map draws the same data (re-scaling redshift distances to its own cosmology).
// Downloads are cached in the browser (IndexedDB) so they load instantly next time.

import { SOURCES, resolveSimbad, lookupLayers, type RealLayer, type SourceDef, type Lookup } from './layers';
import type { CosmoParams } from '../sim/cosmology';

export type LoadState = { status: 'idle' | 'loading' | 'ready' | 'error'; msg?: string; frac?: number; cached?: boolean };

const DB = 'cosmos-catalogues', STORE = 'layers', VERSION = 2;

function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => { const db = r.result; if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE); db.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idb<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode);
    const q = f(tx.objectStore(STORE));
    q.onsuccess = () => res(q.result as T);
    q.onerror = () => rej(q.error);
  });
}
const cacheGet = (k: string) => idb<RealLayer | undefined>('readonly', (s) => s.get(k)).catch(() => undefined);
const cachePut = (k: string, v: RealLayer) => idb<void>('readwrite', (s) => s.put(v, k)).catch(() => undefined);
const cacheDel = (k: string) => idb<void>('readwrite', (s) => s.delete(k)).catch(() => undefined);
const cacheKeys = () => idb<IDBValidKey[]>('readonly', (s) => s.getAllKeys()).catch(() => [] as IDBValidKey[]);

class DataStore {
  readonly layers = new Map<string, RealLayer>();
  readonly state = new Map<string, LoadState>();
  private subs = new Set<() => void>();
  private aborts = new Map<string, AbortController>();
  version = 0;
  cachedKeys = new Set<string>();

  constructor() {
    for (const s of SOURCES) this.state.set(s.key, { status: 'idle' });
    if (typeof indexedDB !== 'undefined') void cacheKeys().then((ks) => { this.cachedKeys = new Set(ks.map(String)); this.emit(); });
  }

  subscribe(f: () => void) { this.subs.add(f); return () => { this.subs.delete(f); }; }
  private emit() { this.version++; for (const f of this.subs) f(); }
  private set(key: string, s: LoadState) { this.state.set(key, s); this.emit(); }

  source(key: string): SourceDef | undefined { return SOURCES.find((s) => s.key === key); }

  async load(key: string, cosmo: CosmoParams, force = false): Promise<RealLayer | null> {
    const def = this.source(key);
    if (!def) return null;
    const cur = this.state.get(key);
    if (cur?.status === 'loading') return null;
    if (!force && this.layers.has(key)) return this.layers.get(key)!;
    // simulated layers depend on what else is loaded → always regenerate
    if (!force && !def.simulated) {
      const c = await cacheGet(key);
      if (c && c.n > 0 && (c.schema ?? 1) === (def.schema ?? 1)) { this.layers.set(key, c); this.set(key, { status: 'ready', cached: true, msg: `${c.n.toLocaleString('en-US')} objects (saved copy from ${c.loadedAt.slice(0, 10)})` }); return c; }
    }
    const ac = new AbortController();
    this.aborts.set(key, ac);
    this.set(key, { status: 'loading', msg: 'Contacting archive…' });
    try {
      const layer = await def.load({ cosmo, signal: ac.signal, layers: this.layers, progress: (msg, frac) => this.set(key, { status: 'loading', msg, frac }) });
      this.layers.set(key, layer);
      if (!def.simulated) { await cachePut(key, layer); this.cachedKeys.add(key); }
      this.set(key, { status: 'ready', msg: `${layer.n.toLocaleString('en-US')} objects${layer.skipped ? ` · ${layer.skipped.toLocaleString('en-US')} without a distance or duplicated (not placed)` : ''}` });
      return layer;
    } catch (e) {
      this.set(key, { status: 'error', msg: (e as Error).message || String(e) });
      return null;
    } finally { this.aborts.delete(key); }
  }

  lookups: Lookup[] = [];
  /** Look a name up in SIMBAD and place it on the map (kept for this session and in every universe). */
  async lookup(name: string, cosmo: CosmoParams): Promise<Lookup | null> {
    const l = await resolveSimbad(name, cosmo);
    if (!l || !isFinite(l.distLy)) return l;
    if (!this.lookups.some((x) => x.name === l.name)) {
      this.lookups.push(l);
      for (const k of [...this.layers.keys()]) if (k.startsWith('lookup:')) this.layers.delete(k);
      for (const L of lookupLayers(this.lookups)) this.layers.set(L.key, L);
      this.emit();
    }
    return l;
  }

  cancel(key: string) { this.aborts.get(key)?.abort(); }

  unload(key: string) { this.layers.delete(key); this.set(key, { status: 'idle' }); }

  async forget(key: string) { await cacheDel(key); this.cachedKeys.delete(key); this.unload(key); }

  /** Load the recommended set in a sensible order (galaxies before the dark-matter halos that surround them). */
  async loadRecommended(cosmo: CosmoParams) {
    // three chains in parallel; order inside a chain matters for de-duplication (HYG before Gaia; UNGC → CF4 → 2MRS)
    const chains = [['hyg', 'gaia9', 'yso'], ['ungc', 'cf4', '2mrs', 'abell', 'scg'], ['nasaexo', 'bh', 'psr', 'oc', 'gc', 'neb', 'qso']];
    await Promise.all(chains.map(async (c) => { for (const k of c) { const L = await this.load(k, cosmo); if (!L && k === 'nasaexo') await this.load('exo', cosmo); } }));
    for (const s of SOURCES.filter((x) => x.recommended && x.simulated)) await this.load(s.key, cosmo, true);
  }

  /** Re-load cached layers silently at start-up (no network). */
  async restoreCached() {
    const ks = await cacheKeys();
    for (const k of ks.map(String)) {
      if (this.layers.has(k) || !this.source(k)) continue;
      const c = await cacheGet(k);
      if (c && c.n > 0 && (c.schema ?? 1) === (this.source(k)?.schema ?? 1)) { this.layers.set(k, c); this.state.set(k, { status: 'ready', cached: true, msg: `${c.n.toLocaleString('en-US')} objects (saved copy from ${c.loadedAt.slice(0, 10)})` }); }
      else { this.cachedKeys.delete(k); void cacheDel(k); } // saved in an older format: download again
    }
    this.emit();
  }
}

export const dataStore = new DataStore();
