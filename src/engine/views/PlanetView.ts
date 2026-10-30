import * as THREE from 'three';
import type { View, FrameCtx, LabelSpec, SelectionInfo, LevelStats } from '../common';
import { glowSprite, disposeTree } from '../common';
import { buildBodyMesh, type SystemView } from './SystemView';
import { glowTexture } from '../../sim/textures';
import type { PhysicsParams } from '../../sim/physics';

const PLANET_R = 2;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class PlanetView implements View {
  readonly group = new THREE.Group();
  readonly planetId: string;
  private sys: SystemView;
  private planet: THREE.Mesh;
  private moons = new Map<string, THREE.Mesh>();
  private moonKey = '';
  private k: number;
  private sun: THREE.DirectionalLight;
  private sunSprite: THREE.Sprite;
  lost = false;
  labelsVersion = 0;

  constructor(sys: SystemView, planetId: string) {
    this.sys = sys;
    this.planetId = planetId;
    const def = sys.bodyDef(planetId)!;
    this.k = PLANET_R / def.radius;
    this.planet = buildBodyMesh(def, false, PLANET_R);
    this.group.add(this.planet);

    if (def.tex === 'earth' || def.tex === 'gas' || def.tex === 'ice') {
      const atmo = glowSprite(glowTexture('rgba(140,190,255,1)'), def.tex === 'gas' ? 0xffd9a0 : 0x8cbcff, PLANET_R * 3.1, 0.35);
      this.group.add(atmo);
    }
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
    this.group.add(this.sun);
    this.sunSprite = glowSprite(glowTexture(), 0xffe6b0, 9);
    this.group.add(this.sunSprite);
    this.syncMoons();
  }

  private moonIds(): string[] {
    return this.sys.bodyList().filter((b) => b.kind === 'moon' && this.sys.bodyDef(b.id)?.parentId === this.planetId).map((b) => b.id);
  }

  private syncMoons() {
    const ids = this.moonIds();
    const key = ids.join('|');
    if (key === this.moonKey) return;
    this.moonKey = key;
    for (const [id, m] of this.moons) if (!ids.includes(id)) { this.group.remove(m); disposeTree(m); this.moons.delete(id); }
    for (const id of ids) {
      if (this.moons.has(id)) continue;
      const d = this.sys.bodyDef(id)!;
      const m = buildBodyMesh(d, false, Math.max(d.radius * this.k, 0.12));
      this.moons.set(id, m);
      this.group.add(m);
    }
    this.labelsVersion++;
  }

  update(ctx: FrameCtx) {
    if (this.sys.target(this.planetId, _a) === null) { this.lost = true; return; }
    this.planet.rotation.y += ctx.dtReal * 0.12;
    if (this.sys.starDirection(this.planetId, _b)) {
      this.sun.position.copy(_b).multiplyScalar(50);
      this.sunSprite.position.copy(_b).multiplyScalar(140);
    }
    this.syncMoons();
    for (const [id, m] of this.moons) {
      if (this.sys.target(id, _b) === null) continue;
      m.position.copy(_b).sub(_a).multiplyScalar(this.k);
      m.rotation.y += ctx.dtReal * 0.2;
    }
  }

  pick(nx: number, ny: number, cam: THREE.PerspectiveCamera, w: number, h: number): string | null {
    const objs: [string, THREE.Mesh][] = [[this.planetId, this.planet], ...this.moons];
    const px = ((nx + 1) / 2) * w, py = ((1 - ny) / 2) * h;
    let best: string | null = null, bestD = Infinity;
    for (const [id, mesh] of objs) {
      _b.copy(mesh.position).project(cam);
      if (_b.z > 1) continue;
      const d = Math.hypot(((_b.x + 1) / 2) * w - px, ((1 - _b.y) / 2) * h - py);
      const lim = id === this.planetId ? 120 : 24;
      if (d < lim && d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  target(id: string, out: THREE.Vector3): number | null {
    if (id === this.planetId) { out.set(0, 0, 0); return PLANET_R; }
    const m = this.moons.get(id);
    if (!m) return null;
    out.copy(m.position);
    return (m.geometry as THREE.SphereGeometry).parameters.radius;
  }

  info(id: string): SelectionInfo | null {
    const i = this.sys.info(id);
    return i ? { ...i, enterLabel: null } : null;
  }

  labels(): LabelSpec[] {
    const out: LabelSpec[] = [];
    const def = this.sys.bodyDef(this.planetId);
    const top = new THREE.Vector3(0, PLANET_R * 1.25, 0);
    if (def) out.push({ id: this.planetId, text: def.name, cls: 'major', pos: () => top });
    for (const [id, m] of this.moons) out.push({ id, text: this.sys.bodyDef(id)?.name ?? id, cls: 'minor', pos: () => m.position });
    return out;
  }

  stats(p: PhysicsParams): LevelStats {
    const s = this.sys.stats(p);
    const ids = new Set([this.planetId, ...this.moons.keys()]);
    return { rows: s.rows.slice(0, 1), bodies: s.bodies?.filter((b) => ids.has(b.id)).map((b) => ({ ...b, depth: b.id === this.planetId ? 0 : 1 })) };
  }

  dispose() { disposeTree(this.group); this.group.clear(); }
}
