import { useState } from 'react';
import type { Engine, WorldContext, SelectionInfo, LevelStats } from '@/engine/Engine';
import type { PhysicsParams } from '@/sim/physics';
import { panelCls } from './hud/primitives';
import { SimPanel, BuildPanel, BodiesPanel, SavesPanel, ViewPanel } from './hud/Panels';
import { SelectionCard } from './hud/SelectionCard';
import { ExplorePanel, DataPanel } from './hud/Explore';
import { NowPanel } from './hud/Now';

type Tab = 'now' | 'explore' | 'data' | 'sim' | 'build' | 'bodies' | 'saves' | 'view';
const TABS: { id: Tab; label: string }[] = [
  { id: 'now', label: 'Now' }, { id: 'explore', label: 'Explore' }, { id: 'data', label: 'Data' }, { id: 'sim', label: 'Physics' }, { id: 'build', label: 'Build' }, { id: 'bodies', label: 'Bodies' },
  { id: 'saves', label: 'Saves' }, { id: 'view', label: 'View' },
];

const LEVEL_HINT = {
  map: 'Drag to look · scroll to zoom from planets to the edge of the universe · WASD to travel · click anything',
  universe: 'Click any galaxy · double-click to enter',
  galaxy: 'Click any star or the nucleus · double-click to visit',
  system: 'Click a body · double-click a planet to orbit it',
  planet: 'Orbiting a planet',
};

export interface Multiverse {
  list: { id: number; name: string }[];
  focus: number;
  onFocus: (id: number) => void;
  onFork: () => void;
  onClose: (id: number) => void;
  onLab: () => void;
  onCompare: () => void;
  compareOpen: boolean;
  view: 'live' | 'sandbox';
  onView: (v: 'live' | 'sandbox') => void;
}

export interface HudProps {
  engine: Engine | null;
  ctx: WorldContext;
  selected: SelectionInfo | null;
  stats: LevelStats | null;
  physics: PhysicsParams;
  warping: boolean;
  placing: boolean;
  following: boolean;
  universeName: string;
  multiverse: Multiverse;
  setPhysics: (p: Partial<PhysicsParams>) => void;
  toast: (m: string) => void;
  live?: boolean;
}

function fmtWarp(w: number) { return w < 10 ? w.toFixed(1) : String(Math.round(w)); }

