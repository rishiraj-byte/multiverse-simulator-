import { useMemo, useState } from 'react';
import { blackHole, fmtSci, fmtTime, type Laws } from '@/sim/laws';
import { Section, SliderRow, Btn } from '../hud/primitives';

const PRESETS: { label: string; m: number; spin: number; note: string }[] = [
  { label: 'Primordial (10¹² kg)', m: 1e12 / 1.989e30, spin: 0, note: 'Hypothetical black hole from the early universe; would be evaporating right about now.' },
  { label: 'Cygnus X-1', m: 21.2, spin: 0.95, note: 'First black hole ever identified (1971–72). 21.2 M☉ (Miller-Jones et al. 2021), spin > 0.95.' },
  { label: 'GW150914 remnant', m: 62, spin: 0.67, note: 'Product of the first gravitational-wave detection (LIGO 2015): two holes of 36 and 29 M☉ merged, radiating 3 M☉ as gravitational waves.' },
  { label: 'Sagittarius A*', m: 4.297e6, spin: 0.9, note: 'The Milky Way’s centre (GRAVITY 2022). Spin is uncertain; EHT models favour a high value.' },
  { label: 'M87*', m: 6.5e9, spin: 0.9, note: 'First black hole imaged (EHT 2019). Spin uncertain.' },
  { label: 'TON 618 (estimate)', m: 4e10, spin: 0.9, note: 'Among the most massive known; the mass estimate is uncertain (tens of billions of M☉).' },
];

