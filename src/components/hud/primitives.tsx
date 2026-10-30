import type { ReactNode, ChangeEvent } from 'react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type { InfoRow } from '@/engine/common';

export const panelCls =
  'rounded-2xl border border-[#9a92d9]/25 bg-[#070417]/95 shadow-[0_0_60px_rgba(134,66,255,0.12)] backdrop-blur-xl';

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-[#9a92d9]/15 pt-3 first:border-t-0 first:pt-0">
      <div>
        <h3 className="font-display text-[13px] font-bold tracking-wide text-[#f1e9dd]">{title}</h3>
        {hint && <p className="font-hud text-[11.5px] leading-snug text-[#c4bef0]">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function SliderRow({ label, value, min, max, step, display, onChange, disabled }: {
  label: string; value: number; min: number; max: number; step: number; display: string;
  onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] text-[#e2ddfb]">{label}</span>
        <span className="font-hud text-[12px] tabular-nums text-[#f1e9dd]">{display}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} disabled={disabled}
        onValueChange={([v]) => onChange(v)} aria-label={label} />
    </div>
  );
}

export function ToggleRow({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span>
        <span className="block text-[12px] text-[#e2ddfb]">{label}</span>
        {hint && <span className="block font-hud text-[11px] text-[#c4bef0]">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

export function Btn({ children, onClick, tone = 'ghost', disabled, className = '', title }: {
  children: ReactNode; onClick?: () => void; tone?: 'ghost' | 'primary' | 'danger'; disabled?: boolean; className?: string; title?: string;
}) {
  const tones = {
    ghost: 'border-[#9a92d9]/25 text-[#e6e6e1] hover:border-[#8642ff]/70 hover:bg-[#8642ff]/15',
    primary: 'border-[#8642ff]/60 bg-[#8642ff]/20 text-[#f1e9dd] hover:bg-[#8642ff]/40',
    danger: 'border-[#ff6a6a]/40 text-[#ffb3b3] hover:bg-[#ff6a6a]/15',
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`min-h-[38px] rounded-lg border px-2.5 text-[12px] transition-colors disabled:pointer-events-none disabled:opacity-40 ${tones[tone]} ${className}`}>
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 rounded-lg border border-[#9a92d9]/20 p-1">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
          className={`min-h-[30px] flex-1 rounded-md px-2 text-[12px] transition-colors ${value === o.id ? 'bg-[#8642ff]/35 text-[#f1e9dd]' : 'text-[#c4bef0] hover:text-[#f1e9dd]'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const toneCls = { good: 'text-[#5fe0a0]', warn: 'text-[#ffc46a]', bad: 'text-[#ff8a8a]' };

export function Rows({ rows }: { rows: InfoRow[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
      {rows.map((r) => (
        <div key={r.k} className="contents">
          <dt className="text-[#c4bef0]">{r.k}</dt>
          <dd className={`text-right font-hud tabular-nums ${r.tone ? toneCls[r.tone] : 'text-[#f1e9dd]'}`}>{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Rotation curve v(r): total vs baryons only — the dark-matter signature. */
export function CurveChart({ curve }: { curve: { r: number; total: number; baryon: number }[] }) {
  if (!curve.length) return null;
  const W = 260, H = 110, P = 22;
  const rMax = curve[curve.length - 1].r;
  const vMax = Math.max(...curve.map((c) => Math.max(c.total, c.baryon))) * 1.1 || 1;
  const x = (r: number) => P + (r / rMax) * (W - P - 6);
  const y = (v: number) => H - P + 4 - (v / vMax) * (H - P - 4);
  const path = (k: 'total' | 'baryon') => curve.map((c, i) => `${i ? 'L' : 'M'}${x(c.r).toFixed(1)},${y(c[k]).toFixed(1)}`).join(' ');
  const last = curve[curve.length - 1];
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`Rotation curve: ${Math.round(last.total)} km/s with halo vs ${Math.round(last.baryon)} km/s from visible matter at ${last.r.toFixed(0)} kpc`}>
        <line x1={P} y1={H - P + 4} x2={W - 4} y2={H - P + 4} stroke="#9a92d9" strokeOpacity="0.3" />
        <line x1={P} y1={4} x2={P} y2={H - P + 4} stroke="#9a92d9" strokeOpacity="0.3" />
        <path d={path('baryon')} fill="none" stroke="#f1e9dd" strokeOpacity="0.7" strokeDasharray="4 3" strokeWidth="1.5" />
        <path d={path('total')} fill="none" stroke="#8642ff" strokeWidth="2" />
        <text x={P} y={H - 6} fill="#9a92d9" fontSize="9" fontFamily="JetBrains Mono, monospace">0</text>
        <text x={W - 4} y={H - 6} fill="#9a92d9" fontSize="9" textAnchor="end" fontFamily="JetBrains Mono, monospace">{rMax.toFixed(0)} kpc</text>
        <text x={P + 4} y={12} fill="#9a92d9" fontSize="9" fontFamily="JetBrains Mono, monospace">{Math.round(vMax)} km/s</text>
      </svg>
      <figcaption className="flex gap-3 font-hud text-[11px] text-[#c4bef0]">
        <span><span className="mr-1 inline-block h-0.5 w-3 bg-[#8642ff] align-middle" />with dark halo</span>
        <span><span className="mr-1 inline-block w-3 border-t border-dashed border-[#f1e9dd]/70 align-middle" />visible matter only</span>
      </figcaption>
    </figure>
  );
}

export function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-[12px] text-[#e2ddfb]">
      {label}
      <input type="number" inputMode="numeric" value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(Math.max(0, Math.floor(v))); }}
        className="w-36 rounded-md border border-[#9a92d9]/30 bg-[#050a21] px-2 py-1.5 text-right font-hud text-[12px] text-[#f1e9dd] outline-none focus:border-[#8642ff]" />
    </label>
  );
}
