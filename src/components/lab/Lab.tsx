import { useMemo, useState } from 'react';
import type { PhysicsParams } from '@/sim/physics';
import { deriveLaws, REAL_LAWS, fmtTime, fmtSci, type Laws, type Verdict } from '@/sim/laws';
import { epochs, timeAtA, cosmicTable, cmbTemperature, kTeV, type CosmoParams } from '@/sim/cosmology';
import { STANDARD_MODEL, COMPOSITES, abundantAt, type Particle } from '@/sim/particles';
import { Section, SliderRow, Btn, panelCls } from '../hud/primitives';
import { DecayTab } from './DecayTab';
import { BlackHoleTab } from './BlackHoleTab';
import { ForcesTab } from './ForcesTab';

type LabTab = 'laws' | 'timeline' | 'particles' | 'decay' | 'blackholes' | 'forces';
const TABS: { id: LabTab; label: string }[] = [
  { id: 'laws', label: 'Laws of physics' }, { id: 'timeline', label: 'Cosmic timeline' }, { id: 'particles', label: 'Particles' },
  { id: 'decay', label: 'Radioactive decay' }, { id: 'blackholes', label: 'Black holes' }, { id: 'forces', label: 'Forces sandbox' },
];

export interface LabProps {
  universeName: string;
  laws: Laws;
  physics: PhysicsParams;
  setLaws: (l: Partial<Laws>) => void;
  setPhysics: (p: Partial<PhysicsParams>) => void;
  onClose: () => void;
}

export function Lab(p: LabProps) {
  const [tab, setTab] = useState<LabTab>('laws');
  return (
    <div className="absolute inset-0 z-[60] flex items-stretch justify-center bg-[#020409]/70 p-2 backdrop-blur-sm sm:p-6" role="dialog" aria-label="Physics lab">
      <div className={`${panelCls} flex w-full max-w-6xl flex-col overflow-hidden`}>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#9a92d9]/15 p-3">
          <h2 className="mr-2 font-display text-base font-bold tracking-wide text-[#f1e9dd]">Physics lab <span className="text-[12px] font-normal text-[#c4bef0]">· {p.universeName}</span></h2>
          <div role="tablist" className="flex flex-1 flex-wrap gap-1">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                className={`min-h-[32px] rounded-md px-3 text-[12px] transition-colors ${tab === t.id ? 'bg-[#8642ff]/35 text-[#f1e9dd]' : 'text-[#c4bef0] hover:text-[#f1e9dd]'}`}>{t.label}</button>
            ))}
          </div>
          <Btn onClick={p.onClose}>Close lab</Btn>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'laws' && <LawsTab {...p} />}
          {tab === 'timeline' && <TimelineTab physics={p.physics} />}
          {tab === 'particles' && <ParticlesTab physics={p.physics} />}
          {tab === 'decay' && <DecayTab />}
          {tab === 'blackholes' && <BlackHoleTab laws={p.laws} gMult={p.physics.gMult} />}
          {tab === 'forces' && <ForcesTab />}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Laws ─────────────────────────

const verdictCls: Record<Verdict, string> = { ok: 'text-[#5fe0a0]', warn: 'text-[#ffc46a]', bad: 'text-[#ff8a8a]' };
const LAW_PRESETS: { label: string; laws: Partial<Laws>; g?: number }[] = [
  { label: 'Our universe', laws: REAL_LAWS, g: 1 },
  { label: 'Strong force −10 %', laws: { ...REAL_LAWS, alphaS: 0.9 } },
  { label: 'Strong force +5 %', laws: { ...REAL_LAWS, alphaS: 1.05 } },
  { label: 'Gravity ×10', laws: REAL_LAWS, g: 10 },
  { label: 'EM ×3 (α)', laws: { ...REAL_LAWS, alpha: 3 } },
  { label: 'Lighter neutron', laws: { ...REAL_LAWS, dMnp: 0.3 } },
  { label: 'Neutron lighter than proton', laws: { ...REAL_LAWS, dMnp: -0.6 } },
];

function LogSlider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return <SliderRow label={label} value={Math.log10(value)} min={Math.log10(min)} max={Math.log10(max)} step={0.005}
    display={`${value.toPrecision(3)} ×`} onChange={(v) => onChange(Math.pow(10, v))} />;
}

