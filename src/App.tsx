import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Engine, type WorldContext, type SelectionInfo, type LevelStats, type EngineState } from './engine/Engine';
import { DEFAULT_PHYSICS, type PhysicsParams } from './sim/physics';
import { DEFAULT_UNIVERSE } from './sim/universe';
import { REAL_LAWS, type Laws } from './sim/laws';
import { loadPhysics, savePhysics } from './lib/storage';
import { Hud, type Multiverse } from './components/Hud';
import { Lab } from './components/lab/Lab';
import { Compare } from './components/Compare';
import { dataStore } from './data/store';
import { liveStore } from './data/live';

// re-open catalogues saved on this computer by earlier sessions (no network needed)
void dataStore.restoreCached();
// start the real-time feeds (shared by the live universe and every sandbox)
liveStore.start();

type View = 'live' | 'sandbox';
const VIEW_KEY = 'cosmos.view';
const readView = (): View => { try { return localStorage.getItem(VIEW_KEY) === 'sandbox' ? 'sandbox' : 'live'; } catch { return 'live'; } };

const INITIAL_CTX: WorldContext = {
  level: 'map', crumbs: [{ level: 'map', label: 'Observable universe' }],
  universe: DEFAULT_UNIVERSE, galaxy: null, system: null,
};
const MAX_UNIVERSES = 4;

interface UniMeta { id: number; name: string; state?: EngineState; live?: boolean }
const LIVE_META: UniMeta = { id: 0, name: 'Live universe', live: true };
type Toast = (m: string) => void;

