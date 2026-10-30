import * as THREE from 'three';
import type { View, FrameCtx, LabelSpec, SelectionInfo, LevelStats, InfoRow, BodyListItem } from '../common';
import { glowSprite, disposeTree, pickPoints, pointsMaterial } from '../common';
import { generateBelt, updateBelt, keplerPosition, type BeltField } from '../../sim/belts';
import { blackHole, fmtSci, fmtTime, REAL_LAWS, type Derived, type Laws } from '../../sim/laws';
import { NBody, orbitalElements, circularOrbitSpeed, G0, type SimBody, type PhysicsParams, type MergeEvent } from '../../sim/physics';
import {
  toAU, toDisplay, displayRadiusPlanet, displayRadiusStar, MOON_SIM_S_PER_DAY,
  type SystemDef, type BodyDef, type TexStyle, type SystemSnapshot,
} from '../../sim/systems';
import {
  starFromMass, habitableZone, equilibriumTemp, planetRadiusEarth, schwarzschildKm,
  fmtMass, fmtKm, fmtNum, SUN_MASS_SIM, EARTH_MASS_SIM, R_EARTH_KM, R_SUN_KM,
} from '../../sim/astro';
import { glowTexture, planetTexture, ringTexture, accretionTexture, softDotTexture } from '../../sim/textures';

export type SpawnKind = 'rocky' | 'gas' | 'ice' | 'star' | 'blackhole';
export interface SpawnSpec {
  kind: SpawnKind;
  mass: number;          // M⊕ for planets, M☉ for stars / black holes
  orbitR: number;        // display units from the centre body
  speedFactor: number;   // × circular speed (√2 ≈ 1.414 = escape)
  inclination: number;   // degrees
  aroundId: string | null; // null = system primary
}

interface Trail { line: THREE.Line; geo: THREE.BufferGeometry; arr: Float32Array; n: number; max: number }
interface Flash { sprite: THREE.Sprite; life: number }

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const MAX_STAR_LIGHTS = 4;

export class SystemView implements View {
  readonly group = new THREE.Group();
  def: SystemDef;
  readonly nbody = new NBody();
  private defs = new Map<string, BodyDef>();
  private meshes = new Map<string, THREE.Mesh>();
  private trails = new Map<string, Trail>();
  private flashes: Flash[] = [];
  private hzRing: THREE.Mesh | null = null;
  private hzKey = '';
  private trailMax = 0;
  private spawnCount = 0;
  private lastP: PhysicsParams | null = null;
  private laws: Laws = REAL_LAWS;
  private derived: Derived | null = null;
  private belts: { field: BeltField; points: THREE.Points }[] = [];
  simTime = 0;
  labelsVersion = 0;
  // energy diagnostics
  private E0: number | null = null;
  private baselineKey = '';
  private lastDiag = { drift: 0, p: 0, t: 0 };
  /** fired when bodies disappear (merge) so the engine can fix selection */
  onMerge: ((m: MergeEvent, name: string, into: string) => void) | null = null;