function LawsTab({ laws, physics, setLaws, setPhysics }: LabProps) {
  const d = useMemo(() => deriveLaws(laws, physics.gMult), [laws, physics.gMult]);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-4">
        <Section title="Fundamental constants" hint="Multipliers of measured values. G drives every scale of this universe: orbits, galaxy rotation, cosmic expansion, stars, black holes.">
          <LogSlider label="Gravity G" value={Math.max(physics.gMult, 0.01)} min={0.01} max={100} onChange={(v) => setPhysics({ gMult: v })} />
          <LogSlider label="Electromagnetism α (fine-structure)" value={laws.alpha} min={0.1} max={30} onChange={(v) => setLaws({ alpha: v })} />
          <SliderRow label="Strong force αs" value={laws.alphaS} min={0.7} max={1.3} step={0.005} display={`${laws.alphaS.toFixed(3)} ×`} onChange={(v) => setLaws({ alphaS: v })} />
          <LogSlider label="Weak force G_F" value={laws.GF} min={0.01} max={100} onChange={(v) => setLaws({ GF: v })} />
          <LogSlider label="Electron mass" value={laws.me} min={0.1} max={10} onChange={(v) => setLaws({ me: v })} />
          <LogSlider label="Proton mass" value={laws.mp} min={0.3} max={3} onChange={(v) => setLaws({ mp: v })} />
          <SliderRow label="Neutron − proton mass" value={laws.dMnp} min={-1} max={3} step={0.01} display={`${(1.293 * laws.dMnp).toFixed(3)} MeV`} onChange={(v) => setLaws({ dMnp: v })} />
          <LogSlider label="Speed of light c" value={laws.c} min={0.3} max={3} onChange={(v) => setLaws({ c: v })} />
          <LogSlider label="Planck constant ħ" value={laws.hbar} min={0.3} max={3} onChange={(v) => setLaws({ hbar: v })} />
        </Section>
        <div className="flex flex-wrap gap-1.5">
          {LAW_PRESETS.map((pr) => (
            <Btn key={pr.label} onClick={() => { setLaws({ ...REAL_LAWS, ...pr.laws }); setPhysics({ gMult: pr.g ?? 1 }); }}>{pr.label}</Btn>
          ))}
        </div>
      </div>
      <Section title="What happens in this universe" hint="Exact formulas or standard scaling laws — approximations are labelled in the code (src/sim/laws.ts)">
        <div className={`rounded-lg border p-3 text-[13px] ${d.life === 'ok' ? 'border-[#5fe0a0]/30 bg-[#5fe0a0]/10 text-[#c9ffe4]' : d.life === 'warn' ? 'border-[#ffc46a]/30 bg-[#ffc46a]/10 text-[#ffe2b0]' : 'border-[#ff8a8a]/30 bg-[#ff8a8a]/10 text-[#ffd0d0]'}`}>
          {d.life === 'ok' ? 'Chemistry, long-lived stars and planets look possible.' : d.life === 'warn' ? 'Marginal: some ingredients for complex chemistry or long-lived stars are strained.' : 'Hostile: a key ingredient (hydrogen, deuterium, atoms or long-lived stars) fails.'}
        </div>
        <dl className="space-y-2">
          {d.rows.map((r) => (
            <div key={r.k} className="rounded-lg border border-[#9a92d9]/15 p-2">
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <dt className="text-[#e2ddfb]">{r.k}</dt>
                <dd className={`text-right font-hud tabular-nums ${r.verdict ? verdictCls[r.verdict] : 'text-[#f1e9dd]'}`}>{r.v}</dd>
              </div>
              {r.note && <p className="mt-0.5 text-[11.5px] text-[#c4bef0]">{r.note}</p>}
            </div>
          ))}
        </dl>
        <p className="text-[12px] leading-relaxed text-[#c4bef0]">These consequences feed back into the 3-D universe: G changes orbits, galaxy rotation and the Friedmann expansion; stellar luminosity changes every planet’s temperature and habitable zone; black-hole properties use these constants.</p>
      </Section>
    </div>
  );
}

// ───────────────────────── Timeline ─────────────────────────

