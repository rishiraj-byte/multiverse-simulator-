import { SystemSchema, type SystemSnapshot } from '../sim/systems';
import { DEFAULT_PHYSICS, type PhysicsParams } from '../sim/physics';

const KEY_SAVES = 'cosmos.saves.v2';
const KEY_PHYSICS = 'cosmos.physics.v2';

export interface SaveSlot { id: string; name: string; savedAt: string; snapshot: SystemSnapshot }

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function write(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function listSaves(): SaveSlot[] {
  const raw = read<unknown[]>(KEY_SAVES, []);
  if (!Array.isArray(raw)) return [];
  // drop anything that no longer validates (e.g. edited by hand)
  return raw.filter((s): s is SaveSlot => {
    const slot = s as SaveSlot;
    return typeof slot?.id === 'string' && SystemSchema.safeParse(slot.snapshot).success;
  });
}

export function addSave(name: string, snapshot: SystemSnapshot): SaveSlot[] | null {
  const slot: SaveSlot = { id: `${Date.now().toString(36)}`, name: name.trim() || snapshot.system.name, savedAt: snapshot.savedAt, snapshot };
  const next = [slot, ...listSaves()].slice(0, 30);
  return write(KEY_SAVES, next) ? next : null;
}

export function deleteSave(id: string): SaveSlot[] {
  const next = listSaves().filter((s) => s.id !== id);
  write(KEY_SAVES, next);
  return next;
}

/** Persist preferences, but never the transient pause/reverse state. */
export function loadPhysics(): Partial<PhysicsParams> {
  const p = read<Partial<PhysicsParams>>(KEY_PHYSICS, {});
  const out: Partial<PhysicsParams> = {};
  for (const k of Object.keys(DEFAULT_PHYSICS) as (keyof PhysicsParams)[]) {
    if (k === 'paused' || k === 'reverse') continue;
    if (typeof p[k] === typeof DEFAULT_PHYSICS[k]) (out as Record<string, unknown>)[k] = p[k];
  }
  return out;
}
export function savePhysics(p: PhysicsParams) {
  const { paused: _p, reverse: _r, ...rest } = p;
  void _p; void _r;
  write(KEY_PHYSICS, rest);
}

export function downloadSnapshot(s: SystemSnapshot) {
  const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${s.system.name.replace(/[^\w-]+/g, '_') || 'system'}.cosmos.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseSnapshot(text: string): { ok: true; snapshot: SystemSnapshot } | { ok: false; error: string } {
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { ok: false, error: 'This file is not valid JSON.' }; }
  const r = SystemSchema.safeParse(json);
  if (!r.success) {
    const first = r.error.issues[0];
    return { ok: false, error: `Not a Cosmos system file (${first ? `${first.path.map(String).join('.')}: ${first.message}` : 'schema mismatch'}).` };
  }
  return { ok: true, snapshot: r.data };
}