export function Hud(p: HudProps) {
  const [open, setOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  const [tab, setTab] = useState<Tab>(() => (p.live ? 'now' : 'explore'));
  const { ctx, physics: ph, multiverse: mv } = p;
  const clock = p.stats?.rows[0];
  // the Bodies list only exists inside a star system; elsewhere fall back to Explore
  const inSystem = ctx.level === 'system' || ctx.level === 'planet';
  const live = !!p.live;
  const visibleTabs = TABS.filter((t) => (t.id !== 'bodies' || inSystem) && !(live && t.id === 'build')).map((t) => (live && t.id === 'sim' ? { ...t, label: 'Info' } : t));
  const shownTab: Tab = visibleTabs.some((t) => t.id === tab) ? tab : live ? 'now' : 'explore';
  const nowUtc = new Date().toISOString().slice(0, 19).replace('T', ' ');

  return (
    <>
      {/* ── header ── */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
        <div className="pointer-events-auto min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-lg font-bold tracking-[0.28em] text-[#f1e9dd] sm:text-xl">COSMOS{!live && mv.list.length > 1 && <span className="ml-2 align-middle font-hud text-[11.5px] font-normal tracking-normal text-[#a98bff]">{p.universeName}</span>}</h1>
            <div role="tablist" aria-label="Universe view" className="flex rounded-full border border-[#9a92d9]/30 bg-[#0a0521]/85 p-0.5 backdrop-blur-md">
              <button type="button" role="tab" aria-selected={live} onClick={() => mv.onView('live')}
                className={`flex min-h-[30px] items-center gap-1.5 rounded-full px-3 text-[12px] ${live ? 'bg-[#5fe0a0]/20 text-[#c9ffe2]' : 'text-[#c4bef0] hover:text-white'}`}>
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${live ? 'animate-pulse bg-[#5fe0a0]' : 'bg-[#5fe0a0]/50'}`} />Live universe
              </button>
              <button type="button" role="tab" aria-selected={!live} onClick={() => mv.onView('sandbox')}
                className={`min-h-[30px] rounded-full px-3 text-[12px] ${!live ? 'bg-[#8642ff]/35 text-[#f1e9dd]' : 'text-[#c4bef0] hover:text-white'}`}>Sandbox</button>
            </div>
          </div>
          <p className="mt-0.5 max-w-[60vw] truncate text-[12px] text-[#c4bef0]">
            {live ? 'Real time · measured data only · read-only — drag, zoom, search and select anything' : ctx.level === 'system' || ctx.level === 'planet' ? ctx.system?.subtitle : LEVEL_HINT[ctx.level]}
          </p>
          <nav aria-label="Scale" className="mt-2 flex max-w-[92vw] items-center gap-1 overflow-x-auto rounded-full border border-[#9a92d9]/25 bg-[#0a0521]/70 px-2 py-1 backdrop-blur-md">
            {ctx.crumbs.map((c, i) => {
              const current = i === ctx.crumbs.length - 1;
              return (
                <span key={c.level} className="flex shrink-0 items-center gap-1">
                  {i > 0 && <span aria-hidden className="text-[11.5px] text-[#8642ff]">›</span>}
                  <button type="button" disabled={current} aria-current={current ? 'location' : undefined}
                    onClick={() => p.engine?.goToLevel(c.level)}
                    className={`min-h-[30px] rounded-full px-2.5 text-[12px] transition-colors ${current ? 'bg-[#8642ff]/25 text-[#f1e9dd]' : 'text-[#c4bef0] hover:bg-[#8642ff]/15 hover:text-[#f1e9dd]'}`}>
                    {c.label}
                  </button>
                </span>
              );
            })}
          </nav>
        </div>
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-end gap-1.5">
          <div role="tablist" aria-label="Parallel universes" className="flex items-center gap-1 rounded-full border border-[#9a92d9]/25 bg-[#0a0521]/80 p-1 backdrop-blur-md">
            {!live && mv.list.map((u) => (
              <span key={u.id} className="flex items-center">
                <button type="button" role="tab" aria-selected={u.id === mv.focus} onClick={() => mv.onFocus(u.id)}
                  className={`min-h-[30px] rounded-full px-2.5 text-[12px] transition-colors ${u.id === mv.focus ? 'bg-[#8642ff]/35 text-[#f1e9dd]' : 'text-[#c4bef0] hover:text-[#f1e9dd]'}`}>
                  {u.name.replace('Universe ', '')}
                </button>
                {mv.list.length > 1 && u.id === mv.focus && (
                  <button type="button" onClick={() => mv.onClose(u.id)} aria-label={`Close ${u.name}`} title={`Close ${u.name}`}
                    className="h-6 w-6 rounded-full text-[12px] text-[#c4bef0] hover:text-white">✕</button>
                )}
              </span>
            ))}
            <button type="button" onClick={mv.onFork} title={live ? 'Copy the live universe into an editable sandbox' : 'Fork this universe into a parallel copy'}
              className="min-h-[30px] rounded-full px-2.5 text-[12px] text-[#e2ddfb] hover:bg-[#8642ff]/20 hover:text-white">{live ? '⑂ Copy to sandbox' : '⑂ Fork'}</button>
            {!live && mv.list.length > 1 && (
              <button type="button" onClick={mv.onCompare} aria-pressed={mv.compareOpen}
                className={`min-h-[30px] rounded-full px-2.5 text-[12px] ${mv.compareOpen ? 'bg-[#8642ff]/30 text-white' : 'text-[#e2ddfb] hover:bg-[#8642ff]/20'}`}>Compare</button>
            )}
          </div>
          {!live && <button type="button" onClick={mv.onLab}
            className="flex min-h-[40px] items-center rounded-full border border-[#9a92d9]/30 bg-[#0a0521]/80 px-4 text-[13px] text-[#e6e6e1] backdrop-blur-md transition-colors hover:border-[#8642ff]/60">
            ⚛ Lab
          </button>}
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="cosmos-panel"
            className="flex min-h-[40px] items-center gap-2 rounded-full border border-[#9a92d9]/30 bg-[#0a0521]/80 px-4 text-[13px] text-[#e6e6e1] backdrop-blur-md transition-colors hover:border-[#8642ff]/60">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${open ? 'bg-[#8642ff]' : 'bg-[#9a92d9]/50'}`} />
            {open ? 'Hide controls' : 'Controls'}
          </button>
        </div>
      </header>

      {/* ── side panel ── */}
      <aside id="cosmos-panel" aria-label="Simulation controls"
        className={`absolute z-30 transition-all duration-300 ${open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-6 opacity-0'} inset-x-3 bottom-3 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-[76px] sm:w-[360px]`}>
        <div className={`${panelCls} flex max-h-[58vh] flex-col sm:max-h-[calc(100vh-170px)]`}>
          <div role="tablist" aria-label="Panels" className="flex flex-wrap gap-1 border-b border-[#9a92d9]/15 p-2">
            {visibleTabs.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={shownTab === t.id} onClick={() => setTab(t.id)}
                className={`min-h-[32px] flex-1 rounded-md px-1.5 text-[12px] transition-colors ${shownTab === t.id ? 'bg-[#8642ff]/30 text-[#f1e9dd]' : 'text-[#c4bef0] hover:text-[#f1e9dd]'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="overflow-y-auto p-4">
            {shownTab === 'now' && <NowPanel engine={p.engine} live={live} physics={ph} setPhysics={p.setPhysics} />}
            {shownTab === 'explore' && <ExplorePanel engine={p.engine} toast={p.toast} />}
            {shownTab === 'data' && <DataPanel engine={p.engine} physics={ph} setPhysics={p.setPhysics} />}
            {shownTab === 'sim' && <SimPanel physics={ph} setPhysics={p.setPhysics} ctx={ctx} stats={p.stats} engine={p.engine} live={live} />}
            {shownTab === 'build' && <BuildPanel engine={p.engine} ctx={ctx} selected={p.selected} placing={p.placing} toast={p.toast} />}
            {shownTab === 'bodies' && <BodiesPanel engine={p.engine} stats={p.stats} selected={p.selected} />}
            {shownTab === 'saves' && <SavesPanel engine={p.engine} ctx={ctx} toast={p.toast} />}
            {shownTab === 'view' && <ViewPanel physics={ph} setPhysics={p.setPhysics} />}
          </div>
        </div>
      </aside>

      {/* ── time bar ── */}
      {live ? (
        <div className={`${panelCls} absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 ${open ? 'max-sm:hidden' : ''}`} role="status" aria-label="Live clock">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#5fe0a0]" />
          <span className="font-hud text-[12px] tracking-wide text-[#c9ffe2]">LIVE</span>
          <span className="font-hud text-[12px] tabular-nums text-[#f1e9dd]">{nowUtc} UTC</span>
        </div>
      ) : (
      <div className={`${panelCls} absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full px-2 py-1.5 ${open ? 'max-sm:hidden' : ''}`}
        role="group" aria-label="Time controls">
        <button type="button" onClick={() => p.setPhysics({ reverse: !ph.reverse })} aria-pressed={ph.reverse} title="Reverse time (\)"
          className={`h-9 w-9 rounded-full text-[13px] transition-colors ${ph.reverse ? 'bg-[#8642ff]/40 text-white' : 'text-[#c4bef0] hover:text-white'}`}>⏪</button>
        <button type="button" onClick={() => p.setPhysics({ timeWarp: Math.max(ph.timeWarp / 2, 0.1) })} aria-label="Slower" title="Slower ([)"
          className="h-9 w-9 rounded-full text-[#c4bef0] hover:text-white">−</button>
        <button type="button" onClick={() => p.setPhysics({ paused: !ph.paused })} aria-label={ph.paused ? 'Play' : 'Pause'} title="Pause (Space)"
          className="h-9 w-9 rounded-full bg-[#8642ff]/25 text-[13px] text-[#f1e9dd] hover:bg-[#8642ff]/45">{ph.paused ? '▶' : '❚❚'}</button>
        <button type="button" onClick={() => p.setPhysics({ timeWarp: Math.min(ph.timeWarp * 2, 200) })} aria-label="Faster" title="Faster (])"
          className="h-9 w-9 rounded-full text-[#c4bef0] hover:text-white">+</button>
        <div className="min-w-[96px] px-2 text-center">
          <div className="font-hud text-[12px] tabular-nums text-[#f1e9dd]">{ph.reverse ? '−' : ''}{fmtWarp(ph.timeWarp)}×</div>
          {clock && <div className="font-hud text-[11px] tabular-nums text-[#c4bef0]">{clock.v}</div>}
        </div>
      </div>
      )}

      {p.selected && (
        <SelectionCard sel={p.selected} engine={p.engine} level={ctx.level} following={p.following} onClose={() => p.engine?.select(null)} />
      )}

      {p.placing && (
        <div className={`${panelCls} absolute left-1/2 top-24 z-20 -translate-x-1/2 px-4 py-2 text-[13px] text-[#f1e9dd]`} role="status">
          Click on the orbital plane to place the body · Esc cancels
        </div>
      )}

      {/* ── mobile thrust ── */}
      <div className={`absolute bottom-20 right-4 z-20 flex-col gap-2 ${open ? 'hidden' : 'flex'} lg:hidden`}>
        {[1, -1].map((d) => (
          <button key={d} type="button" aria-label={d > 0 ? 'Fly forward' : 'Fly backward'}
            className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-[#9a92d9]/30 bg-[#0a0521]/80 text-[#f1e9dd] backdrop-blur-md active:bg-[#8642ff]/40"
            onPointerDown={() => p.engine?.setMobileThrust(d)} onPointerUp={() => p.engine?.setMobileThrust(0)} onPointerLeave={() => p.engine?.setMobileThrust(0)}>
            {d > 0 ? '▲' : '▼'}
          </button>
        ))}
      </div>

      {/* ── warp veil ── */}
      <div aria-hidden className={`pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-[#050a21] transition-opacity duration-500 ${p.warping ? 'opacity-70' : 'opacity-0'}`}>
        <div className={`font-hud text-xs tracking-[0.6em] text-[#c4bef0] transition-opacity duration-300 ${p.warping ? 'opacity-100' : 'opacity-0'}`}>W A R P</div>
      </div>
    </>
  );
}