function TimelineTab({ physics }: { physics: PhysicsParams }) {
  const cp: CosmoParams = { H0: physics.H0, omegaM: physics.omegaM, omegaL: physics.omegaL, gMult: physics.gMult };
  const eps = useMemo(() => epochs(cp), [physics.H0, physics.omegaM, physics.omegaL, physics.gMult]); // eslint-disable-line react-hooks/exhaustive-deps
  const [logT, setLogT] = useState(Math.log10(13.79e9 * 3.15576e7));
  const t = Math.pow(10, logT);
  const table = useMemo(() => cosmicTable(cp), [physics.H0, physics.omegaM, physics.omegaL, physics.gMult]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = table.aAt(t);
  const recollapse = table.maxA < 1e29;
  const T = cmbTemperature(a), kT = kTeV(a);
  const epoch = [...eps].reverse().find((e) => e.tStart <= t) ?? eps[0];
  const present = abundantAt(kT);
  const fmtE = (eV: number) => (eV >= 1e9 ? `${(eV / 1e9).toPrecision(3)} GeV` : eV >= 1e6 ? `${(eV / 1e6).toPrecision(3)} MeV` : eV >= 1e3 ? `${(eV / 1e3).toPrecision(3)} keV` : `${eV.toPrecision(3)} eV`);
  const tNow = useMemo(() => timeAtA(1, cp), [physics.H0, physics.omegaM, physics.omegaL, physics.gMult]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-5">
      <Section title="Scrub cosmic history" hint={`From the Planck time to the far future, solved from the Friedmann equation with this universe’s H₀, Ωm, ΩΛ and G (radiation and g*(T) included). Today here: ${fmtTime(tNow)}.`}>
        <SliderRow label="Time since the Big Bang" value={logT} min={-43.3} max={19.5} step={0.01} display={fmtTime(t)} onChange={setLogT} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[['Scale factor a', fmtSci(a)], ['Redshift z', fmtSci(1 / a - 1)], ['Temperature', `${fmtSci(T)} K`], ['Thermal energy kT', fmtE(kT)]].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-[#9a92d9]/15 p-2"><div className="text-[11.5px] text-[#c4bef0]">{k}</div><div className="font-hud text-[13px] text-[#f1e9dd]">{v}</div></div>
          ))}
        </div>
        {recollapse && t > table.tAt(table.maxA) * 0.999 && (
          <p className="rounded-lg border border-[#ffc46a]/30 bg-[#ffc46a]/10 p-2 text-[12px] text-[#ffe2b0]">This universe stops expanding at a ≈ {fmtSci(table.maxA)} (age {fmtTime(table.tAt(table.maxA))}) and then recollapses — run the 3-D universe forward to watch the Big Crunch.</p>
        )}
        <div className="rounded-lg border border-[#8642ff]/40 bg-[#8642ff]/10 p-3">
          <div className="font-display text-sm font-bold text-[#f1e9dd]">{epoch.name}</div>
          <p className="mt-1 text-[13px] leading-relaxed text-[#e6e6e1]/85">{epoch.info}</p>
        </div>
        <div>
          <div className="mb-1 text-[12px] text-[#c4bef0]">Fundamental particles created freely in the thermal bath now (kT ≳ mc²/3):</div>
          <div className="flex flex-wrap gap-1">
            {present.length ? present.map((q) => <span key={q.sym} className="rounded-md border border-[#9a92d9]/25 px-1.5 py-0.5 font-hud text-[12px] text-[#f1e9dd]" title={q.name}>{q.sym}</span>)
              : <span className="text-[12px] text-[#c4bef0]">only massless particles (photons, gluons) and relic neutrinos</span>}
          </div>
        </div>
      </Section>
      <Section title="Epochs">
        <ol className="grid gap-1.5 sm:grid-cols-2">
          {eps.map((e) => (
            <li key={e.name}>
              <button type="button" onClick={() => setLogT(Math.log10(Math.max(e.tStart, 5.4e-44) * 1.02))}
                className={`w-full rounded-lg border p-2 text-left transition-colors ${e === epoch ? 'border-[#8642ff]/70 bg-[#8642ff]/15' : 'border-[#9a92d9]/15 hover:border-[#8642ff]/50'}`}>
                <div className="flex justify-between gap-2 text-[13px]"><span className="text-[#f1e9dd]">{e.name}</span><span className="font-hud text-[11.5px] text-[#c4bef0]">{e.tStart ? fmtTime(e.tStart) : '0'}</span></div>
              </button>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

// ───────────────────────── Particles ─────────────────────────

const GROUP_CLS: Record<Particle['group'], string> = {
  quark: 'border-[#a98bff]/40', lepton: 'border-[#5fe0a0]/40', gauge: 'border-[#ffc46a]/40', scalar: 'border-[#ff8a8a]/50',
};
function fmtMass(MeV: number) {
  if (MeV === 0) return '0';
  if (MeV < 1e-3) return `< ${(MeV * 1e6).toPrecision(2)} eV`;
  if (MeV < 1) return `${(MeV * 1e3).toPrecision(4)} keV`;
  if (MeV < 1000) return `${MeV.toPrecision(4)} MeV`;
  return `${(MeV / 1000).toPrecision(4)} GeV`;
}

function ParticlesTab({ physics }: { physics: PhysicsParams }) {
  const cp: CosmoParams = { H0: physics.H0, omegaM: physics.omegaM, omegaL: physics.omegaL, gMult: physics.gMult };
  const [sel, setSel] = useState<Particle | null>(STANDARD_MODEL[16]);
  // time when kT fell to mc²/3 — after this the particle's pairs annihilate / it freezes out
  const freezeOut = (m: number) => {
    if (m <= 1e-3) return null;
    let lo = Math.log(1e-34), hi = Math.log(10);
    for (let i = 0; i < 60; i++) { const mid = 0.5 * (lo + hi); if (kTeV(Math.exp(mid)) > (m * 1e6) / 3) lo = mid; else hi = mid; }
    return timeAtA(Math.exp(0.5 * (lo + hi)), cp);
  };
  const fo = sel ? freezeOut(sel.massMeV) : null;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Section title="The Standard Model" hint="17 fundamental particles (PDG values). Click one.">
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
          {STANDARD_MODEL.map((q) => (
            <button key={q.sym} type="button" onClick={() => setSel(q)}
              className={`rounded-lg border p-2 text-left transition-colors ${GROUP_CLS[q.group]} ${sel === q ? 'bg-[#8642ff]/25' : 'hover:bg-[#8642ff]/10'}`}>
              <div className="font-display text-lg leading-none text-[#f1e9dd]">{q.sym}</div>
              <div className="mt-1 truncate text-[11px] text-[#c4bef0]">{q.name}</div>
              <div className="font-hud text-[11px] text-[#e2ddfb]">{fmtMass(q.massMeV)}</div>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 text-[11.5px] text-[#c4bef0]">
          <span><i className="mr-1 inline-block h-2 w-2 rounded-sm border border-[#a98bff]" />quarks</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-sm border border-[#5fe0a0]" />leptons</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-sm border border-[#ffc46a]" />force carriers</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-sm border border-[#ff8a8a]" />Higgs</span>
        </div>
        <Section title="Built from quarks">
          {COMPOSITES.map((c) => <p key={c.sym} className="text-[12px] text-[#e2ddfb]"><b className="text-[#f1e9dd]">{c.sym} {c.name}</b> ({c.quarks}) · {c.massMeV} MeV — {c.note}</p>)}
          <p className="text-[12px] text-[#c4bef0]">Only ~1 % of the proton’s mass comes from its quarks’ Higgs masses; the rest is the energy of the strong force binding them.</p>
        </Section>
      </Section>
      {sel && (
        <Section title={`${sel.sym} · ${sel.name}`}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            {[['Mass', fmtMass(sel.massMeV)], ['Charge', sel.charge], ['Spin', sel.spin], ['Interacts via', sel.force], ...(sel.gen ? [['Generation', String(sel.gen)]] : []),
              ['Created freely while', sel.massMeV > 1e-3 ? `kT ≳ ${fmtMass(sel.massMeV / 3)}` : 'always (massless or nearly)'],
              ['…until about', fo ? fmtTime(fo) + ' after the Big Bang' : '—']].map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-[#c4bef0]">{k}</dt><dd className="text-right font-hud text-[#f1e9dd]">{v}</dd></div>
            ))}
          </dl>
          {sel.note && <p className="text-[12px] text-[#e2ddfb]">{sel.note}</p>}
          <p className="text-[12px] leading-relaxed text-[#c4bef0]">“Until about” uses this universe’s expansion history: change G or the Ω values and it shifts.</p>
        </Section>
      )}
    </div>
  );
}
