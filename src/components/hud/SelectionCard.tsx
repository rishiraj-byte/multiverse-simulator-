import type { Engine, SelectionInfo, Level } from '@/engine/Engine';
import { EARTH_MASS_SIM, fmtMass } from '@/sim/astro';
import { Btn, Rows, SliderRow, panelCls } from './primitives';

export function SelectionCard({ sel, engine, level, following, onClose }: {
  sel: SelectionInfo; engine: Engine | null; level: Level; following: boolean; onClose: () => void;
}) {
  const logM = sel.massSim ? Math.log10(sel.massSim / EARTH_MASS_SIM) : 0;
  const editable = sel.editable && level === 'system';
  return (
    <div className={`${panelCls} absolute bottom-20 left-3 z-20 w-[calc(100%-24px)] max-w-[340px] p-4 sm:bottom-5 sm:left-5`}
      role="region" aria-label={`Selected: ${sel.name}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate font-display text-base font-bold tracking-wide text-[#f1e9dd]">{sel.name}</h2>
          <p className="text-[12px] text-[#a98bff]">{sel.kind}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close selection"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#c4bef0] transition-colors hover:bg-[#8642ff]/15 hover:text-white">✕</button>
      </div>
      <p className="mt-2 max-h-24 overflow-y-auto text-[12px] leading-relaxed text-[#e6e6e1]/80">{sel.info}</p>
      <div className="mt-3 max-h-[28vh] overflow-y-auto pr-1"><Rows rows={sel.rows} /></div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {sel.enterLabel && <Btn tone="primary" onClick={() => engine?.enterSelected()}>{sel.enterLabel}</Btn>}
        {sel.travelLabel
          ? <Btn onClick={() => engine?.travelToSelected()}>{sel.travelLabel}</Btn>
          : <Btn onClick={() => engine?.toggleFocus()}>{following ? 'Stop following' : 'Follow'}</Btn>}
        {level === 'map' && !sel.id.startsWith('flow:') && <Btn className="col-span-2" onClick={() => engine?.showOnly(sel.id)} title="Hide everything else in the universe">Show only this</Btn>}
      </div>

      {editable && sel.massSim !== undefined && (
        <div className="mt-3 space-y-3 border-t border-[#9a92d9]/15 pt-3">
          <SliderRow label="Mass" value={logM} min={-2} max={7.5} step={0.01} display={fmtMass(sel.massSim).split(' · ')[0]}
            onChange={(v) => engine?.setSelectedMass(Math.pow(10, v) * EARTH_MASS_SIM)} />
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={() => engine?.kickSelected(0.9)} title="Scale orbital velocity by 0.9">Slow down 10 %</Btn>
            <Btn onClick={() => engine?.kickSelected(1.1)} title="Scale orbital velocity by 1.1">Speed up 10 %</Btn>
            {sel.isPlanet && <Btn onClick={() => engine?.addMoonToSelected()}>Add a moon</Btn>}
            <Btn tone="danger" onClick={() => engine?.deleteSelected()}>Remove</Btn>
          </div>
        </div>
      )}
    </div>
  );
}