export default function App() {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [unis, setUnis] = useState<UniMeta[]>([{ id: 1, name: 'Universe A' }]);
  const [focus, setFocus] = useState(1);
  const [view, setViewState] = useState<View>(readView);
  const setView = useCallback((v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } }, []);
  const [labOpen, setLabOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const engines = useRef(new Map<number, Engine>());
  const nextId = useRef(2);

  const toast = useCallback<Toast>((msg) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  const fork = useCallback(() => {
    const src = engines.current.get(view === 'live' ? 0 : focus);
    if (!src) return;
    if (unis.length >= MAX_UNIVERSES) { toast(`Up to ${MAX_UNIVERSES} parallel universes at once.`); return; }
    const id = nextId.current++;
    const letter = String.fromCharCode(64 + id);
    const from = view === 'live' ? 'the live universe' : unis.find((u) => u.id === focus)?.name ?? 'universe';
    setUnis((u) => [...u, { id, name: `Universe ${letter}`, state: src.exportState() }]);
    setFocus(id);
    if (view === 'live') setView('sandbox'); else setCompareOpen(true);
    toast(view === 'live' ? `Copied the live universe → Universe ${letter}. Everything is editable here.` : `Forked ${from} → Universe ${letter}. Change anything in one; watch them diverge.`);
  }, [focus, unis, toast, view, setView]);

  const close = useCallback((id: number) => {
    setUnis((u) => {
      if (u.length <= 1) return u;
      const next = u.filter((x) => x.id !== id);
      if (focus === id) setFocus(next[0].id);
      return next;
    });
  }, [focus]);

  const register = useCallback((id: number, e: Engine | null) => {
    if (e) engines.current.set(id, e); else engines.current.delete(id);
  }, []);

  const multiverse: Multiverse = {
    list: unis.map((u) => ({ id: u.id, name: u.name })), focus,
    onFocus: setFocus, onFork: fork, onClose: close,
    onLab: () => setLabOpen(true), onCompare: () => setCompareOpen((v) => !v), compareOpen,
    view, onView: setView,
  };
  const n = unis.length;
  const grid = n === 1 ? 'grid-cols-1' : n === 2 ? 'grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1' : 'grid-cols-2 grid-rows-2';

  return (
    <div ref={setRoot} className="fixed inset-0 overflow-hidden bg-[#020409]">
      <div className={`absolute inset-0 ${view === 'live' ? '' : 'hidden'}`}>
        <div className="absolute inset-0 grid grid-cols-1">
          <UniversePane meta={LIVE_META} focused={view === 'live'} hidden={view !== 'live'} solo root={root}
            onFocus={() => undefined} register={register} toast={toast} multiverse={multiverse}
            labOpen={false} onCloseLab={() => setLabOpen(false)} />
        </div>
      </div>
      <div className={`absolute inset-0 grid gap-px bg-[#9a92d9]/20 ${grid} ${view === 'sandbox' ? '' : 'hidden'}`}>
        {unis.map((u) => (
          <UniversePane key={u.id} meta={u} focused={view === 'sandbox' && u.id === focus} hidden={view !== 'sandbox'} solo={n === 1} root={root}
            onFocus={() => setFocus(u.id)} register={register} toast={toast} multiverse={multiverse}
            labOpen={labOpen && u.id === focus} onCloseLab={() => setLabOpen(false)} />
        ))}
      </div>
      {view === 'sandbox' && compareOpen && n > 1 && <Compare unis={unis} engines={engines.current} onClose={() => setCompareOpen(false)} />}
      <div className="pointer-events-none absolute left-1/2 top-36 z-50 flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="rounded-xl border border-[#9a92d9]/25 bg-[#0a0521]/90 px-3 py-1.5 text-[12px] text-[#f1e9dd] backdrop-blur">{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

function UniversePane({ meta, focused, hidden, solo, root, onFocus, register, toast, multiverse, labOpen, onCloseLab }: {
  meta: UniMeta; focused: boolean; hidden: boolean; solo: boolean; root: HTMLDivElement | null; onFocus: () => void;
  register: (id: number, e: Engine | null) => void; toast: Toast; multiverse: Multiverse; labOpen: boolean; onCloseLab: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [physics, setPhysicsState] = useState<PhysicsParams>(() => meta.state ? { ...meta.state.physics } : { ...DEFAULT_PHYSICS, ...loadPhysics() });
  const [laws, setLawsState] = useState<Laws>(() => meta.state ? { ...meta.state.laws } : { ...REAL_LAWS });
  const [ctx, setCtx] = useState<WorldContext>(INITIAL_CTX);
  const [selected, setSelected] = useState<SelectionInfo | null>(null);
  const [stats, setStats] = useState<LevelStats | null>(null);
  const [warping, setWarping] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [following, setFollowing] = useState(false);
  const physicsRef = useRef(physics);
  const focusRef = useRef(onFocus);
  focusRef.current = onFocus;

  useEffect(() => {
    if (!containerRef.current || !labelsRef.current) return;
    // The engine emits its first events from inside its constructor, so callbacks
    // must not touch the instance until construction has finished.
    let eng: Engine | null = null;
    const e = new Engine(containerRef.current, labelsRef.current, {
      onSelect: setSelected,
      onContext: setCtx,
      onWarp: setWarping,
      onStats: (s) => { setStats(s); setFollowing(eng?.isFollowing() ?? false); },
      onToast: toast,
      onPlacement: setPlacing,
      onPhysics: setPhysicsState,
      onFocus: () => focusRef.current(),
    }, physicsRef.current, meta.state);
    eng = e;
    if (meta.live) e.setLive(true);
    setEngine(e);
    register(meta.id, e);
    return () => { register(meta.id, null); e.dispose(); setEngine(null); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { engine?.setActive(focused); }, [engine, focused]);
  useEffect(() => { engine?.setSuspended(hidden); }, [engine, hidden]);

  useEffect(() => {
    physicsRef.current = physics;
    if (meta.id !== 1) return; // only the original sandbox universe writes preferences
    const t = setTimeout(() => savePhysics(physics), 400);
    return () => clearTimeout(t);
  }, [physics, meta.id]);

  const setPhysics = useCallback((p: Partial<PhysicsParams>) => {
    engine?.setPhysics(p);
    if (engine) setPhysicsState({ ...engine.physics }); // the live universe ignores edits to its physics
    else setPhysicsState((prev) => ({ ...prev, ...p }));
  }, [engine]);
  const setLaws = useCallback((l: Partial<Laws>) => {
    setLawsState((prev) => ({ ...prev, ...l }));
    engine?.setLaws(l);
  }, [engine]);

  return (
    <div className={`relative min-h-0 min-w-0 overflow-hidden ${!solo && focused ? 'outline outline-2 -outline-offset-2 outline-[#8642ff]/70' : ''}`} onPointerDownCapture={onFocus}>
      <div ref={containerRef} className="absolute inset-0" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" />
      {!solo && (
        <div className={`pointer-events-none absolute bottom-2 left-2 z-20 rounded-full border px-2.5 py-1 font-hud text-[10px] ${focused ? 'border-[#8642ff]/70 bg-[#8642ff]/25 text-[#f1e9dd]' : 'border-[#9a92d9]/30 bg-[#0a0521]/70 text-[#9a92d9]'}`}>
          {meta.name}{focused ? ' · controls' : ''} · {ctx.crumbs[ctx.crumbs.length - 1]?.label}
        </div>
      )}
      {focused && root && createPortal(
        <Hud engine={engine} ctx={ctx} selected={selected} stats={stats} physics={physics} warping={warping}
          placing={placing} following={following} setPhysics={setPhysics} toast={toast}
          universeName={meta.name} multiverse={multiverse} live={!!meta.live} />, root)}
      {labOpen && root && createPortal(
        <Lab universeName={meta.name} laws={laws} physics={physics} setLaws={setLaws} setPhysics={setPhysics} onClose={onCloseLab} />, root)}
    </div>
  );
}
