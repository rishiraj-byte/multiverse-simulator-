import { useEffect, useMemo, useRef, useState } from 'react';
import { bateman, monteCarlo, DECAY_SOURCES, lambda } from '@/sim/decay';
import { fmtTime, fmtSci } from '@/sim/laws';
import { Section, SliderRow, Btn } from '../hud/primitives';

const PALETTE = ['#8642ff', '#ffc46a', '#5fe0a0', '#ff8a8a', '#6fb8ff', '#f1e9dd', '#ff9ad5', '#b3e05f', '#e0a05f', '#5fe0d8', '#c9a0ff', '#ffe066', '#9aa0ff', '#ff7f50', '#7fffd4'];
const ATOMS = 2500;

export function DecayTab() {
  const [src, setSrc] = useState('U238');
  const [logT, setLogT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [seed, setSeed] = useState(1);
  const bat = useMemo(() => bateman(src, 1), [src]);
  const mc = useMemo(() => monteCarlo(src, ATOMS, seed), [src, seed]);
  const chain = bat.chain;

  // time range: shortest meaningful → 10 × longest half-life
  const halfs = chain.map((n) => n.halfLife).filter(Number.isFinite);
  const tMin = Math.log10(Math.max(Math.min(...halfs) / 10, 1e-7));
  const tMax = Math.log10(Math.max(...halfs) * 10);
  useEffect(() => { setLogT(tMin); setPlaying(false); }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      setLogT((v) => { const nv = v + dt * (tMax - tMin) / 20; if (nv >= tMax) { setPlaying(false); return tMax; } return nv; });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, tMin, tMax]);

  const t = Math.pow(10, logT);
  const amounts = bat.amounts(t);
  const state = useMemo(() => mc.state(t), [mc, t]);
  const counts = chain.map(() => 0);
  for (const k of state) counts[k]++;

  // atom grid
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const cols = 50, cell = c.width / cols;
    ctx.clearRect(0, 0, c.width, c.height);
    state.forEach((k, i) => {
      ctx.fillStyle = PALETTE[k % PALETTE.length];
      ctx.globalAlpha = isFinite(chain[k].halfLife) ? 1 : 0.55;
      ctx.beginPath(); ctx.arc((i % cols + 0.5) * cell, (Math.floor(i / cols) + 0.5) * cell, cell * 0.38, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }, [state, chain]);

  // Bateman chart (log t, linear fraction)
  const W = 520, H = 200, P = 28;
  const xs = (lt: number) => P + ((lt - tMin) / (tMax - tMin)) * (W - P - 8);
  const ys = (f: number) => H - P + 6 - f * (H - P - 4);
  const curves = useMemo(() => {
    const n = 160;
    const pts = chain.map(() => [] as string[]);
    for (let i = 0; i <= n; i++) {
      const lt = tMin + ((tMax - tMin) * i) / n;
      bat.amounts(Math.pow(10, lt)).forEach((v, k) => pts[k].push(`${i ? 'L' : 'M'}${xs(lt).toFixed(1)},${ys(v).toFixed(1)}`));
    }
    return pts.map((p) => p.join(' '));
  }, [bat, tMin, tMax]); // eslint-disable-line react-hooks/exhaustive-deps

  const activity = bat.activity(t);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5">
        {DECAY_SOURCES.map((s) => <Btn key={s.id} tone={s.id === src ? 'primary' : 'ghost'} onClick={() => setSrc(s.id)}>{s.label}</Btn>)}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Section title={`${ATOMS.toLocaleString('en-US')} individual atoms`} hint="Each atom’s decay time is random (exponential distribution, P(decay in dt) = λ·dt) — watch statistics emerge from chance.">
          <canvas ref={canvas} width={500} height={500} className="aspect-square w-full max-w-[420px] rounded-lg bg-[#050a21]" aria-label="Atom grid coloured by nuclide" />
          <SliderRow label="Time" value={logT} min={tMin} max={tMax} step={0.002} display={fmtTime(t)} onChange={(v) => { setPlaying(false); setLogT(v); }} />
          <div className="flex gap-2">
            <Btn tone="primary" onClick={() => { if (logT >= tMax) setLogT(tMin); setPlaying(!playing); }}>{playing ? 'Pause' : 'Play'}</Btn>
            <Btn onClick={() => setSeed(seed + 1)}>New random atoms</Btn>
          </div>
        </Section>
        <Section title="Exact abundances (Bateman equations)" hint="Analytic solution of dNₖ/dt = −λₖNₖ + Σ branch·λⱼNⱼ. Dots on the left should match these fractions within √N noise.">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Fraction of each nuclide over time">
            <line x1={P} y1={H - P + 6} x2={W - 8} y2={H - P + 6} stroke="#9a92d9" strokeOpacity="0.3" />
            {curves.map((d, k) => <path key={k} d={d} fill="none" stroke={PALETTE[k % PALETTE.length]} strokeWidth="1.6" strokeOpacity={isFinite(chain[k].halfLife) ? 1 : 0.7} />)}
            <line x1={xs(logT)} y1={4} x2={xs(logT)} y2={H - P + 6} stroke="#f1e9dd" strokeDasharray="3 3" />
            <text x={P} y={H - 8} fill="#9a92d9" fontSize="9">{fmtTime(Math.pow(10, tMin))}</text>
            <text x={W - 8} y={H - 8} fill="#9a92d9" fontSize="9" textAnchor="end">{fmtTime(Math.pow(10, tMax))} (log scale)</text>
          </svg>
          <div className="text-[12px] text-[#e2ddfb]">Activity of 1 mol of the parent now: <b className="font-hud text-[#f1e9dd]">{fmtSci(activity * 6.02214076e23)} Bq</b></div>
          <table className="w-full text-[12px]">
            <thead><tr className="text-[#c4bef0]"><th className="text-left font-normal">Nuclide</th><th className="text-right font-normal">Half-life</th><th className="text-right font-normal">Decay</th><th className="text-right font-normal">Exact</th><th className="text-right font-normal">Atoms</th></tr></thead>
            <tbody>
              {chain.map((n, k) => (
                <tr key={n.id} className="border-t border-[#9a92d9]/10">
                  <td className="py-0.5"><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: PALETTE[k % PALETTE.length] }} /><span className="text-[#f1e9dd]">{n.name}</span></td>
                  <td className="text-right font-hud text-[#e2ddfb]">{isFinite(n.halfLife) ? fmtTime(n.halfLife) : 'stable'}</td>
                  <td className="text-right text-[#c4bef0]">{n.decays.map((d) => `${d.mode}${d.br < 1 ? ` ${(d.br * 100).toFixed(1)}%` : ''}`).join(', ') || '—'}</td>
                  <td className="text-right font-hud text-[#f1e9dd]">{amounts[k] < 1e-4 && amounts[k] > 0 ? fmtSci(amounts[k], 2) : (amounts[k] * 100).toFixed(2) + ' %'}</td>
                  <td className="text-right font-hud text-[#e2ddfb]">{counts[k]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11.5px] text-[#c4bef0]">Half-lives: NNDC/ENSDF evaluated data (rounded); branches below ~1 % are omitted. Total decay constant of the parent: λ = {fmtSci(lambda(chain[0]))} s⁻¹.</p>
        </Section>
      </div>
    </div>
  );
}
