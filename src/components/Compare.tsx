import { useEffect, useState } from 'react';
import type { Engine, SummaryRow } from '@/engine/Engine';
import { Btn, panelCls } from './hud/primitives';

export interface UniRef { id: number; name: string }

/**
 * Side-by-side readouts of every universe, refreshed twice a second.
 * Divergence: RMS distance between the same bodies in two universes that share a
 * system lineage (forked from the same state). For chaotic systems it grows roughly
 * exponentially — the butterfly effect (Lyapunov instability), not a bug.
 */
export function Compare({ unis, engines, onClose }: { unis: UniRef[]; engines: Map<number, Engine>; onClose: () => void }) {
  const [data, setData] = useState<{ rows: Map<number, SummaryRow[]>; div: Map<number, number | null> }>({ rows: new Map(), div: new Map() });
  useEffect(() => {
    const tick = () => {
      const rows = new Map<number, SummaryRow[]>(), div = new Map<number, number | null>();
      const base = engines.get(unis[0]?.id);
      const bp = base?.bodyPositions();
      for (const u of unis) {
        const e = engines.get(u.id);
        if (!e) continue;
        rows.set(u.id, e.summary());
        if (e === base || !base || !bp || e.systemIdentity() !== base.systemIdentity() || !bp.size) { div.set(u.id, null); continue; }
        let s = 0, n = 0;
        for (const [id, p] of e.bodyPositions()) { const q = bp.get(id); if (q) { s += (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; n++; } }
        div.set(u.id, n ? Math.sqrt(s / n) : null);
      }
      setData({ rows, div });
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [unis, engines]);

  const keys: string[] = [];
  for (const r of data.rows.values()) for (const x of r) if (!keys.includes(x.k)) keys.push(x.k);
  const valueOf = (id: number, k: string) => data.rows.get(id)?.find((x) => x.k === k);
  return (
    <div className={`${panelCls} absolute inset-x-3 bottom-3 z-40 max-h-[45vh] overflow-auto p-3 sm:left-auto sm:right-4 sm:w-[min(760px,calc(100vw-32px))]`} role="region" aria-label="Universe comparison">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-bold text-[#f1e9dd]">Parallel universes</h2>
        <Btn onClick={onClose}>Close</Btn>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-[#c4bef0]"><th className="py-1 font-normal">Quantity</th>{unis.map((u) => <th key={u.id} className="px-2 py-1 text-right font-normal text-[#f1e9dd]">{u.name}</th>)}</tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const vals = unis.map((u) => valueOf(u.id, k)?.v ?? '—');
            const differs = new Set(vals).size > 1;
            return (
              <tr key={k} className="border-t border-[#9a92d9]/10">
                <td className="py-1 text-[#e2ddfb]">{k}</td>
                {unis.map((u, i) => <td key={u.id} className={`px-2 py-1 text-right font-hud tabular-nums ${differs && i > 0 && vals[i] !== vals[0] ? 'text-[#ffc46a]' : 'text-[#f1e9dd]'}`}>{vals[i]}</td>)}
              </tr>
            );
          })}
          <tr className="border-t border-[#9a92d9]/20">
            <td className="py-1 text-[#e2ddfb]" title="RMS distance between the same bodies (same forked system)">Divergence from {unis[0]?.name}</td>
            {unis.map((u, i) => { const d = data.div.get(u.id); return <td key={u.id} className="px-2 py-1 text-right font-hud text-[#f1e9dd]">{i === 0 ? 'reference' : d === null || d === undefined ? 'different system' : `${d.toExponential(2)} u`}</td>; })}
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-[11.5px] leading-relaxed text-[#c4bef0]">Orange = differs from the first universe. Forked systems start identical; tiny differences (even frame timing) grow over time in chaotic systems — the butterfly effect.</p>
    </div>
  );
}
