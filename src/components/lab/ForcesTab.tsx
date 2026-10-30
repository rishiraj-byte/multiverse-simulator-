import { useEffect, useRef, useState } from 'react';
import { Rng } from '@/sim/rng';
import { Section, SliderRow, Btn } from '../hud/primitives';

// CLASSICAL ANALOGUE — not quantum field theory. Real nuclei and atoms need
// quantum mechanics (the Pauli principle, quantised orbits); this sandbox keeps
// the real *shapes* of the forces so their competition is visible:
//   gravity      F = G m₁m₂ / r²                 (always attractive)
//   electromag.  F = k q₁q₂ / r²                 (like charges repel)
//   strong (res.) Yukawa: V = −g e^{−r/λ}/r between nucleons, plus a hard repulsive core
//   weak         free neutrons β-decay n → p + e⁻ (+ ν̄) with an adjustable half-life;
//                neutrons bound in a nucleus are stable, as in reality.

type Kind = 0 | 1 | 2; // proton, neutron, electron
interface Pt { k: Kind; x: number; y: number; vx: number; vy: number }
const MASS = [1, 1, 0.05], CHARGE = [1, 0, -1];
const SYM = ['n', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca'];
const W = 640, H = 420;

interface Params { G: number; k: number; g: number; range: number; halfLife: number; temp: number; damping: number; np: number; nn: number; ne: number }
const DEFAULTS: Params = { G: 0.5, k: 60, g: 900, range: 9, halfLife: 40, temp: 30, damping: 0.15, np: 50, nn: 50, ne: 40 };

function seedParticles(p: Params, seed: number): Pt[] {
  const rng = new Rng(seed);
  const out: Pt[] = [];
  const add = (k: Kind, n: number) => { for (let i = 0; i < n; i++) out.push({ k, x: rng.range(20, W - 20), y: rng.range(20, H - 20), vx: rng.gauss() * p.temp / Math.sqrt(MASS[k] * 20), vy: rng.gauss() * p.temp / Math.sqrt(MASS[k] * 20) }); };
  add(0, p.np); add(1, p.nn); add(2, p.ne);
  return out;
}

export function ForcesTab() {
  const [p, setP] = useState<Params>(DEFAULTS);
  const [running, setRunning] = useState(true);
  const [seed, setSeed] = useState(7);
  const [census, setCensus] = useState<[string, number][]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pts = useRef<Pt[]>(seedParticles(DEFAULTS, 7));
  const pRef = useRef(p);
  const rng = useRef(new Rng(99));
  pRef.current = p;

  useEffect(() => { pts.current = seedParticles(pRef.current, seed); }, [seed, p.np, p.nn, p.ne]);

  useEffect(() => {
    let raf = 0, frame = 0;
    const step = () => {
      raf = requestAnimationFrame(step);
      const prm = pRef.current, P = pts.current, n = P.length;
      const dt = 0.016, sub = 4, h = dt / sub, eps2 = 9;
      // cluster membership (for β-decay stability and the census)
      const parent = P.map((_, i) => i);
      const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      const bond = prm.range * 1.6;
      for (let i = 0; i < n; i++) if (P[i].k !== 2) for (let j = i + 1; j < n; j++) if (P[j].k !== 2) {
        const dx = P[j].x - P[i].x, dy = P[j].y - P[i].y;
        if (dx * dx + dy * dy < bond * bond) parent[find(i)] = find(j);
      }
      const size = new Map<number, number>();
      for (let i = 0; i < n; i++) if (P[i].k !== 2) size.set(find(i), (size.get(find(i)) ?? 0) + 1);

      if (running) {
        for (let s = 0; s < sub; s++) {
          const ax = new Float64Array(n), ay = new Float64Array(n);
          for (let i = 0; i < n; i++) {
            const a = P[i];
            for (let j = i + 1; j < n; j++) {
              const b = P[j];
              const dx = b.x - a.x, dy = b.y - a.y;
              const r2 = dx * dx + dy * dy + eps2, r = Math.sqrt(r2);
              // positive F = attraction toward the other particle
              let F = prm.G * MASS[a.k] * MASS[b.k] / r2 - prm.k * CHARGE[a.k] * CHARGE[b.k] / r2;
              if (a.k !== 2 && b.k !== 2) {
                F += prm.g * Math.exp(-r / prm.range) * (1 / r2 + 1 / (prm.range * r));
                const core = prm.range * 0.45;
                if (r < core) F -= 4000 * (core - r);
              }
              const fx = (F * dx) / r, fy = (F * dy) / r;
              ax[i] += fx / MASS[a.k]; ay[i] += fy / MASS[a.k];
              ax[j] -= fx / MASS[b.k]; ay[j] -= fy / MASS[b.k];
            }
          }
          const damp = Math.exp(-prm.damping * h);
          for (let i = 0; i < n; i++) {
            const q = P[i];
            q.vx = (q.vx + ax[i] * h) * damp; q.vy = (q.vy + ay[i] * h) * damp;
            const vmax = 400; const v = Math.hypot(q.vx, q.vy); if (v > vmax) { q.vx *= vmax / v; q.vy *= vmax / v; }
            q.x += q.vx * h; q.y += q.vy * h;
            if (q.x < 4) { q.x = 4; q.vx = Math.abs(q.vx); } if (q.x > W - 4) { q.x = W - 4; q.vx = -Math.abs(q.vx); }
            if (q.y < 4) { q.y = 4; q.vy = Math.abs(q.vy); } if (q.y > H - 4) { q.y = H - 4; q.vy = -Math.abs(q.vy); }
          }
        }
        // weak force: free neutrons decay, P = 1 − 2^(−dt/T½)
        const pDecay = 1 - Math.pow(2, -dt / Math.max(prm.halfLife, 0.01));
        for (let i = 0; i < n; i++) {
          const q = P[i];
          if (q.k === 1 && (size.get(find(i)) ?? 1) === 1 && rng.current.next() < pDecay) {
            q.k = 0;
            const ang = rng.current.range(0, Math.PI * 2);
            P.push({ k: 2, x: q.x, y: q.y, vx: Math.cos(ang) * 220, vy: Math.sin(ang) * 220 });
          }
        }
      }

      // draw
      const ctx = canvas.current?.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#050a21'; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(255,196,106,0.35)'; ctx.lineWidth = 1;
        for (let i = 0; i < n; i++) if (P[i].k !== 2) for (let j = i + 1; j < n; j++) if (P[j].k !== 2) {
          const dx = P[j].x - P[i].x, dy = P[j].y - P[i].y;
          if (dx * dx + dy * dy < bond * bond * 0.6) { ctx.beginPath(); ctx.moveTo(P[i].x, P[i].y); ctx.lineTo(P[j].x, P[j].y); ctx.stroke(); }
        }
        for (const q of P) {
          ctx.fillStyle = q.k === 0 ? '#ff6a6a' : q.k === 1 ? '#c9c9d6' : '#5fd8ff';
          ctx.beginPath(); ctx.arc(q.x, q.y, q.k === 2 ? 2 : 4, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (++frame % 20 === 0) {
        const comp = new Map<number, { Z: number; A: number }>();
        for (let i = 0; i < P.length; i++) if (P[i].k !== 2) {
          const r = find(Math.min(i, n - 1));
          const c = comp.get(r) ?? { Z: 0, A: 0 };
          c.A++; if (P[i].k === 0) c.Z++;
          comp.set(r, c);
        }
        const tally = new Map<string, number>();
        for (const { Z, A } of comp.values()) {
          const name = Z === 0 ? (A === 1 ? 'free neutron' : `${A} neutrons`) : `${SYM[Z] ?? `Z${Z}`}-${A}`;
          tally.set(name, (tally.get(name) ?? 0) + 1);
        }
        setCensus([...tally.entries()].sort((x, y) => y[1] - x[1]).slice(0, 14));
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const set = (q: Partial<Params>) => setP((x) => ({ ...x, ...q }));
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <canvas ref={canvas} width={W} height={H} className="w-full rounded-lg border border-[#9a92d9]/20" aria-label="Particle sandbox: protons red, neutrons grey, electrons blue" />
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#c4bef0]">
          <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#ff6a6a]" />proton</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#c9c9d6]" />neutron</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#5fd8ff]" />electron</span>
          <span className="ml-auto flex gap-2">
            <Btn onClick={() => setRunning(!running)}>{running ? 'Pause' : 'Run'}</Btn>
            <Btn tone="primary" onClick={() => setSeed(seed + 1)}>Restart</Btn>
            <Btn onClick={() => setP(DEFAULTS)}>Defaults</Btn>
          </span>
        </div>
        <div className="rounded-lg border border-[#ffc46a]/30 bg-[#ffc46a]/10 p-2 text-[12px] leading-relaxed text-[#ffe2b0]">
          Classical analogue, not quantum mechanics: it shows how the forces compete (short-range strong attraction vs long-range electric repulsion, β-decay of free neutrons), but binding energies and which isotopes are stable are not realistic. Exact quantum simulation of even ~50 interacting particles is beyond any computer.
        </div>
      </div>
      <div className="space-y-4">
        <Section title="Forces" hint="Real gravity between protons is ~10³⁶× weaker than electromagnetism; here it is exaggerated so you can see it.">
          <SliderRow label="Gravity G" value={p.G} min={0} max={50} step={0.1} display={p.G.toFixed(1)} onChange={(v) => set({ G: v })} />
          <SliderRow label="Electromagnetism k" value={p.k} min={0} max={300} step={1} display={p.k.toFixed(0)} onChange={(v) => set({ k: v })} />
          <SliderRow label="Strong force g" value={p.g} min={0} max={3000} step={10} display={p.g.toFixed(0)} onChange={(v) => set({ g: v })} />
          <SliderRow label="Strong-force range λ" value={p.range} min={3} max={25} step={0.5} display={p.range.toFixed(1)} onChange={(v) => set({ range: v })} />
          <SliderRow label="Free-neutron half-life (weak)" value={p.halfLife} min={1} max={300} step={1} display={`${p.halfLife.toFixed(0)} s (real: 10.2 min)`} onChange={(v) => set({ halfLife: v })} />
          <SliderRow label="Temperature" value={p.temp} min={0} max={200} step={1} display={p.temp.toFixed(0)} onChange={(v) => set({ temp: v })} />
          <SliderRow label="Cooling (damping)" value={p.damping} min={0} max={2} step={0.01} display={p.damping.toFixed(2)} onChange={(v) => set({ damping: v })} />
        </Section>
        <Section title="Particles" hint="Changing counts restarts">
          <SliderRow label="Protons" value={p.np} min={0} max={120} step={1} display={String(p.np)} onChange={(v) => set({ np: Math.round(v) })} />
          <SliderRow label="Neutrons" value={p.nn} min={0} max={120} step={1} display={String(p.nn)} onChange={(v) => set({ nn: Math.round(v) })} />
          <SliderRow label="Electrons" value={p.ne} min={0} max={120} step={1} display={String(p.ne)} onChange={(v) => set({ ne: Math.round(v) })} />
        </Section>
        <Section title="Nuclei right now">
          <ul className="grid grid-cols-2 gap-1 text-[12px]">
            {census.map(([k, v]) => <li key={k} className="flex justify-between rounded border border-[#9a92d9]/15 px-2 py-1"><span className="text-[#f1e9dd]">{k}</span><span className="font-hud text-[#e2ddfb]">×{v}</span></li>)}
          </ul>
          <p className="text-[11.5px] text-[#c4bef0]">Try: strong force 0 → nothing binds. Electromagnetism ×3 → big nuclei fly apart. Long neutron half-life + cold → heavier clusters.</p>
        </Section>
      </div>
    </div>
  );
}
