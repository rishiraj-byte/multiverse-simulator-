import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Engine, WorldContext, LevelStats, SpawnKind, SelectionInfo, MapBookmark } from '@/engine/Engine';
import type { PhysicsParams } from '@/sim/physics';
import { DEFAULT_PHYSICS } from '@/sim/physics';
import type { GalaxyParams, GalaxyType } from '@/sim/galaxy';
import { PRESETS, catalogSystem, type CatalogHost } from '@/sim/systems';
import { parseExoplanetCSV } from '@/sim/catalog';
import { listSaves, addSave, deleteSave, downloadSnapshot, parseSnapshot, type SaveSlot } from '@/lib/storage';
import { Section, SliderRow, ToggleRow, Btn, Segmented, Rows, CurveChart, NumberInput } from './primitives';

type SetPhysics = (p: Partial<PhysicsParams>) => void;
type Toast = (m: string) => void;

// ───────────────────────── Sim ─────────────────────────

const COSMO_PRESETS = [
  { label: 'Planck 2018 ΛCDM', p: { H0: 67.4, omegaM: 0.315, omegaL: 0.685 } },
  { label: 'Einstein–de Sitter', p: { H0: 70, omegaM: 1, omegaL: 0 } },
  { label: 'Closed → Big Crunch', p: { H0: 70, omegaM: 3, omegaL: 0 } },
  { label: 'Dark-energy dominated', p: { H0: 70, omegaM: 0.05, omegaL: 0.95 } },
];

