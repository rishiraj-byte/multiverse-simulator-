import * as THREE from 'three';
import type { View, FrameCtx, LabelSpec, SelectionInfo, LevelStats } from '../common';
import { pickPoints, glowSprite, pointsMaterial, disposeTree } from '../common';
import {
  generateGalaxy, updateGalaxy, applyDarkMatter, placeNamedStars, starClass, massModel, vCirc,
  rotationCurve, MW_NAMED, GALAXY_SCENE_RADIUS, type GalaxyField, type GalaxyParams, type NamedStar,
} from '../../sim/galaxy';
import { CLASS_INFO, type SpectralClass } from '../../sim/astro';
import { hashSeed } from '../../sim/rng';
import { glowTexture, softDotTexture } from '../../sim/textures';
import type { PhysicsParams } from '../../sim/physics';

/** Galaxy-level clock: Myr per sim-second. */
/** Default galactic clock (Myr per sim-second); live value is PhysicsParams.galaxyRate. */
export const MYR_PER_SIM_S = 1;
const LY_PER_KPC = 3261.56;

export interface StarEntry { seed: number; name: string; cls: SpectralClass; preset?: string }

export class GalaxyView implements View {
  readonly group = new THREE.Group();
  field: GalaxyField;
  readonly params: GalaxyParams;
  private pts: THREE.Points;
  private young: THREE.Points | null = null;
  private named = new Map<number, NamedStar>();
  private namedSprites = new Map<number, THREE.Sprite>();
  timeMyr = 0;

