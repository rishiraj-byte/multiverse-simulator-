import { useEffect, useMemo, useState, useSyncExternalStore, type ChangeEvent, type KeyboardEvent } from 'react';
import type { Engine, SearchHit, Isolation } from '@/engine/Engine';
import type { PhysicsParams } from '@/sim/physics';
import { dataStore } from '@/data/store';
import { SOURCES, CATEGORY_LABEL, type Category } from '@/data/layers';
import { fmtLy } from '@/engine/views/MapView';
import { Btn, Section, ToggleRow } from './primitives';

const useData = () => useSyncExternalStore((f: () => void) => dataStore.subscribe(f), () => dataStore.version);

const QUICK: { id: string; label: string }[] = [
  { id: 'cat:milkyway', label: 'Milky Way' }, { id: 'cat:sgra', label: 'Sagittarius A*' }, { id: 'cat:m31', label: 'Andromeda' },
  { id: 'cat:localgroup', label: 'Local Group' }, { id: 'cat:virgo', label: 'Virgo Cluster' }, { id: 'cat:laniakea', label: 'Laniakea' },
  { id: 'cat:shapley', label: 'Shapley' }, { id: 'cat:bootes', label: 'Boötes Void' }, { id: 'cat:trappist1', label: 'TRAPPIST-1' },
  { id: 'cat:proxima', label: 'Proxima Cen' }, { id: 'cat:betelgeuse', label: 'Betelgeuse' }, { id: 'cat:orion-neb', label: 'Orion Nebula' },
  { id: 'cat:cygx1', label: 'Cygnus X-1' }, { id: 'cat:ton618', label: 'TON 618' }, { id: 'cat:jades14', label: 'JADES-GS-z14-0' },
  { id: 'sol:jupiter', label: 'Jupiter' },
];
const CATS = Object.keys(CATEGORY_LABEL) as Category[];

function IsolationBar({ iso, engine }: { iso: Isolation | null; engine: Engine | null }) {
  if (!iso) return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-[#ffc46a]/40 bg-[#ffc46a]/10 px-3 py-2" role="status">
      <span className="min-w-0 text-[12px] text-[#ffe2b0]">Showing only: <b className="font-semibold">{iso.label}</b></span>
      <Btn onClick={() => engine?.showAll()}>Show everything</Btn>
    </div>
  );
}