export function BlackHoleTab({ laws, gMult }: { laws: Laws; gMult: number }) {
  const [logM, setLogM] = useState(Math.log10(21.2));
  const [spin, setSpin] = useState(0.95);
  const [note, setNote] = useState(PRESETS[1].note);
  const M = Math.pow(10, logM);
  const b = useMemo(() => blackHole(M, spin, laws, gMult), [M, spin, laws, gMult]);
  const km = (m: number) => (m < 1 ? `${fmtSci(m * 1000)} mm` : m < 1e3 ? `${m.toPrecision(3)} m` : `${fmtSci(m / 1e3)} km`);
  const rg = b.rsM / 2;

  // diagram in units of r_g, scaled to fit the ISCO (retrograde) ring
  const S = 300, c = S / 2, unit = (S * 0.42) / Math.max(b.iscoRetro / rg, b.shadowR / rg);
  const rows: [string, string, string?][] = [
    ['Mass', `${fmtSci(M)} M☉ · ${fmtSci(M * 1.989e30)} kg`],
    ['Event horizon r₊', km(b.rPlus), spin > 0 ? `Schwarzschild r_s = ${km(b.rsM)}` : undefined],
    ['Inner (Cauchy) horizon r₋', spin > 0 ? km(b.rMinus) : '— (non-rotating)'],
    ['Photon sphere (non-rotating)', km(b.photonSphere)],
    ['Shadow radius (non-rotating)', km(b.shadowR), '√27·GM/c² ≈ 2.6 r_s — what the EHT images show'],
    ['ISCO prograde · retrograde', `${km(b.iscoPro)} · ${km(b.iscoRetro)}`, 'Innermost stable circular orbit (Bardeen et al. 1972)'],
    ['Accretion efficiency', `${(b.efficiency * 100).toFixed(1)} % of rest mass → light`, 'Fusion manages 0.7 %'],
    ['Eddington luminosity', `${fmtSci(b.eddingtonW / 3.828e26)} L☉`],
    ['Hawking temperature', `${fmtSci(b.hawkingK)} K`, b.hawkingK < 2.7255 ? 'Colder than the CMB → absorbs more than it emits today' : 'Hotter than the CMB → net evaporation'],
    ['Hawking power', `${fmtSci(b.hawkingW)} W`],
    ['Evaporation time', fmtTime(b.evapYears * 3.15576e7), 'Photon-only Page estimate; the universe is 1.38×10¹⁰ yr old'],
    ['Tidal stretch at horizon', `${fmtSci(b.tidal / 9.81)} g over 2 m`, b.tidal > 1e4 ? 'Spaghettified before reaching the horizon' : 'You would cross the horizon intact'],
    ['Mean density inside r_s', `${fmtSci(b.density)} kg/m³`, 'Supermassive holes can be less dense than water'],
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-4">
        <Section title="Build a black hole" hint="Kerr (rotating) black hole. Uses this universe’s G, c, ħ, α and particle masses.">
          <SliderRow label="Mass" value={logM} min={-19} max={11} step={0.01} display={`${fmtSci(M)} M☉`} onChange={(v) => { setLogM(v); setNote(''); }} />
          <SliderRow label="Spin a*" value={spin} min={0} max={0.998} step={0.001} display={spin.toFixed(3)} onChange={(v) => { setSpin(v); setNote(''); }} />
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((pr) => <Btn key={pr.label} onClick={() => { setLogM(Math.log10(pr.m)); setSpin(pr.spin); setNote(pr.note); }}>{pr.label}</Btn>)}
          </div>
          {note && <p className="text-[12px] leading-relaxed text-[#e2ddfb]">{note}</p>}
        </Section>
        <svg viewBox={`0 0 ${S} ${S}`} className="mx-auto w-full max-w-[340px]" role="img" aria-label="Black hole structure: shadow, photon sphere, horizons and ISCO">
          <defs>
            <radialGradient id="disk" cx="50%" cy="50%" r="50%"><stop offset="0.3" stopColor="#ffe9c0" /><stop offset="0.7" stopColor="#ff8a3d" /><stop offset="1" stopColor="#ff3d00" stopOpacity="0" /></radialGradient>
            <linearGradient id="beam" x1="0" x2="1"><stop offset="0" stopColor="#fff" stopOpacity="0.9" /><stop offset="1" stopColor="#fff" stopOpacity="0.15" /></linearGradient>
            <mask id="dm"><rect width={S} height={S} fill="url(#beam)" /></mask>
          </defs>
          <ellipse cx={c} cy={c} rx={unit * (b.iscoPro / rg) * 3.2} ry={unit * (b.iscoPro / rg) * 0.75} fill="url(#disk)" mask="url(#dm)" opacity="0.85" />
          <circle cx={c} cy={c} r={unit * (b.shadowR / rg)} fill="#000" stroke="#ffcf8a" strokeOpacity="0.9" strokeWidth="2" />
          <circle cx={c} cy={c} r={unit * (b.iscoRetro / rg)} fill="none" stroke="#9a92d9" strokeOpacity="0.5" strokeDasharray="4 4" />
          <circle cx={c} cy={c} r={unit * (b.iscoPro / rg)} fill="none" stroke="#5fe0a0" strokeOpacity="0.8" strokeDasharray="3 3" />
          <circle cx={c} cy={c} r={unit * 3} fill="none" stroke="#ffc46a" strokeOpacity="0.6" />
          <circle cx={c} cy={c} r={unit * (b.rPlus / rg)} fill="#05010f" stroke="#8642ff" strokeWidth="1.5" />
          <text x="8" y="14" fill="#ffcf8a" fontSize="9">— shadow edge</text>
          <text x="8" y="26" fill="#ffc46a" fontSize="9">— photon sphere</text>
          <text x="8" y="38" fill="#5fe0a0" fontSize="9">-- ISCO prograde</text>
          <text x="8" y="50" fill="#9a92d9" fontSize="9">-- ISCO retrograde</text>
          <text x="8" y="62" fill="#8642ff" fontSize="9">● event horizon</text>
          <text x={S - 8} y={S - 8} fill="#9a92d9" fontSize="9" textAnchor="end">brighter side: Doppler beaming</text>
        </svg>
      </div>
      <Section title="Properties">
        <dl className="space-y-1.5">
          {rows.map(([k, v, n]) => (
            <div key={k} className="rounded-lg border border-[#9a92d9]/15 p-2">
              <div className="flex items-baseline justify-between gap-3 text-[13px]"><dt className="text-[#e2ddfb]">{k}</dt><dd className="text-right font-hud text-[#f1e9dd]">{v}</dd></div>
              {n && <p className="mt-0.5 text-[11.5px] text-[#c4bef0]">{n}</p>}
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}
