import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Engine } from '@/engine/Engine';
import type { PhysicsParams } from '@/sim/physics';
import { liveStore, FEEDS, ago, placeable, type LiveKind } from '@/data/live';
import { dataStore } from '@/data/store';
import { Btn, Section, ToggleRow } from './primitives';

const useLive = () => useSyncExternalStore((f: () => void) => liveStore.subscribe(f), () => liveStore.version);
const useData = () => useSyncExternalStore((f: () => void) => dataStore.subscribe(f), () => dataStore.version);

const KIND_DOT: Record<LiveKind, string> = { flare: 'bg-[#ffe08a]', iss: 'bg-white', spacecraft: 'bg-[#7fffa0]', neo: 'bg-[#ffb36b]', supernova: 'bg-[#ff6a4a]', gw: 'bg-[#d08cff]' };

/** "What is happening right now": real-time feeds, refreshed automatically. */
export function NowPanel({ engine, live, physics: p, setPhysics }: { engine: Engine | null; live: boolean; physics: PhysicsParams; setPhysics: (p: Partial<PhysicsParams>) => void }) {
  useLive();
  useData();
  const [, tick] = useState(0);
  const [open, setOpen] = useState<Partial<Record<LiveKind, boolean>>>({});
  const [sunT, setSunT] = useState(() => Math.floor(Date.now() / 9e5));
  useEffect(() => { const t = setInterval(() => { tick((x) => x + 1); setSunT(Math.floor(Date.now() / 9e5)); }, 1000); return () => clearInterval(t); }, []);
  const now = new Date();
  const realCount = [...dataStore.layers.values()].filter((L) => !L.simulated).reduce((a, L) => a + L.n, 0);
  const loading = [...dataStore.state.values()].some((s) => s.status === 'loading');
  const go = (id: string) => engine?.focusObject(id === 'sun' ? 'sol:sun' : `live:${id}`);

  return (
    <div className="space-y-5">
      <Section title={live ? 'The universe right now' : 'Live data in this sandbox'}
        hint={live
          ? 'Locked to the real clock and to measured data only. Planets, spacecraft and asteroids are where they are this second; stars have moved with their measured motion. Light takes time to reach us, so events are what observatories have detected — not what is happening out there at this instant.'
          : 'The same real-time feeds, shown on your editable universe. Spacecraft and asteroid positions only appear when this universe’s date is today.'}>
        <div className="rounded-lg border border-[#5fe0a0]/30 bg-[#5fe0a0]/10 px-3 py-2 font-hud text-[12px] text-[#c9ffe2]">
          {now.toISOString().slice(0, 19).replace('T', ' ')} UTC
        </div>
        {!live && <ToggleRow label="Show live events on the map" checked={p.mapLive} onChange={(v) => setPhysics({ mapLive: v })} />}
        {loading && realCount > 0 && (
          <p className="font-hud text-[11.5px] text-[#ffe2b0]">Loading catalogues… {realCount.toLocaleString('en-US')} real objects so far (see Data for each one).</p>
        )}
        {realCount === 0 && (
          <div className="space-y-2 rounded-lg border border-[#ffc46a]/40 bg-[#ffc46a]/10 p-3">
            <p className="text-[12px] text-[#ffe2b0]">No real catalogues loaded yet — the map only shows the Solar System and landmarks.</p>
            <Btn tone="primary" className="w-full" disabled={loading} onClick={() => void dataStore.loadRecommended(engine?.cosmoParams() ?? { H0: 67.4, omegaM: 0.315, omegaL: 0.685 })}>
              {loading ? 'Loading the real universe…' : 'Load the real universe (≈ 70 MB, once)'}
            </Btn>
          </div>
        )}
      </Section>

      <Section title="The Sun now" hint="Extreme-ultraviolet image from NASA’s Solar Dynamics Observatory (updates every ~15 min), plus X-ray flare level from GOES.">
        <img src={`https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0171.jpg?t=${sunT}`} alt="The Sun right now in extreme ultraviolet (SDO AIA 171 Å)"
          className="aspect-square w-full rounded-lg border border-[#9a92d9]/20 bg-black object-cover" loading="lazy" />
        <div className="grid grid-cols-2 gap-2 font-hud text-[12px]">
          <div className="rounded-md border border-[#9a92d9]/20 p-2"><div className="text-[#c4bef0]">X-ray level</div><div className="text-[#f1e9dd]">{liveStore.solar.xray ?? '—'}</div></div>
          <div className="rounded-md border border-[#9a92d9]/20 p-2"><div className="text-[#c4bef0]">Geomagnetic Kp</div><div className="text-[#f1e9dd]">{liveStore.solar.kp !== undefined ? liveStore.solar.kp.toFixed(1) : '—'}</div></div>
        </div>
      </Section>

      {FEEDS.map((f) => {
        const st = liveStore.state.get(f.key) ?? { status: 'idle' as const };
        const list = liveStore.list(f.key);
        const shown = open[f.key] ? list : list.slice(0, f.key === 'flare' ? 4 : 6);
        return (
          <Section key={f.key} title={f.title} hint={f.what}>
            <div className="flex items-center justify-between gap-2 font-hud text-[11px]">
              <span className={st.status === 'error' ? 'text-[#ff8a8a]' : st.status === 'ok' ? 'text-[#5fe0a0]' : 'text-[#ffe2b0]'}>
                {st.status === 'ok' ? `● live · updated ${ago(st.updated ?? Date.now())}` : st.status === 'error' ? st.msg : st.status === 'loading' ? 'loading…' : 'waiting'}
              </span>
              <button type="button" onClick={() => void liveStore.refresh(f.key)} className="text-[#c4bef0] hover:text-white">refresh</button>
            </div>
            {st.note && <p className="text-[11.5px] text-[#ffe2b0]">{st.note}</p>}
            {list.length === 0 && st.status === 'ok' && <p className="text-[12px] text-[#c4bef0]">Nothing reported right now.</p>}
            <ul className="space-y-1">
              {shown.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => go(e.kind === 'flare' ? 'sun' : e.id)} disabled={!placeable(e)} title={placeable(e) ? 'Fly there' : e.sky?.note}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[#8642ff]/15 disabled:cursor-default disabled:hover:bg-transparent">
                    <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${KIND_DOT[e.kind]}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-[#f1e9dd]">{e.name}</span>
                      <span className="block truncate font-hud text-[11px] text-[#c4bef0]">{e.type} · {e.kind === 'spacecraft' || e.kind === 'iss' ? 'position now' : ago(e.time)}{placeable(e) ? '' : ' · not on map yet'}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {list.length > shown.length && <button type="button" onClick={() => setOpen({ ...open, [f.key]: true })} className="text-[12px] text-[#a98bff] hover:text-white">Show all {list.length}</button>}
          </Section>
        );
      })}
    </div>
  );
}