  constructor(def: SystemDef) {
    this.def = def;
    this.simTime = def.t0 ?? 0;
    const sims: SimBody[] = [];
    for (const b of def.bodies) {
      this.addObject(b);
      if (b.kind !== 'moon' && !b.kepler) sims.push(toSim(b));
    }
    this.nbody.set(sims);
    for (const bd of def.belts ?? []) {
      const field = generateBelt(bd);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(field.positions, 3));
      const col = new Float32Array(field.n * 3);
      const c = new THREE.Color(bd.color);
      for (let i = 0; i < field.n; i++) { const f = 0.6 + ((i * 7919) % 100) / 250; col[i * 3] = c.r * f; col[i * 3 + 1] = c.g * f; col[i * 3 + 2] = c.b * f; }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const points = new THREE.Points(geo, pointsMaterial(softDotTexture(), bd.size, 0.85));
      points.frustumCulled = false;
      this.group.add(points);
      this.belts.push({ field, points });
    }
    this.syncKepler();
    this.syncMoons(0);
    this.updateBelts();
  }

  /** Centre + μ for test particles: the most massive star (or hole). */
  private centralBody(): { x: number; y: number; z: number; mu: number } {
    const c = this.systemPrimary();
    const g = this.G();
    return c ? { x: c.x, y: c.y, z: c.z, mu: g * c.mass } : { x: 0, y: 0, z: 0, mu: g * SUN_MASS_SIM };
  }

  private syncKepler() {
    const c = this.centralBody();
    const toD = (au: number) => toDisplay(au, this.def.scale);
    const out = [0, 0, 0];
    for (const d of this.defs.values()) {
      if (!d.kepler) continue;
      const mesh = this.meshes.get(d.id);
      if (!mesh) continue;
      keplerPosition(d.kepler, this.simTime, c.mu, toD, c.x, c.y, c.z, out);
      mesh.position.set(out[0], out[1], out[2]);
    }
  }

  private updateBelts() {
    if (!this.belts.length) return;
    const c = this.centralBody();
    const toD = (au: number) => toDisplay(au, this.def.scale);
    for (const b of this.belts) {
      let planet = null;
      if (b.field.def.ofBody) {
        const pb = this.nbody.get(b.field.def.ofBody);
        if (pb) {
          const r = Math.hypot(pb.x - c.x, pb.y - c.y, pb.z - c.z);
          planet = { x: pb.x, y: pb.y, z: pb.z, period: 2 * Math.PI * Math.sqrt((r * r * r) / c.mu) };
        } else { b.points.visible = false; continue; }
      }
      updateBelt(b.field, { t: this.simTime, mu: c.mu, cx: c.x, cy: c.y, cz: c.z, toDisplay: toD, planet });
      (b.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  // ───────────── object construction ─────────────

  private addObject(b: BodyDef) {
    this.defs.set(b.id, b);
    const mesh = buildBodyMesh(b, this.countStars() <= MAX_STAR_LIGHTS);
    mesh.position.set(...b.pos);
    mesh.userData.bodyId = b.id;
    this.group.add(mesh);
    this.meshes.set(b.id, mesh);
    if (b.kind !== 'moon') this.addTrail(b.id, b.kind === 'star' ? 0xffb46a : b.kind === 'blackhole' ? 0xff6a4d : 0x8642ff);
    this.labelsVersion++;
  }

  private countStars() { let n = 0; for (const d of this.defs.values()) if (d.kind === 'star') n++; return n; }

  private addTrail(id: string, color: number) {
    const max = this.trailMax || 400;
    const arr = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    geo.setDrawRange(0, 0);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.42, depthWrite: false }));
    line.frustumCulled = false;
    this.group.add(line);
    this.trails.set(id, { line, geo, arr, n: 0, max });
  }

  private removeObject(id: string) {
    const mesh = this.meshes.get(id);
    if (mesh) { this.group.remove(mesh); disposeTree(mesh); this.meshes.delete(id); }
    const tr = this.trails.get(id);
    if (tr) { this.group.remove(tr.line); tr.geo.dispose(); (tr.line.material as THREE.Material).dispose(); this.trails.delete(id); }
    this.defs.delete(id);
    this.labelsVersion++;
  }

  // ───────────── frame update ─────────────

  update(ctx: FrameCtx) {
    const p = ctx.physics;
    this.lastP = p;
    this.laws = ctx.laws;
    if (this.derived !== ctx.derived) { this.derived = ctx.derived; this.hzKey = ''; }
    if (p.trailLength !== this.trailMax) this.resizeTrails(p.trailLength);
    const dt = ctx.simDt * (this.def.timeScale ?? 1);

    if (dt !== 0) {
      const merges = this.nbody.step(dt, p);
      this.simTime += dt;
      for (const m of merges) this.handleMerge(m);
      this.syncDynamicMeshes();
      this.syncKepler();
      this.syncMoons(dt * p.moonRate);
      this.updateBelts();
    }
    this.syncDynamicMeshes();
    if (dt !== 0) this.updateTrails(p.trails);
    for (const b of this.belts) b.points.visible = p.belts && (!b.field.def.ofBody || !!this.nbody.get(b.field.def.ofBody));

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= ctx.dtReal * 1.4;
      f.sprite.scale.multiplyScalar(1 + ctx.dtReal * 6);
      (f.sprite.material as THREE.SpriteMaterial).opacity = Math.max(f.life, 0);
      if (f.life <= 0) { this.group.remove(f.sprite); (f.sprite.material as THREE.Material).dispose(); this.flashes.splice(i, 1); }
    }
    for (const [id, mesh] of this.meshes) {
      const kind = this.defs.get(id)?.kind;
      mesh.rotation.y += ctx.dtReal * (kind === 'star' ? 0.05 : kind === 'blackhole' ? 0.6 : 0.3);
    }
    this.updateHZ(p.habitableZone);
  }

  private syncDynamicMeshes() {
    for (const b of this.nbody.bodies) {
      const mesh = this.meshes.get(b.id);
      if (!mesh) continue;
      mesh.position.set(b.x, b.y, b.z);
      const d = this.defs.get(b.id)!;
      if (Math.abs(b.radius - d.radius) > 1e-6) mesh.scale.setScalar(b.radius / d.radius);
    }
  }

  private syncMoons(dt: number) {
    for (const d of this.defs.values()) {
      if (d.kind !== 'moon' || !d.parentId) continue;
      const parent = this.meshes.get(d.parentId);
      const mesh = this.meshes.get(d.id);
      if (!parent || !mesh) continue;
      const P = d.periodSim ?? 10; // negative = retrograde (e.g. Triton)
      d.phase = (d.phase ?? 0) + (2 * Math.PI * dt) / (Math.sign(P) * Math.max(Math.abs(P), 0.01));
      _v.set(Math.cos(d.phase) * (d.orbitR ?? 1), 0, Math.sin(d.phase) * (d.orbitR ?? 1));
      _q.setFromAxisAngle(X_AXIS, d.incl ?? 0);
      _v.applyQuaternion(_q);
      mesh.position.copy(parent.position).add(_v);
    }
  }

  private handleMerge(m: MergeEvent) {
    const gone = this.defs.get(m.absorbedId);
    const keep = this.defs.get(m.keepId);
    const keepSim = this.nbody.get(m.keepId);
    if (keep && keepSim) {
      keep.mass = keepSim.mass;
      if (keep.kind === 'star') this.restyleStar(keep);
    }
    // moons of the absorbed body now orbit the survivor
    for (const d of this.defs.values()) if (d.parentId === m.absorbedId) d.parentId = m.keepId;
    const goneName = gone?.name ?? m.absorbedId;
    this.removeObject(m.absorbedId);
    const flash = glowSprite(glowTexture('rgba(255,230,200,1)'), 0xffc9a0, 2);
    flash.position.set(m.x, m.y, m.z);
    this.group.add(flash);
    this.flashes.push({ sprite: flash, life: 1 });
    this.resetBaseline();
    this.onMerge?.(m, goneName, keep?.name ?? m.keepId);
  }

  private resizeTrails(max: number) {
    this.trailMax = max;
    for (const [id, tr] of this.trails) {
      const arr = new Float32Array(max * 3);
      const keep = Math.min(tr.n, max);
      arr.set(tr.arr.subarray((tr.n - keep) * 3, tr.n * 3));
      tr.geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      tr.geo.setDrawRange(0, keep);
      this.trails.set(id, { ...tr, arr, n: keep, max });
    }
  }

  private updateTrails(on: boolean) {
    for (const [id, tr] of this.trails) {
      tr.line.visible = on;
      if (!on) { tr.n = 0; tr.geo.setDrawRange(0, 0); continue; }
      const mesh = this.meshes.get(id);
      if (!mesh) continue;
      if (tr.n >= tr.max) { tr.arr.copyWithin(0, 3); tr.n = tr.max - 1; }
      tr.arr[tr.n * 3] = mesh.position.x; tr.arr[tr.n * 3 + 1] = mesh.position.y; tr.arr[tr.n * 3 + 2] = mesh.position.z;
      tr.n++;
      tr.geo.setDrawRange(0, tr.n);
      (tr.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  // ───────────── habitable zone ─────────────

  private stars(): BodyDef[] { return [...this.defs.values()].filter((d) => d.kind === 'star'); }

  private primaryStar(): BodyDef | null {
    let best: BodyDef | null = null;
    for (const s of this.stars()) if (!best || s.mass > best.mass) best = s;
    return best;
  }

  private totalLum() { return this.stars().reduce((a, s) => a + (s.lum ?? 0), 0); }

  private updateHZ(show: boolean) {
    const ps = this.primaryStar();
    if (!ps || !show) { if (this.hzRing) this.hzRing.visible = false; return; }
    const L = this.totalLum() * (this.derived?.lumFactor ?? 1);
    const key = `${ps.id}:${L.toPrecision(6)}:${ps.teff}`;
    if (key !== this.hzKey) {
      this.hzKey = key;
      if (this.hzRing) { this.group.remove(this.hzRing); disposeTree(this.hzRing); }
      const hz = habitableZone(L, ps.teff ?? 5772);
      const r1 = toDisplay(hz.inner, this.def.scale), r2 = toDisplay(hz.outer, this.def.scale);
      if (r2 - r1 > 0.05) {
        this.hzRing = new THREE.Mesh(
          new THREE.RingGeometry(r1, r2, 128, 1),
          new THREE.MeshBasicMaterial({ color: 0x3fd28a, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
        );
        this.hzRing.rotation.x = -Math.PI / 2;
        this.group.add(this.hzRing);
      } else this.hzRing = null;
    }
    if (this.hzRing) {
      // centre on the stars' centre of mass
      let m = 0, x = 0, y = 0, z = 0;
      for (const s of this.stars()) { const sb = this.nbody.get(s.id); if (!sb) continue; m += sb.mass; x += sb.x * sb.mass; y += sb.y * sb.mass; z += sb.z * sb.mass; }
      if (m > 0) this.hzRing.position.set(x / m, y / m, z / m);
      this.hzRing.visible = true;
    }
  }

  // ───────────── physics helpers ─────────────

  private G() { return G0 * (this.lastP?.gMult ?? 1); }

  /** Body exerting the strongest pull G·M/r² among more massive bodies. */
  primaryOf(id: string): SimBody | null {
    const b = this.nbody.get(id);
    if (!b) return null;
    let best: SimBody | null = null, bestF = 0;
    for (const o of this.nbody.bodies) {
      if (o === b || o.mass <= b.mass) continue;
      const r2 = (o.x - b.x) ** 2 + (o.y - b.y) ** 2 + (o.z - b.z) ** 2;
      const f = o.mass / Math.max(r2, 1e-9);
      if (f > bestF) { bestF = f; best = o; }
    }
    return best;
  }

  private systemPrimary(): SimBody | null {
    let best: SimBody | null = null;
    for (const b of this.nbody.bodies) if (!best || b.mass > best.mass) best = b;
    return best;
  }

  private flux(x: number, y: number, z: number): number {
    // Σ L_i / d_i²  in L☉/AU²  (distances mapped back to AU per star)
    let S = 0;
    for (const s of this.stars()) {
      const sb = this.nbody.get(s.id);
      if (!sb) continue;
      const au = Math.max(toAU(Math.hypot(sb.x - x, sb.y - y, sb.z - z), this.def.scale), 1e-4);
      S += (s.lum ?? 0) / (au * au);
    }
    return S * (this.derived?.lumFactor ?? 1); // laws of physics change stellar output
  }

  private resetBaseline() { this.E0 = null; }

  // ───────────── View interface ─────────────

  pick(nx: number, ny: number, cam: THREE.PerspectiveCamera, w: number, h: number): string | null {
    let best: string | null = null, bestScore = Infinity;
    const px = ((nx + 1) / 2) * w, py = ((1 - ny) / 2) * h;
    const fovPx = h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    for (const [id, mesh] of this.meshes) {
      mesh.getWorldPosition(_v);
      const dist = _v.distanceTo(cam.position);
      _v.project(cam);
      if (_v.z > 1) continue;
      const sx = ((_v.x + 1) / 2) * w, sy = ((1 - _v.y) / 2) * h;
      const rPx = ((this.defs.get(id)?.radius ?? 0.2) * mesh.scale.x * fovPx) / Math.max(dist, 1e-3);
      const d = Math.hypot(sx - px, sy - py);
      if (d > Math.max(rPx, 14)) continue;
      const score = d - rPx + dist * 1e-3;
      if (score < bestScore) { bestScore = score; best = id; }
    }
    if (best) return best;
    for (const b of this.belts) {
      if (!b.points.visible) continue;
      const i = pickPoints(b.field.positions, b.field.n, b.points.matrixWorld, cam, nx, ny, w, h, 8);
      if (i >= 0) return `belt:${b.field.def.id}:${i}`;
    }
    return null;
  }

  private beltOf(id: string) {
    if (!id.startsWith('belt:')) return null;
    const [, bid, idx] = id.split(':');
    const b = this.belts.find((x) => x.field.def.id === bid);
    return b ? { b, i: Math.min(Number(idx), b.field.n - 1) } : null;
  }

  target(id: string, out: THREE.Vector3): number | null {
    const bo = this.beltOf(id);
    if (bo) { const p = bo.b.field.positions; out.set(p[bo.i * 3], p[bo.i * 3 + 1], p[bo.i * 3 + 2]); return 0.15; }
    const mesh = this.meshes.get(id);
    if (!mesh) return null;
    mesh.getWorldPosition(out);
    return (this.defs.get(id)?.radius ?? 0.2) * mesh.scale.x;
  }

  bodyDef(id: string) { return this.defs.get(id) ?? null; }

  info(id: string): SelectionInfo | null {
    const bo = this.beltOf(id);
    if (bo) {
      const bd = bo.b.field.def, f = bo.b.field;
      return {
        id, name: bd.name, kind: 'Small-body population', info: bd.info,
        rows: [
          { k: 'Drawn', v: `${f.n.toLocaleString('en-US')} test particles` },
          { k: 'Real population', v: bd.realCount ?? '—' },
          { k: 'Orbits', v: bd.kind === 'trojan' ? 'Lagrange points L4 / L5' : `${fmtNum(bd.aMin, 2)} – ${fmtNum(bd.aMax, 2)} AU` },
          { k: 'This particle', v: `a = ${fmtNum(f.a[bo.i], 3)} AU · e = ${f.e[bo.i].toFixed(2)} · i = ${(f.inc[bo.i] * 57.2958).toFixed(1)}°` },
        ],
        enterLabel: null, editable: false,
      };
    }
    const d = this.defs.get(id);
    if (!d) return null;
    const rows: InfoRow[] = [];
    const sb = this.nbody.get(id);
    const mass = sb?.mass ?? d.mass;
    rows.push({ k: 'Mass', v: fmtMass(mass) });

    if (d.kind === 'blackhole') {
      const bh = blackHole(mass / SUN_MASS_SIM, 0, this.laws, this.lastP?.gMult ?? 1);
      rows.push({ k: 'Event horizon r_s', v: fmtKm(bh.rsM / 1000) + (this.lastP?.gMult === 1 ? '' : ` (r_s ≈ ${fmtKm(schwarzschildKm(mass / SUN_MASS_SIM))} at real G)`) });
      rows.push({ k: 'Photon sphere · ISCO', v: `${fmtKm((1.5 * bh.rsM) / 1000)} · ${fmtKm((3 * bh.rsM) / 1000)}` });
      rows.push({ k: 'Hawking temperature', v: `${fmtSci(bh.hawkingK)} K` });
      rows.push({ k: 'Evaporation time', v: fmtTime(bh.evapYears * 3.15576e7) });
      rows.push({ k: 'Eddington luminosity', v: `${fmtSci(bh.eddingtonW / 3.828e26)} L☉` });
      rows.push({ k: 'Tidal stretch at horizon', v: `${fmtSci(bh.tidal / 9.81)} g over 2 m`, tone: bh.tidal > 1e3 ? 'bad' : 'good' });
    } else if (d.realRadiusKm) {
      rows.push({ k: 'Radius', v: d.kind === 'star' ? `${(d.realRadiusKm / R_SUN_KM).toFixed(3)} R☉ · ${fmtKm(d.realRadiusKm)}` : `${(d.realRadiusKm / R_EARTH_KM).toFixed(2)} R⊕ · ${fmtKm(d.realRadiusKm)}` });
    }
    if (d.kind === 'star') {
      const sp = starFromMass(mass / SUN_MASS_SIM);
      rows.push({ k: 'Temperature', v: `${Math.round(d.teff ?? sp.teff).toLocaleString('en-US')} K · ${sp.cls}-type` });
      rows.push({ k: 'Luminosity', v: `${fmtNum(d.lum ?? sp.lum, 4)} L☉` });
      const hz = habitableZone(d.lum ?? sp.lum, d.teff ?? sp.teff);
      rows.push({ k: 'Habitable zone', v: `${fmtNum(hz.inner, 3)} – ${fmtNum(hz.outer, 3)} AU` });
    }

    if (d.kepler) {
      const k = d.kepler;
      const ps = this.primaryStar();
      const mStar = (ps?.mass ?? SUN_MASS_SIM) / SUN_MASS_SIM;
      rows.push({ k: 'Orbit (real elements)', v: `a ${fmtNum(k.a, 3)} AU · e ${k.e.toFixed(3)} · i ${(k.i * 57.2958).toFixed(1)}°` });
      rows.push({ k: 'Perihelion · aphelion', v: `${fmtNum(k.a * (1 - k.e), 3)} · ${fmtNum(k.a * (1 + k.e), 3)} AU` });
      rows.push({ k: 'Real period', v: `${fmtNum(Math.pow(k.a, 1.5) / Math.sqrt(mStar), 2)} yr` });
      const mesh = this.meshes.get(id);
      if (mesh) {
        const S = this.flux(mesh.position.x, mesh.position.y, mesh.position.z);
        if (S > 0) rows.push({ k: 'Equilibrium temp now', v: `${Math.round(equilibriumTemp(1, 1 / Math.sqrt(S), d.albedo ?? 0.3))} K` });
      }
      rows.push({ k: 'Motion', v: 'Keplerian test particle' });
    } else if (d.kind === 'moon') {
      const parent = d.parentId ? this.defs.get(d.parentId) : null;
      rows.push({ k: 'Orbits', v: parent?.name ?? '—' });
      rows.push({ k: 'Period (real days)', v: `${(Math.abs(d.periodSim ?? 0) / MOON_SIM_S_PER_DAY).toFixed(2)} d${(d.periodSim ?? 0) < 0 ? ' · retrograde' : ''}` });
      rows.push({ k: 'Motion', v: 'Kinematic (on rails) — see note' });
    } else if (sb) {
      const prim = this.primaryOf(id);
      if (prim) {
        const mu = this.G() * (prim.mass + sb.mass);
        const oe = orbitalElements(sb.x - prim.x, sb.y - prim.y, sb.z - prim.z, sb.vx - prim.vx, sb.vy - prim.vy, sb.vz - prim.vz, mu);
        const pName = this.defs.get(prim.id)?.name ?? prim.id;
        rows.push({ k: 'Orbits', v: pName });
        rows.push({ k: 'Distance', v: `${oe.r.toFixed(2)} u ≈ ${fmtNum(toAU(oe.r, this.def.scale), 3)} AU` });
        rows.push({ k: 'Speed / escape', v: `${oe.v.toFixed(2)} / ${oe.vEscape.toFixed(2)} u/s` });
        if (oe.bound) {
          rows.push({ k: 'Eccentricity', v: oe.e.toFixed(3), tone: oe.e > 0.5 ? 'warn' : undefined });
          rows.push({ k: 'Period', v: `${oe.period!.toFixed(2)} sim-s` });
        } else {
          rows.push({ k: 'Trajectory', v: `Unbound (e = ${oe.e.toFixed(2)}) — escaping`, tone: 'bad' });
        }
      }
      if (d.kind === 'planet') {
        const S = this.flux(sb.x, sb.y, sb.z);
        if (S > 0) {
          const teq = equilibriumTemp(1, 1 / Math.sqrt(S), d.albedo ?? 0.3);
          const ps = this.primaryStar();
          const L = ps?.lum ?? 1;
          const hz = habitableZone(L, ps?.teff ?? 5772);
          const Sin = L / (hz.inner * hz.inner), Sout = L / (hz.outer * hz.outer);
          const zone = S > Sin ? { v: 'Too hot — inside the HZ inner edge', tone: 'bad' as const }
            : S < Sout ? { v: 'Too cold — beyond the HZ outer edge', tone: 'warn' as const }
            : { v: 'Inside the habitable zone', tone: 'good' as const };
          rows.push({ k: 'Equilibrium temp', v: `${Math.round(teq)} K (${Math.round(teq - 273.15)} °C)` });
          rows.push({ k: 'Stellar flux', v: `${fmtNum(S, 3)} × Earth` });
          rows.push({ k: 'Habitability', ...zone });
        }
      }
    }
    const moonNote = ' Moon orbits are kinematic with real period ratios, slowed 150× relative to planets: in a compressed map a moon sits far outside its planet’s Hill sphere and could not stay bound.';
    return {
      id, name: d.name,
      kind: d.kind === 'blackhole' ? 'Black hole' : d.kind === 'star' ? 'Star' : d.kind === 'moon' ? 'Moon' : 'Planet',
      info: d.info + (d.kind === 'moon' ? moonNote : ''),
      rows,
      enterLabel: d.kind === 'planet' ? 'Enter orbit' : d.kind === 'blackhole' ? 'Approach the hole' : null,
      editable: d.kind !== 'moon' && !d.kepler,
      massSim: mass,
      isPlanet: d.kind === 'planet',
    };
  }

  labels(): LabelSpec[] {
    const out: LabelSpec[] = [];
    for (const [id, d] of this.defs) {
      const mesh = this.meshes.get(id);
      if (!mesh) continue;
      out.push({ id, text: d.name, cls: d.kind === 'star' || d.kind === 'blackhole' ? 'major' : d.kind === 'moon' ? 'minor tiny' : 'minor', pos: () => mesh.position });
    }
    return out;
  }

  bodyList(): BodyListItem[] {
    const out: BodyListItem[] = [];
    const all = [...this.defs.values()];
    const rank = { star: 0, blackhole: 1, planet: 2, moon: 3 } as const;
    const primary = this.systemPrimary();
    const dist = (d: BodyDef) => {
      const sb = this.nbody.get(d.id);
      return sb && primary ? Math.hypot(sb.x - primary.x, sb.y - primary.y, sb.z - primary.z) : 0;
    };
    // small bodies on fixed Keplerian orbits (dwarf planets, comets) come after the planets, by semi-major axis
    const r = (d: BodyDef) => (d.kepler ? 2.5 : rank[d.kind]);
    const order = (d: BodyDef) => (d.kepler ? d.kepler.a : dist(d));
    for (const d of all.filter((x) => x.kind !== 'moon').sort((a, b) => r(a) - r(b) || order(a) - order(b))) {
      out.push({ id: d.id, name: d.name, kind: bodyLabel(d), depth: 0 });
      for (const m of all.filter((x) => x.kind === 'moon' && x.parentId === d.id)) out.push({ id: m.id, name: m.name, kind: 'moon', depth: 1 });
    }
    return out;
  }

  stats(p: PhysicsParams): LevelStats {
    const now = performance.now();
    const key = `${p.gMult}:${p.softening}:${this.nbody.bodies.length}`;
    if (key !== this.baselineKey) { this.baselineKey = key; this.E0 = null; }
    if (now - this.lastDiag.t > 250) {
      const d = this.nbody.diagnostics(p);
      if (this.E0 === null) this.E0 = d.energy;
      this.lastDiag = {
        t: now,
        drift: this.E0 !== 0 ? (d.energy - this.E0) / Math.abs(this.E0) : 0,
        p: Math.hypot(d.px, d.py, d.pz) / Math.max(d.mass, 1e-9),
      };
    }
    return {
      rows: [
        { k: 'Sim time', v: `${this.simTime.toFixed(1)} sim-s` },
        { k: 'Bodies (N-body)', v: String(this.nbody.bodies.length) },
        ...(this.belts.length ? [{ k: 'Small bodies (Kepler)', v: (this.belts.reduce((a, b) => a + b.field.n, 0) + [...this.defs.values()].filter((d) => d.kepler).length).toLocaleString('en-US') }] : []),
        ...(this.def.timeScale && this.def.timeScale !== 1 ? [{ k: 'System clock', v: `×${fmtSci(this.def.timeScale)} (very massive)` }] : []),
        { k: 'Energy drift ΔE/E', v: this.lastDiag.drift.toExponential(1), tone: Math.abs(this.lastDiag.drift) > 1e-2 ? 'warn' : 'good' },
        { k: 'Centre-of-mass speed', v: this.lastDiag.p.toExponential(1) },
        { k: 'Distance map', v: this.def.scale.kind === 'linear' ? 'Linear (true period ratios)' : 'Compressed (√-like)' },
      ],
      bodies: this.bodyList(),
    };
  }

  // ───────────── editing ─────────────

  centreFor(aroundId: string | null): SimBody | null {
    return (aroundId ? this.nbody.get(aroundId) : null) ?? this.systemPrimary();
  }

  /** Add a body on an orbit. `at` (optional) fixes the position (click placement). */
  addBody(spec: SpawnSpec, at?: THREE.Vector3): BodyDef | null {
    const c = this.centreFor(spec.aroundId);
    const n = ++this.spawnCount;
    let mass: number, radius: number, tex: TexStyle, color: number, kind: BodyDef['kind'], name: string, extra: Partial<BodyDef> = {};
    if (spec.kind === 'star') {
      const sp = starFromMass(spec.mass);
      mass = spec.mass * SUN_MASS_SIM; radius = displayRadiusStar(sp.radiusSun); tex = 'star'; color = sp.color; kind = 'star';
      name = `New Star ${n}`;
      extra = { lum: sp.lum, teff: sp.teff, realRadiusKm: sp.radiusSun * R_SUN_KM, info: `${sp.cls}-type star added by you.` };
    } else if (spec.kind === 'blackhole') {
      mass = spec.mass * SUN_MASS_SIM; radius = Math.min(0.35 + 0.3 * Math.log10(1 + spec.mass), 2); tex = 'blackhole'; color = 0x000000; kind = 'blackhole';
      name = `Black Hole ${n}`;
      extra = { info: 'Stellar-mass black hole. Anything that touches it is absorbed (momentum conserved).' };
    } else {
      const rE = planetRadiusEarth(spec.mass);
      mass = spec.mass * EARTH_MASS_SIM; radius = displayRadiusPlanet(rE); kind = 'planet';
      tex = spec.kind === 'gas' ? 'gas' : spec.kind === 'ice' ? 'ice' : 'rock';
      color = spec.kind === 'gas' ? 0xd8a56e : spec.kind === 'ice' ? 0x7fb8d8 : 0xa98c74;
      name = `New Planet ${n}`;
      extra = { realRadiusKm: rE * R_EARTH_KM, ring: spec.kind === 'gas' && spec.mass > 80, info: 'Planet added by you. Radius estimated from mass (Chen & Kipping 2017).' };
    }
    let r = spec.orbitR, phase = Math.random() * Math.PI * 2;
    const cx = c?.x ?? 0, cy = c?.y ?? 0, cz = c?.z ?? 0;
    if (at) { r = Math.max(Math.hypot(at.x - cx, at.z - cz), 0.5); phase = Math.atan2(at.z - cz, at.x - cx); }
    if (c) r = Math.max(r, (this.defs.get(c.id)?.radius ?? 1) + radius + 0.3);
    const inc = THREE.MathUtils.degToRad(spec.inclination);
    const v = c ? circularOrbitSpeed(c.mass + mass, r, this.lastP?.gMult ?? 1) * spec.speedFactor : 0;
    const ca = Math.cos(phase), sa = Math.sin(phase), ci = Math.cos(inc), si = Math.sin(inc);
    const def: BodyDef = {
      id: `u-${Date.now().toString(36)}-${n}`, name, kind, mass, radius,
      pos: [cx + r * ca, cy + r * sa * si, cz + r * sa * ci],
      vel: [(c?.vx ?? 0) - sa * v, (c?.vy ?? 0) + ca * v * si, (c?.vz ?? 0) + ca * v * ci],
      color, tex, info: '', texSeed: n * 31, ...extra,
    } as BodyDef;
    this.addObject(def);
    this.nbody.bodies.push(toSim(def));
    this.resetBaseline();
    return def;
  }

  addMoon(parentId: string): BodyDef | null {
    const parent = this.defs.get(parentId);
    if (!parent || parent.kind !== 'planet') return null;
    const siblings = [...this.defs.values()].filter((d) => d.parentId === parentId).length;
    const n = ++this.spawnCount;
    const periodDays = 2 + siblings * 3 + Math.random() * 3;
    const def: BodyDef = {
      id: `u-moon-${Date.now().toString(36)}-${n}`, name: `${parent.name} moon ${siblings + 1}`, kind: 'moon',
      mass: 0.01 * EARTH_MASS_SIM, radius: Math.max(parent.radius * 0.18, 0.05),
      pos: [parent.pos[0], parent.pos[1], parent.pos[2]], vel: [0, 0, 0], color: 0xb8b8b0, tex: 'rock', info: 'Moon added by you.',
      realRadiusKm: 1200, parentId, orbitR: parent.radius * (1.8 + 0.9 * siblings), periodSim: periodDays * MOON_SIM_S_PER_DAY,
      phase: Math.random() * Math.PI * 2, incl: 0.05,
    };
    this.addObject(def);
    this.syncMoons(0);
    return def;
  }

  setMass(id: string, massSim: number) {
    const sb = this.nbody.get(id), d = this.defs.get(id);
    if (!sb || !d) return;
    sb.mass = Math.max(massSim, 1e-9);
    d.mass = sb.mass;
    if (d.kind === 'star') this.restyleStar(d);
    this.resetBaseline();
  }

  private restyleStar(d: BodyDef) {
    const sp = starFromMass(d.mass / SUN_MASS_SIM);
    d.lum = sp.lum; d.teff = sp.teff; d.color = sp.color; d.realRadiusKm = sp.radiusSun * R_SUN_KM;
    const mesh = this.meshes.get(d.id);
    if (!mesh) return;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.map = planetTexture('star', d.color, 3);
    mat.needsUpdate = true;
    for (const ch of mesh.children) {
      if (ch instanceof THREE.Sprite) (ch.material as THREE.SpriteMaterial).color.setHex(d.color);
      if (ch instanceof THREE.PointLight) ch.color.setHex(d.color).lerp(new THREE.Color(0xffffff), 0.6);
    }
    this.hzKey = '';
  }

  /** Scale velocity relative to the primary (prograde > 1, retrograde < 1). */
  kick(id: string, factor: number) {
    const sb = this.nbody.get(id);
    const prim = this.primaryOf(id);
    if (!sb) return;
    const ox = prim?.vx ?? 0, oy = prim?.vy ?? 0, oz = prim?.vz ?? 0;
    sb.vx = ox + (sb.vx - ox) * factor; sb.vy = oy + (sb.vy - oy) * factor; sb.vz = oz + (sb.vz - oz) * factor;
    this.resetBaseline();
  }

  remove(id: string) {
    const d = this.defs.get(id);
    if (!d) return;
    for (const m of [...this.defs.values()]) if (m.parentId === id) this.removeObject(m.id);
    this.nbody.remove(id);
    this.removeObject(id);
    this.resetBaseline();
  }

  /** Current state as a saveable snapshot. */
  snapshot(): SystemSnapshot {
    const bodies = [...this.defs.values()].map((d) => {
      const sb = this.nbody.get(d.id);
      const mesh = this.meshes.get(d.id);
      const out: BodyDef = { ...d, pos: [d.pos[0], d.pos[1], d.pos[2]], vel: [d.vel[0], d.vel[1], d.vel[2]] };
      if (sb) { out.pos = [sb.x, sb.y, sb.z]; out.vel = [sb.vx, sb.vy, sb.vz]; out.mass = sb.mass; out.radius = sb.radius; }
      else if (mesh) out.pos = [mesh.position.x, mesh.position.y, mesh.position.z];
      return out;
    });
    return {
      format: 'cosmos-system', version: 2, savedAt: new Date().toISOString(),
      system: {
        id: this.def.id, name: this.def.name, subtitle: this.def.subtitle, scale: { ...this.def.scale }, bodies,
        belts: this.def.belts?.map((b) => ({ ...b })), timeScale: this.def.timeScale, t0: this.simTime,
      },
    };
  }

  /** Direction (unit) from a body to the light-weighted star centre; used by the planet view. */
  starDirection(fromId: string, out: THREE.Vector3): boolean {
    const bm = this.meshes.get(fromId);
    if (!bm) return false;
    const b = bm.position;
    let wx = 0, wy = 0, wz = 0, wsum = 0;
    for (const s of this.stars()) {
      const sb = this.nbody.get(s.id);
      if (!sb) continue;
      const w = (s.lum ?? 1) + 1e-6;
      wx += sb.x * w; wy += sb.y * w; wz += sb.z * w; wsum += w;
    }
    if (wsum === 0) return false;
    out.set(wx / wsum - b.x, wy / wsum - b.y, wz / wsum - b.z);
    if (out.lengthSq() < 1e-12) return false;
    out.normalize();
    return true;
  }

  dispose() { disposeTree(this.group); this.group.clear(); }
}

function toSim(b: BodyDef): SimBody {
  return { id: b.id, mass: b.mass, radius: b.radius, x: b.pos[0], y: b.pos[1], z: b.pos[2], vx: b.vel[0], vy: b.vel[1], vz: b.vel[2], ax: 0, ay: 0, az: 0 };
}

/** Mesh for any body kind (shared by the system and planet views). */
export function buildBodyMesh(b: BodyDef, withLight: boolean, radiusOverride?: number): THREE.Mesh {
  const R = radiusOverride ?? b.radius;
  const seg = b.kind === 'star' ? 40 : radiusOverride ? 64 : 28;
  const geo = new THREE.SphereGeometry(R, seg, Math.round(seg * 0.7));
  let mesh: THREE.Mesh;
  if (b.kind === 'blackhole') {
    mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x000000 }));
    const disk = new THREE.Mesh(
      new THREE.RingGeometry(R * 1.5, R * 4.5, 96, 1),
      new THREE.MeshBasicMaterial({ map: accretionTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    // planar ring UVs: the square radial-gradient texture maps centre-to-centre
    disk.rotation.x = Math.PI / 2 - 0.25;
    mesh.add(disk);
    mesh.add(glowSprite(glowTexture('rgba(255,180,110,1)'), 0xff9a5c, R * 6, 0.35));
    return mesh;
  }
  const tex = planetTexture(b.tex, b.color, b.texSeed ?? hashString(b.id));
  if (b.kind === 'star') {
    mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
    if (withLight) {
      const light = new THREE.PointLight(new THREE.Color(b.color).lerp(new THREE.Color(0xffffff), 0.6), 2.6, 0, 0);
      mesh.add(light);
    }
    mesh.add(glowSprite(glowTexture(), b.color, R * 7));
  } else {
    mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.9, metalness: 0.05, emissive: new THREE.Color(b.color), emissiveIntensity: 0.06,
    }));
  }
  if (b.ring) {
    const ring = new THREE.Mesh(
      radialRingGeometry(R * 1.5, R * 2.6, 96),
      new THREE.MeshBasicMaterial({ map: ringTexture(), side: THREE.DoubleSide, transparent: true, depthWrite: false }),
    );
    ring.rotation.x = Math.PI / 2 - 0.35;
    mesh.add(ring);
  }
  return mesh;
}

/** RingGeometry with u = radial fraction, so 1-D band textures draw as concentric rings. */
export function radialRingGeometry(inner: number, outer: number, segments: number): THREE.RingGeometry {
  const g = new THREE.RingGeometry(inner, outer, segments, 1);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    uv.setXY(i, (r - inner) / (outer - inner), 0.5);
  }
  uv.needsUpdate = true;
  return g;
}

function hashString(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 997) + 1;
}

export { toAU, toDisplay };

/** What to call a body in lists. IAU recognises five dwarf planets; Sedna is a candidate. */
const IAU_DWARFS = new Set(['ceres', 'pluto', 'haumea', 'makemake', 'eris']);
function bodyLabel(d: BodyDef): string {
  if (d.kepler) return IAU_DWARFS.has(d.id) ? 'dwarf planet' : /halley|comet|^\d+p\//i.test(d.id + d.name) ? 'comet' : 'small body';
  return d.kind === 'blackhole' ? 'black hole' : d.kind;
}