export function SimPanel({ physics: p, setPhysics, ctx, stats, engine }: {
  physics: PhysicsParams; setPhysics: SetPhysics; ctx: WorldContext; stats: LevelStats | null; engine: Engine | null;
}) {
  return (
    <div className="space-y-4">
      {stats && stats.rows.length > 0 && (
        <Section title="Live readout" hint={ctx.level === 'system' ? 'Energy drift stays bounded because the integrator is symplectic.' : undefined}>
          <Rows rows={stats.rows} />
          {stats.event && <p className="rounded-lg border border-[#ffc46a]/30 bg-[#ffc46a]/10 p-2 text-[12px] text-[#ffe2b0]">{stats.event}</p>}
        </Section>
      )}

      {ctx.level === 'map' && <MapControls physics={p} setPhysics={setPhysics} engine={engine} />}

      {(ctx.level === 'system' || ctx.level === 'planet') && (
        <Section title="Gravity" hint="Newtonian N-body · F = G·m₁m₂ / (r² + ε²)">
          <SliderRow label="Gravitational constant" value={p.gMult} min={0} max={10} step={0.01} display={`${p.gMult.toFixed(2)} × G`} onChange={(v) => setPhysics({ gMult: v })} />
          <SliderRow label="Softening ε" value={p.softening} min={0} max={0.6} step={0.01} display={p.softening.toFixed(2)} onChange={(v) => setPhysics({ softening: v })} />
          <ToggleRow label="Collisions merge bodies" hint="Mass and momentum conserved" checked={p.collisions} onChange={(v) => setPhysics({ collisions: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={() => setPhysics({ gMult: 0 })}>Switch gravity off</Btn>
            <Btn onClick={() => engine?.resetSystem()} tone="primary">Reset system</Btn>
          </div>
        </Section>
      )}

      {ctx.level === 'galaxy' && (
        <Section title="Dark matter" hint="Rotation curve v(r) = √(G·M(<r) / r) — bulge + disk + halo">
          <SliderRow label="Halo strength" value={p.darkMatter} min={0} max={2} step={0.01} display={`${p.darkMatter.toFixed(2)} ×`} onChange={(v) => setPhysics({ darkMatter: v })} />
          {stats?.curve && <CurveChart curve={stats.curve} />}
          <p className="text-[12px] leading-relaxed text-[#c4bef0]">
            At 0 the outer disk follows the falling dashed curve; real galaxies stay flat — the evidence for dark matter. The spiral arms are density waves, so they persist whatever you set.
          </p>
        </Section>
      )}

      {ctx.level === 'universe' && (
        <Section title="Cosmology" hint="Friedmann equations · H² = H₀²(Ωm a⁻³ + Ωk a⁻² + ΩΛ)">
          <SliderRow label="Hubble constant H₀" value={p.H0} min={40} max={100} step={0.1} display={`${p.H0.toFixed(1)} km/s/Mpc`} onChange={(v) => setPhysics({ H0: v })} />
          <SliderRow label="Matter Ωm" value={p.omegaM} min={0} max={3} step={0.005} display={p.omegaM.toFixed(3)} onChange={(v) => setPhysics({ omegaM: v })} />
          <SliderRow label="Dark energy ΩΛ" value={p.omegaL} min={0} max={1.5} step={0.005} display={p.omegaL.toFixed(3)} onChange={(v) => setPhysics({ omegaL: v })} />
          <div className="grid grid-cols-2 gap-2">
            {COSMO_PRESETS.map((c) => <Btn key={c.label} onClick={() => setPhysics(c.p)}>{c.label}</Btn>)}
          </div>
          <Btn tone="primary" className="w-full" onClick={() => setPhysics({ reverse: true, paused: false, timeWarp: 60 })}>
            Rewind to the Big Bang
          </Btn>
          <p className="text-[12px] leading-relaxed text-[#c4bef0]">Changing a parameter restarts the clock at “today” (a = 1) for that universe.</p>
        </Section>
      )}

      <Section title="Clocks per scale" hint="The time bar multiplies all of these. Physics is unchanged — only how fast you watch it.">
        <SliderRow label="Galactic clock" value={Math.log10(p.galaxyRate)} min={-1} max={2} step={0.01} display={`${p.galaxyRate.toPrecision(3)} Myr / sim-s`} onChange={(v) => setPhysics({ galaxyRate: Math.pow(10, v) })} />
        <SliderRow label="Cosmic clock" value={Math.log10(p.cosmicRate)} min={-3} max={0} step={0.01} display={`${p.cosmicRate.toPrecision(3)} Gyr / sim-s`} onChange={(v) => setPhysics({ cosmicRate: Math.pow(10, v) })} />
        <SliderRow label="Moon clock" value={p.moonRate} min={0} max={5} step={0.05} display={`${p.moonRate.toFixed(2)} ×`} onChange={(v) => setPhysics({ moonRate: v })} />
      </Section>

      <Btn className="w-full" onClick={() => setPhysics({ ...DEFAULT_PHYSICS, labels: p.labels, habitableZone: p.habitableZone, trails: p.trails, trailLength: p.trailLength, belts: p.belts })}>
        Restore default physics
      </Btn>
    </div>
  );
}

// ───────────────────────── Universe map ─────────────────────────

const LAYERS: { key: keyof PhysicsParams; label: string; hint?: string }[] = [
  { key: 'mapSolar', label: 'Solar System', hint: 'Real planet positions for the date; belts, Kuiper belt, Oort cloud' },
  { key: 'mapStars', label: 'Nearby stars & nebulae', hint: 'Catalogued stars + a sample of the solar neighbourhood' },
  { key: 'mapMilkyWay', label: 'Milky Way', hint: 'Seen from the Sun’s real position, 26 000 ly from the centre' },
  { key: 'mapGalaxies', label: 'Named galaxies & structures', hint: 'Local Group, clusters, superclusters, quasars, z > 10 galaxies' },
  { key: 'mapStructures', label: 'Cluster & supercluster members', hint: 'Procedural members around the real positions' },
  { key: 'mapWeb', label: 'Cosmic web', hint: 'Procedural galaxies out to cosmic dawn (z ≈ 20)' },
  { key: 'mapCMB', label: 'Cosmic microwave background', hint: 'The farthest light: last scattering, 45 billion ly' },
  { key: 'mapDipole', label: 'Show the real CMB dipole', hint: 'Our 370 km/s motion through the CMB (Planck 2018)' },
  { key: 'mapRings', label: 'Distance rings', hint: '1 AU → 10 billion ly, logarithmic' },
];

function MapControls({ physics: p, setPhysics, engine }: { physics: PhysicsParams; setPhysics: SetPhysics; engine: Engine | null }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 16));
  return (
    <>
      <Section title="Travel" hint="Every object is at its real direction and distance from the viewpoint; the radius is logarithmic (R ∝ log d), so planets and the edge of the universe fit in one view.">
        <div className="grid grid-cols-2 gap-2">
          <Btn tone="primary" onClick={() => engine?.mapHome()}>Back to the Sun</Btn>
          <Btn onClick={() => engine?.openExpansion()}>Cosmic expansion sim</Btn>
        </div>
        <p className="text-[12px] leading-relaxed text-[#c4bef0]">Scroll to zoom from AU to billions of light-years. W A S D (Shift = faster) moves you through real space at a speed matched to the zoom. Select anything, then “Fly here” to move your viewpoint there.</p>
      </Section>
      <Section title="Lens">
        <ToggleRow label="Fisheye lens" hint="True equidistant fisheye — up to the whole sky in one circle" checked={p.fisheye} onChange={(v) => setPhysics({ fisheye: v })} />
        {p.fisheye && <SliderRow label="Field of view" value={p.fisheyeFov} min={90} max={360} step={1} display={`${p.fisheyeFov.toFixed(0)}°`} onChange={(v) => setPhysics({ fisheyeFov: v })} />}
      </Section>
      <Section title="Date" hint="Planets, the Moon and the Sun use real ephemerides (JPL elements, valid 1800–2050). The time bar runs 1 day per sim-second.">
        <input type="datetime-local" value={date} onChange={(e: ChangeEvent<HTMLInputElement>) => setDate(e.target.value)} aria-label="Map date (UTC)"
          className="w-full rounded-md border border-[#9a92d9]/30 bg-[#050a21] px-2 py-1.5 font-hud text-[12px] text-[#f1e9dd] outline-none focus:border-[#8642ff]" />
        <div className="grid grid-cols-2 gap-2">
          <Btn onClick={() => { const d = new Date(date + 'Z'); if (!isNaN(d.getTime())) engine?.setMapDate(d); }}>Set date (UTC)</Btn>
          <Btn onClick={() => { const n = new Date(); setDate(n.toISOString().slice(0, 16)); engine?.setMapDate(n); }}>Now</Btn>
        </div>
      </Section>
      <Section title="Microwave background colour" hint="Same real physics, different colours. Brightness 0 hides it behind the galaxies.">
        <Segmented label="CMB colours" value={p.cmbPalette as 'deep' | 'planck' | 'infrared' | 'mono'}
          options={[{ id: 'deep', label: 'Night' }, { id: 'planck', label: 'Planck' }, { id: 'infrared', label: 'Infrared' }, { id: 'mono', label: 'Grey' }]}
          onChange={(v) => setPhysics({ cmbPalette: v, cmbBrightness: v === 'planck' && p.cmbBrightness < 0.4 ? 0.45 : p.cmbBrightness })} />
        <SliderRow label="Brightness" value={p.cmbBrightness} min={0} max={1} step={0.01} display={`${Math.round(p.cmbBrightness * 100)} %`} onChange={(v) => setPhysics({ cmbBrightness: v })} />
      </Section>
      <Section title="Layers">
        {LAYERS.map((l) => <ToggleRow key={l.key} label={l.label} hint={l.hint} checked={!!p[l.key]} onChange={(v) => setPhysics({ [l.key]: v } as Partial<PhysicsParams>)} />)}
      </Section>
    </>
  );
}

// ───────────────────────── Build ─────────────────────────

const SPAWN_KINDS: { id: SpawnKind; label: string }[] = [
  { id: 'rocky', label: 'Rocky' }, { id: 'gas', label: 'Gas giant' }, { id: 'ice', label: 'Ice giant' },
  { id: 'star', label: 'Star' }, { id: 'blackhole', label: 'Black hole' },
];
const MASS_RANGE: Record<SpawnKind, { min: number; max: number; unit: string; def: number }> = {
  rocky: { min: -2, max: 1, unit: 'M⊕', def: 0 },
  gas: { min: 1.5, max: 3.6, unit: 'M⊕', def: 2.5 },
  ice: { min: 0.7, max: 1.6, unit: 'M⊕', def: 1.2 },
  star: { min: -1.1, max: 1.5, unit: 'M☉', def: 0 },
  blackhole: { min: 0.5, max: 2, unit: 'M☉', def: 1 },
};

function SpawnTool({ engine, selected, placing }: { engine: Engine | null; selected: SelectionInfo | null; placing: boolean }) {
  const [kind, setKind] = useState<SpawnKind>('rocky');
  const [logM, setLogM] = useState(0);
  const [orbitR, setOrbitR] = useState(12);
  const [speed, setSpeed] = useState(1);
  const [incl, setIncl] = useState(0);
  const [aroundSel, setAroundSel] = useState(false);
  const r = MASS_RANGE[kind];
  const mass = Math.pow(10, logM);
  const canAround = !!selected?.editable;
  const spec = () => ({ kind, mass, orbitR, speedFactor: speed, inclination: incl, aroundId: aroundSel && canAround ? selected!.id : null });
  const orbitWord = speed < 0.999 ? 'elliptical, falls inward' : speed < 1.001 ? 'circular' : speed < 1.414 ? 'elliptical, swings outward' : 'escapes (≥ √2 = 1.414)';
  return (
    <Section title="Add a body" hint="Velocity = factor × circular speed √(G(M+m)/r)">
      <Segmented label="Body type" value={kind} options={SPAWN_KINDS} onChange={(k) => { setKind(k); setLogM(MASS_RANGE[k].def); }} />
      <SliderRow label="Mass" value={logM} min={r.min} max={r.max} step={0.01} display={`${mass < 10 ? mass.toFixed(2) : Math.round(mass).toLocaleString('en-US')} ${r.unit}`} onChange={setLogM} />
      <SliderRow label="Orbit radius" value={orbitR} min={2} max={60} step={0.1} display={`${orbitR.toFixed(1)} u`} onChange={setOrbitR} />
      <SliderRow label="Speed factor" value={speed} min={0.3} max={1.6} step={0.01} display={`${speed.toFixed(2)} · ${orbitWord}`} onChange={setSpeed} />
      <SliderRow label="Inclination" value={incl} min={0} max={90} step={1} display={`${incl}°`} onChange={setIncl} />
      <ToggleRow label={canAround ? `Orbit ${selected!.name}` : 'Orbit the selected body'} hint={canAround ? undefined : 'Select a body first; otherwise the most massive body is used'} checked={aroundSel && canAround} onChange={setAroundSel} />
      <div className="grid grid-cols-2 gap-2">
        <Btn tone="primary" onClick={() => engine?.spawn(spec())}>Add on orbit</Btn>
        {placing
          ? <Btn tone="danger" onClick={() => engine?.cancelPlacement()}>Cancel placing</Btn>
          : <Btn onClick={() => engine?.armPlacement(spec())} title="Click anywhere on the orbital plane">Place by clicking</Btn>}
      </div>
    </Section>
  );
}

const GALAXY_TYPES: { id: GalaxyType; label: string }[] = [
  { id: 'spiral', label: 'Spiral' }, { id: 'barred', label: 'Barred' }, { id: 'elliptical', label: 'Elliptical' }, { id: 'irregular', label: 'Irregular' },
];

function GalaxyEditor({ engine, params }: { engine: Engine | null; params: GalaxyParams }) {
  const [d, setD] = useState(params);
  useEffect(() => setD(params), [params]);
  const set = (p: Partial<GalaxyParams>) => setD((x) => ({ ...x, ...p }));
  const disk = d.type === 'spiral' || d.type === 'barred';
  return (
    <Section title={`Shape ${params.name}`} hint="Regenerates this galaxy; your edits persist while the universe stays the same">
      <Segmented label="Galaxy type" value={d.type} options={GALAXY_TYPES} onChange={(t) => set({ type: t })} />
      {disk && <>
        <SliderRow label="Spiral arms" value={d.arms} min={1} max={6} step={1} display={String(d.arms)} onChange={(v) => set({ arms: v })} />
        <SliderRow label="Arm pitch angle" value={d.pitchDeg} min={5} max={40} step={0.5} display={`${d.pitchDeg.toFixed(1)}°`} onChange={(v) => set({ pitchDeg: v })} />
        <SliderRow label="Arm contrast" value={d.armStrength} min={0} max={1} step={0.01} display={`${Math.round(d.armStrength * 100)} %`} onChange={(v) => set({ armStrength: v })} />
      </>}
      {d.type !== 'elliptical' && d.type !== 'irregular' && (
        <SliderRow label="Bulge fraction" value={d.bulgeFrac} min={0} max={0.6} step={0.01} display={`${Math.round(d.bulgeFrac * 100)} %`} onChange={(v) => set({ bulgeFrac: v })} />
      )}
      {d.type === 'elliptical' && (
        <SliderRow label="Flattening" value={d.flattening} min={0} max={0.7} step={0.01} display={`E${Math.round(d.flattening * 10)}`} onChange={(v) => set({ flattening: v })} />
      )}
      <SliderRow label="Radius" value={d.radiusKpc} min={3} max={50} step={0.5} display={`${d.radiusKpc.toFixed(1)} kpc`} onChange={(v) => set({ radiusKpc: v })} />
      <SliderRow label="Stellar mass" value={Math.log10(d.massScale)} min={-1.5} max={1} step={0.01} display={`${d.massScale.toFixed(2)} × Milky Way`} onChange={(v) => set({ massScale: Math.pow(10, v) })} />
      <SliderRow label="Stars drawn" value={d.starCount} min={5000} max={60000} step={1000} display={d.starCount.toLocaleString('en-US')} onChange={(v) => set({ starCount: v })} />
      <NumberInput label="Seed" value={d.seed} onChange={(v) => set({ seed: v })} />
      <div className="grid grid-cols-2 gap-2">
        <Btn onClick={() => setD(params)}>Discard edits</Btn>
        <Btn tone="primary" onClick={() => engine?.setGalaxyParams(d)}>Regenerate galaxy</Btn>
      </div>
    </Section>
  );
}

function UniverseEditor({ engine, ctx }: { engine: Engine | null; ctx: WorldContext }) {
  const [u, setU] = useState(ctx.universe);
  useEffect(() => setU(ctx.universe), [ctx.universe]);
  return (
    <Section title="Universe" hint="Every galaxy, star and planet is derived from this seed">
      <NumberInput label="Universe seed" value={u.seed} onChange={(v) => setU({ ...u, seed: v })} />
      <SliderRow label="Galaxies" value={u.count} min={1000} max={15000} step={500} display={u.count.toLocaleString('en-US')} onChange={(v) => setU({ ...u, count: v })} />
      <SliderRow label="Clustered on filaments" value={u.clustering} min={0} max={1} step={0.01} display={`${Math.round(u.clustering * 100)} %`} onChange={(v) => setU({ ...u, clustering: v })} />
      <div className="grid grid-cols-2 gap-2">
        <Btn onClick={() => setU({ ...u, seed: Math.floor(Math.random() * 1e6) })}>Random seed</Btn>
        <Btn tone="primary" onClick={() => engine?.setUniverseParams(u)}>Regenerate universe</Btn>
      </div>
    </Section>
  );
}

function CatalogImport({ engine, toast }: { engine: Engine | null; toast: Toast }) {
  const [hosts, setHosts] = useState<CatalogHost[]>(() => loadCatalog());
  const [q, setQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const r = parseExoplanetCSV(await f.text());
    if (r.error) { toast(r.error); return; }
    setHosts(r.hosts);
    saveCatalog(r.hosts);
    toast(`Imported ${r.planets.toLocaleString('en-US')} planets around ${r.hosts.length.toLocaleString('en-US')} stars`);
    if (fileRef.current) fileRef.current.value = '';
  };
  const query = q.trim().toLowerCase();
  const shown = (query ? hosts.filter((h) => h.name.toLowerCase().includes(query) || h.planets.some((pl) => pl.name.toLowerCase().includes(query))) : hosts).slice(0, 60);
  return (
    <Section title="Every known exoplanet" hint="Import the NASA Exoplanet Archive table: exoplanetarchive.ipac.caltech.edu → Data → Planetary Systems Composite Parameters → Download Table → CSV (all columns).">
      <Btn className="w-full" onClick={() => fileRef.current?.click()}>{hosts.length ? 'Re-import CSV' : 'Import NASA CSV'}</Btn>
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e: ChangeEvent<HTMLInputElement>) => { void onFile(e.target.files?.[0]); }} />
      {hosts.length > 0 && <>
        <input value={q} onChange={(e: ChangeEvent<HTMLInputElement>) => setQ(e.target.value)} placeholder={`Search ${hosts.length.toLocaleString('en-US')} systems…`} aria-label="Search catalog"
          className="w-full rounded-md border border-[#9a92d9]/30 bg-[#050a21] px-2 py-2 text-[13px] text-[#f1e9dd] outline-none placeholder:text-[#c4bef0] focus:border-[#8642ff]" />
        <ul className="max-h-56 space-y-0.5 overflow-y-auto">
          {shown.map((h) => (
            <li key={h.name}>
              <button type="button" onClick={() => engine?.loadDef(() => catalogSystem(h), `cat:${h.name}`)}
                className="flex min-h-[30px] w-full items-center justify-between gap-2 rounded-md px-2 text-left text-[13px] text-[#e2ddfb] hover:bg-[#8642ff]/15">
                <span className="truncate">{h.name}</span>
                <span className="shrink-0 font-hud text-[11px] text-[#c4bef0]">{h.planets.length} pl{h.distPc ? ` · ${(h.distPc * 3.2616).toFixed(0)} ly` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </>}
    </Section>
  );
}

const CATALOG_KEY = 'cosmos.catalog.v1';
function loadCatalog(): CatalogHost[] { try { const r = localStorage.getItem(CATALOG_KEY); return r ? (JSON.parse(r) as CatalogHost[]) : []; } catch { return []; } }
function saveCatalog(h: CatalogHost[]) { try { localStorage.setItem(CATALOG_KEY, JSON.stringify(h)); } catch { /* storage full: keep in memory only */ } }

export function BuildPanel({ engine, ctx, selected, placing, toast }: { engine: Engine | null; ctx: WorldContext; selected: SelectionInfo | null; placing: boolean; toast: Toast }) {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6));
  const inSystem = ctx.level === 'system' || ctx.level === 'planet';
  return (
    <div className="space-y-4">
      {ctx.level === 'universe' && <UniverseEditor engine={engine} ctx={ctx} />}
      {ctx.level === 'galaxy' && ctx.galaxy && <GalaxyEditor engine={engine} params={ctx.galaxy} />}
      <Section title="Star systems" hint="Real systems use published data; generated ones follow stellar physics">
        <div className="grid grid-cols-3 gap-1.5">
          {PRESETS.map((s) => <Btn key={s.id} onClick={() => engine?.loadPreset(s.id)}>{s.label}</Btn>)}
        </div>
        <NumberInput label="System seed" value={seed} onChange={setSeed} />
        <div className="grid grid-cols-2 gap-2">
          <Btn onClick={() => engine?.generateSystem(seed)}>Generate from seed</Btn>
          <Btn tone="primary" onClick={() => { const s = Math.floor(Math.random() * 1e6); setSeed(s); engine?.generateSystem(s); }}>Random system</Btn>
        </div>
      </Section>
      {ctx.level === 'system' && <SpawnTool engine={engine} selected={selected} placing={placing} />}
      <CatalogImport engine={engine} toast={toast} />
      {ctx.level === 'planet' && <p className="text-[12px] text-[#c4bef0]">Go back to the star system to add planets, stars or black holes.</p>}
      {!inSystem && <p className="text-[12px] text-[#c4bef0]">Enter a star system to add your own planets, stars and black holes.</p>}
    </div>
  );
}

// ───────────────────────── Bodies ─────────────────────────

const KIND_DOT: Record<string, string> = { star: 'bg-[#ffd27a]', 'black hole': 'bg-black ring-1 ring-[#ff9a5c]', planet: 'bg-[#8fb8ff]', moon: 'bg-[#b8b8b0]', 'dwarf planet': 'bg-[#c9a98a]', comet: 'bg-[#d7e6ff]', 'small body': 'bg-[#9a8a7a]' };

export function BodiesPanel({ engine, stats, selected }: { engine: Engine | null; stats: LevelStats | null; selected: SelectionInfo | null }) {
  const list = stats?.bodies;
  if (!list) return <p className="text-[12px] leading-relaxed text-[#c4bef0]">Enter a star system to list its stars, planets and moons. At galaxy and universe scale, click any point of light instead — each one is enterable.</p>;
  if (!list.length) return <p className="text-[12px] text-[#c4bef0]">This system is empty. Add bodies from the Build tab.</p>;
  return (
    <ul className="space-y-0.5" aria-label="Bodies in this system">
      {list.map((b) => (
        <li key={b.id}>
          <button type="button" onClick={() => engine?.select(b.id)}
            className={`flex min-h-[32px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors ${selected?.id === b.id ? 'bg-[#8642ff]/30 text-[#f1e9dd]' : 'text-[#e2ddfb] hover:bg-[#8642ff]/15'}`}
            style={{ paddingLeft: 8 + b.depth * 16 }}>
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${KIND_DOT[b.kind] ?? 'bg-white'}`} />
            <span className="truncate">{b.name}</span>
            <span className="ml-auto font-hud text-[11px] text-[#c4bef0]">{b.kind}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────── Saves ─────────────────────────

interface Bookmark { id: string; name: string; savedAt: string; view: MapBookmark }
const MARKS_KEY = 'cosmos.bookmarks.v1';
function readMarks(): Bookmark[] { try { const r = localStorage.getItem(MARKS_KEY); const a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a.filter((m) => m?.view?.center?.length === 3) : []; } catch { return []; } }
function writeMarks(m: Bookmark[]): boolean { try { localStorage.setItem(MARKS_KEY, JSON.stringify(m)); return true; } catch { return false; } }

export function SavesPanel({ engine, ctx, toast }: { engine: Engine | null; ctx: WorldContext; toast: Toast }) {
  const [saves, setSaves] = useState<SaveSlot[]>(() => listSaves());
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const hasSystem = !!ctx.system;

  const save = () => {
    const snap = engine?.snapshot();
    if (!snap) return;
    const next = addSave(name || snap.system.name, snap);
    if (next) { setSaves(next); setName(''); toast('System saved'); } else toast('Saving failed — browser storage is full or disabled.');
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const r = parseSnapshot(await f.text());
    if (r.ok) { engine?.loadSnapshot(r.snapshot); toast(`Loaded ${r.snapshot.system.name}`); } else toast(r.error);
    if (fileRef.current) fileRef.current.value = '';
  };

  const [marks, setMarks] = useState<Bookmark[]>(() => readMarks());
  const addMark = () => {
    if (!engine) return;
    const m: Bookmark = { id: Date.now().toString(36), name: markName.trim() || engine.mapIsolation()?.label || 'Universe view', savedAt: new Date().toISOString(), view: engine.mapBookmark() };
    const next = [m, ...marks].slice(0, 40);
    if (writeMarks(next)) { setMarks(next); setMarkName(''); toast('View bookmarked'); } else toast('Saving failed — browser storage is full or disabled.');
  };
  const [markName, setMarkName] = useState('');

  return (
    <div className="space-y-4">
      <Section title="Universe bookmarks" hint="Saves where you are on the universe map: viewpoint, zoom, date and any “show only” filter.">
        <input value={markName} onChange={(e: ChangeEvent<HTMLInputElement>) => setMarkName(e.target.value)} placeholder="Bookmark name" aria-label="Bookmark name"
          className="w-full rounded-md border border-[#9a92d9]/30 bg-[#050a21] px-2 py-2 text-[13px] text-[#f1e9dd] outline-none placeholder:text-[#c4bef0] focus:border-[#8642ff]" />
        <Btn tone="primary" className="w-full" disabled={ctx.level !== 'map'} onClick={addMark}>{ctx.level === 'map' ? 'Bookmark this view' : 'Go to the universe map to bookmark a view'}</Btn>
        {marks.length > 0 && (
          <ul className="space-y-1.5">
            {marks.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-lg border border-[#9a92d9]/15 p-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-[#f1e9dd]">{m.name}</div>
                  <div className="font-hud text-[11px] text-[#c4bef0]">{new Date(m.savedAt).toLocaleString()}</div>
                </div>
                <Btn onClick={() => engine?.gotoBookmark(m.view)}>Go</Btn>
                <Btn tone="danger" onClick={() => { const next = marks.filter((x) => x.id !== m.id); writeMarks(next); setMarks(next); }} title={`Delete ${m.name}`}>Delete</Btn>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Save this system" hint={hasSystem ? 'Stores positions, velocities and every body you added' : 'Open a star system first'}>
        <input value={name} onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)} placeholder={ctx.system?.name ?? 'Name'} disabled={!hasSystem}
          aria-label="Save name"
          className="w-full rounded-md border border-[#9a92d9]/30 bg-[#050a21] px-2 py-2 text-[13px] text-[#f1e9dd] outline-none placeholder:text-[#c4bef0] focus:border-[#8642ff] disabled:opacity-40" />
        <div className="grid grid-cols-2 gap-2">
          <Btn tone="primary" disabled={!hasSystem} onClick={save}>Save in browser</Btn>
          <Btn disabled={!hasSystem} onClick={() => { const s = engine?.snapshot(); if (s) downloadSnapshot(s); }}>Export JSON</Btn>
        </div>
        <Btn className="w-full" onClick={() => fileRef.current?.click()}>Import JSON file</Btn>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e: ChangeEvent<HTMLInputElement>) => { void onFile(e.target.files?.[0]); }} />
      </Section>
      <Section title="Saved systems">
        {saves.length === 0 && <p className="text-[12px] text-[#c4bef0]">Nothing saved yet. Saves stay in this browser only.</p>}
        <ul className="space-y-1.5">
          {saves.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-lg border border-[#9a92d9]/15 p-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-[#f1e9dd]">{s.name}</div>
                <div className="font-hud text-[11px] text-[#c4bef0]">{new Date(s.savedAt).toLocaleString()} · {s.snapshot.system.bodies.length} bodies</div>
              </div>
              <Btn onClick={() => engine?.loadSnapshot(s.snapshot)}>Load</Btn>
              <Btn tone="danger" onClick={() => setSaves(deleteSave(s.id))} title={`Delete ${s.name}`}>Delete</Btn>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

// ───────────────────────── View ─────────────────────────

const KEYS: [string, string][] = [
  ['W A S D · R F', 'Fly / up / down'], ['Drag', 'Look or orbit'], ['Scroll · pinch', 'Speed or zoom'],
  ['Click', 'Select'], ['Double-click · Enter', 'Enter'], ['Backspace', 'Up one level'],
  ['C', 'Follow selection'], ['Space', 'Pause'], ['[ ]', 'Slower / faster'], ['\\', 'Reverse time'],
  ['L', 'Labels'], ['Delete', 'Remove body'], ['Q E', 'Roll'], ['Shift', 'Boost'], ['Esc', 'Deselect'],
];

export function ViewPanel({ physics: p, setPhysics }: { physics: PhysicsParams; setPhysics: SetPhysics }) {
  return (
    <div className="space-y-4">
      <Section title="Display">
        <ToggleRow label="Labels" checked={p.labels} onChange={(v) => setPhysics({ labels: v })} />
        <ToggleRow label="Orbit trails" checked={p.trails} onChange={(v) => setPhysics({ trails: v })} />
        <SliderRow label="Trail length" value={p.trailLength} min={50} max={2000} step={10} display={`${p.trailLength} pts`} onChange={(v) => setPhysics({ trailLength: Math.round(v) })} />
        <ToggleRow label="Habitable zone" hint="Kopparapu et al. 2013, conservative" checked={p.habitableZone} onChange={(v) => setPhysics({ habitableZone: v })} />
        <ToggleRow label="Asteroid belts & clouds" hint="Main belt, trojans, Kuiper belt, Oort cloud…" checked={p.belts} onChange={(v) => setPhysics({ belts: v })} />
      </Section>
      <Section title="Controls">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          {KEYS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-hud text-[#f1e9dd]">{k}</dt>
              <dd className="text-[#c4bef0]">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}