  constructor(params: GalaxyParams, dm: number, isMilkyWay: boolean) {
    this.params = params;
    this.field = generateGalaxy(params, dm);
    if (isMilkyWay) this.named = placeNamedStars(this.field, MW_NAMED);
    updateGalaxy(this.field, 0);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.field.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.field.colors, 3));
    this.pts = new THREE.Points(geo, pointsMaterial(softDotTexture(), 1.45));
    this.pts.frustumCulled = false;
    this.group.add(this.pts);

    if (this.field.youngCount > 0) {
      const yg = new THREE.BufferGeometry();
      yg.setAttribute('position', new THREE.BufferAttribute(this.field.youngPositions, 3));
      yg.setAttribute('color', new THREE.BufferAttribute(this.field.youngColors, 3));
      this.young = new THREE.Points(yg, pointsMaterial(softDotTexture(), 2.6, 0.9));
      this.young.frustumCulled = false;
      this.group.add(this.young);
    }

    const coreColor = params.type === 'elliptical' ? 0xffd9a0 : 0xfff0d6;
    this.group.add(glowSprite(glowTexture('rgba(255,240,214,1)'), coreColor, params.type === 'elliptical' ? 80 : 46));

    for (const [idx] of this.named) {
      const spr = glowSprite(glowTexture(), 0xfff3d0, 4.2);
      this.namedSprites.set(idx, spr);
      this.group.add(spr);
    }
    this.syncSprites();
  }

  private syncSprites() {
    const p = this.field.positions;
    for (const [idx, spr] of this.namedSprites) spr.position.set(p[idx * 3], p[idx * 3 + 1], p[idx * 3 + 2]);
  }

  update(ctx: FrameCtx) {
    applyDarkMatter(this.field, ctx.physics.darkMatter, ctx.physics.gMult);
    const dMyr = ctx.simDt * ctx.physics.galaxyRate;
    if (dMyr === 0) return;
    this.timeMyr += dMyr;
    updateGalaxy(this.field, dMyr);
    (this.pts.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    if (this.young) (this.young.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.syncSprites();
  }

  /** Fast-forward (used when forking a universe): positions are analytic in time. */
  advance(dMyr: number, dm: number, gMult: number) {
    applyDarkMatter(this.field, dm, gMult);
    this.timeMyr += dMyr;
    updateGalaxy(this.field, dMyr);
    (this.pts.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    if (this.young) (this.young.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.syncSprites();
  }

  pick(nx: number, ny: number, cam: THREE.PerspectiveCamera, w: number, h: number): string | null {
    // named systems get a generous hit radius first
    const p = this.field.positions;
    let bestNamed = -1, bestD = 22;
    const v = new THREE.Vector3();
    for (const idx of this.named.keys()) {
      v.set(p[idx * 3], p[idx * 3 + 1], p[idx * 3 + 2]).project(cam);
      if (v.z > 1) continue;
      const d = Math.hypot(((v.x - nx) / 2) * w, ((v.y - ny) / 2) * h);
      if (d < bestD) { bestD = d; bestNamed = idx; }
    }
    if (bestNamed >= 0) return `s:${bestNamed}`;
    v.set(0, 0, 0).project(cam); // galactic nucleus → its supermassive black hole
    if (v.z <= 1 && Math.hypot(((v.x - nx) / 2) * w, ((v.y - ny) / 2) * h) < 26) return 'core';
    const i = pickPoints(p, this.field.count, this.pts.matrixWorld, cam, nx, ny, w, h, 10);
    return i >= 0 ? `s:${i}` : null;
  }

  indexOf(id: string) { return id.startsWith('s:') ? Number(id.slice(2)) : -1; }

  /** Supermassive black hole mass: Sgr A* for the Milky Way, else M_BH ≈ 0.0014·M_bulge (Häring & Rix 2004). */
  smbhMass(): number {
    if (this.params.name === 'Milky Way') return 4.297e6;
    const mm = massModel(this.params);
    return Math.max(0.0014 * mm.Mb, 1e5);
  }

  target(id: string, out: THREE.Vector3): number | null {
    if (id === 'core') { out.set(0, 0, 0); return 6; }
    const i = this.indexOf(id);
    if (i < 0 || i >= this.field.count) return null;
    out.set(this.field.positions[i * 3], this.field.positions[i * 3 + 1], this.field.positions[i * 3 + 2]);
    return 1.2;
  }

  /** What system lives at star index i. */
  starEntry(i: number): StarEntry {
    const n = this.named.get(i);
    const cls = starClass(this.field, i);
    if (n) return { seed: hashSeed(this.params.seed, i), name: n.name, cls, preset: n.preset };
    const seed = hashSeed(this.params.seed, i, 0x57a2);
    const prefix = this.params.name === 'Milky Way' ? 'MW' : this.params.name.replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'GX';
    return { seed, name: `${prefix}-${i.toString(36).toUpperCase()}`, cls };
  }

  info(id: string): SelectionInfo | null {
    if (id === 'core') {
      const m = this.smbhMass();
      const mw = this.params.name === 'Milky Way';
      return {
        id, name: mw ? 'Sagittarius A*' : `${this.params.name} nucleus`, kind: 'Supermassive black hole',
        info: mw ? 'The Milky Way’s central black hole, 26 000 ly from Earth. Stars like S2 orbit it in years.' : `Central black hole estimated from the bulge mass with the M_BH–M_bulge relation (Häring & Rix 2004, ~0.14 %).`,
        rows: [{ k: 'Mass', v: `${(m / 1e6).toPrecision(3)} million M☉` }, { k: 'Event horizon', v: `${(m * 2.953).toExponential(2)} km` }],
        enterLabel: 'Approach the nucleus', editable: false,
      };
    }
    const i = this.indexOf(id);
    if (i < 0 || i >= this.field.count) return null;
    const e = this.starEntry(i);
    const named = this.named.get(i);
    const rKpc = Math.hypot(this.field.positions[i * 3], this.field.positions[i * 3 + 2]) * this.field.unitKpc;
    const mm = massModel(this.params);
    const dm = this.field.dmApplied;
    const v = vCirc(Math.max(rKpc, 0.05), mm, dm);
    const periodMyr = (2 * Math.PI * Math.max(rKpc, 0.05)) / v / 1.0227e-3;
    const ci = CLASS_INFO[e.cls];
    const mode = this.field.mode[i];
    return {
      id, name: e.name, kind: `${e.cls}-type star${mode === 1 ? ' · bulge/halo orbit' : mode === 2 ? ' · bar' : ''}`,
      info: named?.note ?? `Main-sequence ${e.cls} star (${ci.tMin.toLocaleString('en-US')}–${ci.tMax.toLocaleString('en-US')} K, ${ci.mMin}–${ci.mMax} M☉). Its planets are generated from its own seed when you enter.`,
      rows: [
        { k: 'Galactocentric radius', v: `${rKpc.toFixed(2)} kpc · ${Math.round(rKpc * LY_PER_KPC).toLocaleString('en-US')} ly` },
        { k: 'Circular speed v(r)', v: `${v.toFixed(0)} km/s` },
        { k: 'Galactic year', v: `${periodMyr.toFixed(0)} Myr` },
      ],
      enterLabel: 'Enter system', editable: false,
    };
  }

  labels(): LabelSpec[] {
    const out: LabelSpec[] = [];
    for (const [idx, n] of this.named) {
      out.push({ id: `s:${idx}`, text: n.name, cls: n.id === 'sol' ? 'major' : '', pos: () => this.namedSprites.get(idx)!.position });
    }
    const c = new THREE.Vector3();
    out.push({ id: 'core', text: this.params.type === 'elliptical' ? 'Core' : this.params.name === 'Milky Way' ? 'Sagittarius A*' : 'Nucleus', cls: 'minor', pos: () => c });
    return out;
  }

  stats(p: PhysicsParams): LevelStats {
    const curve = rotationCurve(this.params, p.darkMatter, 40).map((c) => ({ r: c.rKpc, total: c.vTotal, baryon: c.vBaryon }));
    const kmsPerKpc = this.field.patternSpeed / 1.0227e-3;
    return {
      rows: [
        { k: 'Galactic time', v: `${this.timeMyr.toFixed(0)} Myr` },
        { k: 'Stars drawn', v: (this.field.count + this.field.youngCount).toLocaleString('en-US') },
        { k: 'Radius', v: `${this.params.radiusKpc.toFixed(1)} kpc · ${Math.round(this.params.radiusKpc * LY_PER_KPC).toLocaleString('en-US')} ly` },
        ...(this.field.youngCount ? [{ k: 'Arm pattern speed', v: `${kmsPerKpc.toFixed(1)} km/s/kpc` }] : []),
      ],
      curve,
    };
  }

  get sceneRadius() { return GALAXY_SCENE_RADIUS; }

  dispose() { disposeTree(this.group); this.group.clear(); }
}