function HitList({ hits, engine }: { hits: SearchHit[]; engine: Engine | null }) {
  if (!hits.length) return null;
  return (
    <ul className="max-h-[34vh] space-y-1 overflow-y-auto pr-1">
      {hits.map((h) => (
        <li key={h.id} className="flex items-center gap-1">
          <button type="button" onClick={() => engine?.focusObject(h.id)}
            className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[#8642ff]/15">
            <span className="block truncate text-[12.5px] text-[#f1e9dd]">{h.name}</span>
            <span className="block truncate font-hud text-[11px] text-[#c4bef0]">{h.kind} · {fmtLy(h.distLy)}{h.group ? ` · ${h.group}` : ''}</span>
          </button>
          <button type="button" onClick={() => engine?.showOnly(h.id)} title={`Show only ${h.name}`}
            className="shrink-0 rounded-md border border-[#9a92d9]/25 px-2 py-1 text-[11px] text-[#e2ddfb] hover:border-[#8642ff]/70">Only</button>
        </li>
      ))}
    </ul>
  );
}

export function ExplorePanel({ engine, toast }: { engine: Engine | null; toast: (m: string) => void }) {
  const ver = useData();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [cat, setCat] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const t = setTimeout(() => setDq(q), 220); return () => clearTimeout(t); }, [q]);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 700); return () => clearInterval(t); }, []);
  const hits = useMemo(() => (engine && dq.trim() ? engine.mapSearch(dq) : []), [engine, dq, ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => (engine && cat ? engine.mapBrowse(cat) : []), [engine, cat, ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const iso = engine?.mapIsolation() ?? null;
  const loadedCats = new Set([...dataStore.layers.values()].map((L) => L.category));

  const lookup = async () => {
    if (!engine || !q.trim()) return;
    setBusy(true);
    try {
      const l = await engine.lookupName(q.trim());
      if (!l) toast(`SIMBAD doesn’t know “${q.trim()}”. Try another name (e.g. “M 51”, “HD 209458”, “NGC 4889”).`);
      else if (!isFinite(l.distLy)) toast(`${l.name} found, but it has no measured distance — it can’t be placed in 3-D.`);
      else toast(`${l.name}: ${fmtLy(l.distLy)} (${l.method})`);
    } catch (e) { toast(`Lookup failed: ${(e as Error).message}`); }
    setBusy(false);
  };

  return (
    <div className="space-y-5">
      <IsolationBar iso={iso} engine={engine} />
      <Section title="Find anything" hint="Searches every name on the map and in loaded catalogues. Not here? Look it up live in SIMBAD (millions of objects).">
        <input type="search" value={q} placeholder="Andromeda, TRAPPIST-1 b, Sgr A*, Laniakea, M 87…"
          onChange={(e: ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { if (hits[0]) engine?.focusObject(hits[0].id); else void lookup(); } }}
          aria-label="Search objects"
          className="w-full rounded-lg border border-[#9a92d9]/30 bg-[#050a21] px-3 py-2 text-[13px] text-[#f1e9dd] outline-none placeholder:text-[#c4bef0]/50 focus:border-[#8642ff]" />
        <HitList hits={hits} engine={engine} />
        {q.trim() && (
          <Btn className="w-full" onClick={() => void lookup()} disabled={busy}>{busy ? 'Asking SIMBAD…' : `Look up “${q.trim()}” in SIMBAD`}</Btn>
        )}
      </Section>

      <Section title="Famous places" hint="Click to fly there. “Only” hides the rest of the universe.">
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((x) => (
            <span key={x.id} className="flex overflow-hidden rounded-full border border-[#9a92d9]/25">
              <button type="button" onClick={() => engine?.focusObject(x.id)} className="px-2.5 py-1 text-[12px] text-[#e6e6e1] hover:bg-[#8642ff]/15">{x.label}</button>
              <button type="button" onClick={() => engine?.showOnly(x.id)} title={`Show only ${x.label}`} className="border-l border-[#9a92d9]/25 px-2 py-1 text-[11px] text-[#c4bef0] hover:bg-[#8642ff]/15 hover:text-white">only</button>
            </span>
          ))}
        </div>
      </Section>

      <Section title="Browse by kind" hint="Lists named objects, nearest first. “Show only all …” keeps just that kind across the whole universe.">
        <div className="flex flex-wrap gap-1.5">
          {CATS.map((c) => (
            <button key={c} type="button" onClick={() => setCat(cat === c ? null : c)} aria-pressed={cat === c}
              className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${cat === c ? 'border-[#8642ff] bg-[#8642ff]/30 text-white' : 'border-[#9a92d9]/25 text-[#e2ddfb] hover:border-[#8642ff]/60'} ${loadedCats.has(c) ? '' : 'opacity-70'}`}>
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
        {cat && (
          <div className="space-y-2">
            <Btn tone="primary" className="w-full" onClick={() => engine?.showCategory(cat)}>Show only all {CATEGORY_LABEL[cat].toLowerCase()}</Btn>
            {list.length ? <HitList hits={list} engine={engine} /> : (
              <p className="text-[12px] text-[#c4bef0]">Nothing named here yet. Load the matching catalogue in the <b>Data</b> tab.</p>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

export function DataPanel({ engine, physics: p, setPhysics }: { engine: Engine | null; physics: PhysicsParams; setPhysics: (p: Partial<PhysicsParams>) => void }) {
  useData();
  const cosmo = () => engine?.cosmoParams() ?? { H0: p.H0, omegaM: p.omegaM, omegaL: p.omegaL, gMult: p.gMult };
  const loading = SOURCES.some((s) => dataStore.state.get(s.key)?.status === 'loading');
  const total = [...dataStore.layers.values()].filter((L) => !L.simulated).reduce((a, L) => a + L.n, 0);
  return (
    <div className="space-y-5">
      <Section title="Real universe data" hint={`Downloaded straight from the observatories’ archives into your browser, then saved on this computer. ${total.toLocaleString('en-US')} real objects loaded.`}>
        <Btn tone="primary" className="w-full" disabled={loading} onClick={() => void dataStore.loadRecommended(cosmo())}>
          {loading ? 'Loading…' : 'Load recommended (≈ 70 MB, 2–5 min first time)'}
        </Btn>
        <ToggleRow label="Show real catalogues" checked={p.mapReal} onChange={(v) => setPhysics({ mapReal: v })} />
        <ToggleRow label="Show modelled dark matter, gas, dark energy" checked={p.mapSimulated} onChange={(v) => setPhysics({ mapSimulated: v })} />
        <ToggleRow label="Show motion arrows (CMB dipole, dark flow)" checked={p.mapFlows} onChange={(v) => setPhysics({ mapFlows: v })} />
      </Section>
      <Section title="Catalogues" hint="Load in list order for best de-duplication (HYG before Gaia; nearby galaxies before Cosmicflows-4 before 2MRS). MODEL = simulated from real parameters, not observed point by point.">
        <ul className="space-y-2.5">
          {SOURCES.map((s) => {
            const st = dataStore.state.get(s.key) ?? { status: 'idle' as const };
            const L = dataStore.layers.get(s.key);
            return (
              <li key={s.key} className="rounded-lg border border-[#9a92d9]/20 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12.5px] text-[#f1e9dd]">
                      {s.title}
                      {s.simulated && <span className="ml-1.5 rounded bg-[#ffc46a]/20 px-1 font-hud text-[10.5px] text-[#ffc46a]">MODEL</span>}
                      {s.recommended && !s.simulated && <span className="ml-1.5 font-hud text-[10.5px] text-[#5fe0a0]">★</span>}
                    </div>
                    <p className="text-[11.5px] leading-snug text-[#c4bef0]">{s.what} · {s.size}</p>
                  </div>
                  {st.status === 'loading'
                    ? <Btn onClick={() => dataStore.cancel(s.key)}>Stop</Btn>
                    : L
                      ? <Btn onClick={() => (s.simulated ? dataStore.unload(s.key) : void dataStore.forget(s.key))} title="Remove from map and delete the saved copy">Remove</Btn>
                      : <Btn tone="primary" onClick={() => void dataStore.load(s.key, cosmo(), !!s.simulated)}>{dataStore.cachedKeys.has(s.key) ? 'Load (saved)' : 'Load'}</Btn>}
                </div>
                {st.msg && (
                  <p className={`mt-1 font-hud text-[11px] ${st.status === 'error' ? 'text-[#ff8a8a]' : st.status === 'ready' ? 'text-[#5fe0a0]' : 'text-[#ffe2b0]'}`}>{st.msg}</p>
                )}
                {st.status === 'loading' && st.frac !== undefined && (
                  <div className="mt-1 h-1 overflow-hidden rounded bg-[#9a92d9]/20"><div className="h-full bg-[#8642ff]" style={{ width: `${Math.round(st.frac * 100)}%` }} /></div>
                )}
                {L && <p className="mt-1 text-[11px] leading-snug text-[#c4bef0]/80">Distances: {L.distMethod}. Source: {L.source}</p>}
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title="What can’t fit" hint="Gaia DR3 has 1.8 billion stars — far more than a browser can hold (a few million), so stars come in brightness tiers. Most of the observable universe’s hundreds of billions of galaxies have never been individually catalogued: real galaxy catalogues reach a few hundred thousand objects here; beyond them the cosmic web is procedural." >
        <span />
      </Section>
    </div>
  );
}
