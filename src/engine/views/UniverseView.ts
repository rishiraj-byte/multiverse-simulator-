import * as THREE from 'three';
import type { View, FrameCtx, LabelSpec, SelectionInfo, LevelStats, InfoRow } from '../common';
import { pickPoints, glowSprite, pointsMaterial, disposeTree } from '../common';
import {
  generateUniverse, applyScale, galaxyName, NAMED_GALAXIES, TYPE_LIST,
  type UniverseField, type UniverseParams,
} from '../../sim/universe';
import { CosmicClock, MPC_PER_UNIT, MLY_PER_MPC, cmbTemperature, type CosmoParams } from '../../sim/cosmology';
import { glowTexture, softDotTexture } from '../../sim/textures';
import { fmtNum } from '../../sim/astro';
import type { PhysicsParams } from '../../sim/physics';

/** Universe-level clock: Gyr of cosmic time per sim-second. */
export const GYR_PER_SIM_S = 0.05; // default; live value is PhysicsParams.cosmicRate
const C_KMS = 299792.458;

const TYPE_LABEL = { spiral: 'Spiral galaxy', barred: 'Barred spiral galaxy', elliptical: 'Elliptical galaxy', irregular: 'Irregular galaxy' };

export class UniverseView implements View {
  readonly group = new THREE.Group();
  field: UniverseField;
  clock: CosmicClock;
  private pts: THREE.Points;
  private horizon: THREE.Mesh;
  private markers = new Map<number, THREE.Sprite>();
  private lastA = -1;

  constructor(params: UniverseParams, cosmo: CosmoParams) {
    this.field = generateUniverse(params);
    this.clock = new CosmicClock(cosmo);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.field.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.field.colors, 3));
    this.pts = new THREE.Points(geo, pointsMaterial(softDotTexture(), 9));
    this.pts.frustumCulled = false;
    this.group.add(this.pts);

    this.horizon = new THREE.Mesh(
      new THREE.SphereGeometry(1000, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0x362669, wireframe: true, transparent: true, opacity: 0.05, depthWrite: false }),
    );
    this.group.add(this.horizon);

    for (const n of NAMED_GALAXIES) {
      const spr = glowSprite(glowTexture(), n.index === 0 ? 0xfff3d0 : 0x9ab8ff, n.index === 0 ? 46 : 28);
      this.markers.set(n.index, spr);
      this.group.add(spr);
    }
    this.syncPositions(true);
  }

  private syncPositions(force = false) {
    const a = this.clock.a;
    if (!force && Math.abs(a - this.lastA) < 1e-6) return;
    this.lastA = a;
    applyScale(this.field, a);
    (this.pts.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.horizon.scale.setScalar(a);
    // galaxies only exist after cosmic dawn: fade in between z ≈ 15 and z ≈ 6
    const t = Math.min(Math.max((a - 1 / 16) / (1 / 7 - 1 / 16), 0), 1);
    const vis = t * t * (3 - 2 * t);
    (this.pts.material as THREE.PointsMaterial).opacity = vis;
    for (const spr of this.markers.values()) (spr.material as THREE.SpriteMaterial).opacity = vis;
    for (const [i, spr] of this.markers) {
      spr.position.set(this.field.positions[i * 3], this.field.positions[i * 3 + 1], this.field.positions[i * 3 + 2]);
    }
  }

  setCosmo(p: CosmoParams) { this.clock.setParams(p); this.syncPositions(true); }

  update(ctx: FrameCtx) {
    const p = ctx.physics;
    this.clock.setParams({ H0: p.H0, omegaM: p.omegaM, omegaL: p.omegaL, gMult: p.gMult });
    this.clock.step(ctx.simDt * p.cosmicRate);
    this.syncPositions();
  }

  pick(nx: number, ny: number, cam: THREE.PerspectiveCamera, w: number, h: number): string | null {
    const i = pickPoints(this.field.positions, this.field.count, this.pts.matrixWorld, cam, nx, ny, w, h, 14);
    return i >= 0 ? `g:${i}` : null;
  }

  indexOf(id: string): number { return id.startsWith('g:') ? Number(id.slice(2)) : -1; }

  target(id: string, out: THREE.Vector3): number | null {
    const i = this.indexOf(id);
    if (i < 0 || i >= this.field.count) return null;
    out.set(this.field.positions[i * 3], this.field.positions[i * 3 + 1], this.field.positions[i * 3 + 2]);
    return NAMED_GALAXIES.some((n) => n.index === i) ? 14 : 6;
  }

  info(id: string): SelectionInfo | null {
    const i = this.indexOf(id);
    if (i < 0 || i >= this.field.count) return null;
    const f = this.field;
    const named = NAMED_GALAXIES.find((n) => n.index === i);
    const type = TYPE_LIST[f.types[i]];
    const rows: InfoRow[] = [{ k: 'Type', v: TYPE_LABEL[type] }];
    if (named) {
      rows.push({ k: 'Real distance', v: named.realDistance });
    }
    if (f.bound[i]) {
      rows.push({ k: 'Hubble flow', v: 'None — gravitationally bound (Local Group)' });
    } else {
      // named galaxies sit at exaggerated scene positions → use their real distance
      const dComoving = named ? named.realMpc : Math.hypot(f.comoving[i * 3], f.comoving[i * 3 + 1], f.comoving[i * 3 + 2]) * MPC_PER_UNIT;
      const dProper = dComoving * this.clock.a;
      const H = this.clock.hubbleKms();
      const v = H * dProper; // Hubble's law, exact for proper distance in FRW
      if (!named) rows.push({ k: 'Comoving distance', v: `${fmtNum((dComoving * MLY_PER_MPC) / 1000)} Gly` });
      const dMly = dProper * MLY_PER_MPC;
      rows.push({ k: 'Proper distance now', v: dMly < 1000 ? `${fmtNum(dMly, 1)} Mly` : `${fmtNum(dMly / 1000)} Gly` });
      rows.push({
        k: 'Recession v = H·d', v: `${fmtNum(v, 0)} km/s (${(v / C_KMS).toFixed(2)} c)`,
        tone: v > C_KMS ? 'warn' : undefined,
      });
    }
    return {
      id, name: galaxyName(i, f.params.seed), kind: TYPE_LABEL[type],
      info: named?.note ?? `Procedural ${type} galaxy — generated from universe seed ${f.params.seed}, index ${i}. Recession faster than light is allowed: it is space expanding, not motion through space.`,
      rows, enterLabel: 'Enter galaxy', editable: false,
    };
  }

  labels(): LabelSpec[] {
    return NAMED_GALAXIES.map((n) => ({
      id: `g:${n.index}`, text: n.name, cls: n.index === 0 ? 'major' : '',
      pos: () => this.markers.get(n.index)!.position,
    }));
  }

  stats(p: PhysicsParams): LevelStats {
    const age = this.clock.age();
    const ev = this.clock.event;
    return {
      rows: [
        { k: 'Cosmic age', v: age === null ? 'no Big Bang (bounce model)' : `${age.toFixed(3)} Gyr` },
        { k: 'Scale factor a', v: this.clock.a.toFixed(4) },
        { k: 'Redshift z', v: (1 / this.clock.a - 1).toFixed(3) },
        { k: 'Hubble rate H', v: `${this.clock.hubbleKms().toFixed(1)} km/s/Mpc` },
        { k: 'CMB temperature', v: `${cmbTemperature(this.clock.a).toFixed(2)} K` },
        { k: 'Ωk (curvature)', v: (1 - p.omegaM - p.omegaL).toFixed(3) },
        { k: 'Galaxies', v: this.field.count.toLocaleString('en-US') },
      ],
      event: ev === 'bigbang' ? 'Reached z ≈ 49 — before the first galaxies. Earlier epochs (down to the Planck time) are in Lab → Timeline. Run time forward.'
        : ev === 'crunch' ? 'Big Crunch — this universe recollapsed. Reverse time or lower Ωm.'
        : ev === 'maxsize' ? 'Display limit reached (a = 25).' : undefined,
    };
  }

  dispose() { disposeTree(this.group); this.group.clear(); }
}
