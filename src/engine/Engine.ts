import * as THREE from 'three';
import { DEFAULT_PHYSICS, type PhysicsParams } from '../sim/physics';
import { getPreset, proceduralSystem, smbhSystem, type SystemDef, type SystemSnapshot, type BodyDef } from '../sim/systems';
import { REAL_LAWS, deriveLaws, type Laws, type Derived } from '../sim/laws';
import type { ClockState } from '../sim/cosmology';
import { MILKY_WAY, type GalaxyParams } from '../sim/galaxy';
import { DEFAULT_UNIVERSE, galaxyParamsFor, type UniverseParams } from '../sim/universe';
import { softDotTexture, reticleTexture } from '../sim/textures';
import { LEVEL_ORDER, ALL_LEVELS, type Level, type View, type SelectionInfo, type LevelStats, type LabelSpec, type FrameCtx } from './common';
import { UniverseView } from './views/UniverseView';
import { GalaxyView, type StarEntry } from './views/GalaxyView';
import { SystemView, type SpawnSpec } from './views/SystemView';
import { PlanetView } from './views/PlanetView';
import { MapView, mapRadius, mapInverse, type MapAction, type Isolation, type SearchHit } from './views/MapView';
import { dataStore } from '../data/store';
import type { Category, Lookup } from '../data/layers';
import type { Vec3 } from '../sim/ephemeris';

export type { Level, SelectionInfo, LevelStats } from './common';
export type { Isolation, SearchHit } from './views/MapView';
export interface MapBookmark { center: Vec3; jd: number; orbit: { theta: number; phi: number; dist: number }; isolation: Isolation | null; selected: string | null }
export type { SpawnSpec, SpawnKind } from './views/SystemView';

export interface Crumb { level: Level; label: string }
export interface WorldContext {
  level: Level;
  crumbs: Crumb[];
  universe: UniverseParams;
  galaxy: GalaxyParams | null;
  system: { name: string; subtitle: string } | null;
}

/** Everything needed to recreate a universe exactly (used to fork parallel universes). */
export interface EngineState {
  physics: PhysicsParams;
  laws: Laws;
  universe: UniverseParams;
  clock: ClockState;
  galaxyIndex: number;
  galaxyOverrides: [number, GalaxyParams][];
  galaxyTimeMyr: number;
  level: Level;
  system: SystemSnapshot | null;
  systemKey: string;
  planetId: string | null;
  camera: { pos: [number, number, number]; yaw: number; pitch: number };
  map?: { center: Vec3; jd: number; orbit: { theta: number; phi: number; dist: number } };
}

export interface SummaryRow { k: string; v: string; num?: number }

export interface EngineEvents {
  onSelect(info: SelectionInfo | null): void;
  onContext(ctx: WorldContext): void;
  onWarp(active: boolean): void;
  onStats(stats: LevelStats): void;
  onToast(msg: string): void;
  onPlacement(active: boolean): void;
  onPhysics(p: PhysicsParams): void; // engine-initiated changes (keyboard)
  onFocus?(): void;                   // user clicked this universe's canvas
}

const THRUST: Record<Level, number> = { map: 0, universe: 900, galaxy: 110, system: 14, planet: 5 };
const FOLLOW_MIN: Record<Level, number> = { map: 1, universe: 30, galaxy: 4, system: 1, planet: 2.5 };
const CLIP: Record<Level, [number, number]> = { map: [0.01, 60000], universe: [0.5, 80000], galaxy: [0.05, 40000], system: [0.01, 40000], planet: [0.01, 40000] };
const MAP_DIST: [number, number] = [0.4, 9000];

interface Label { id: string; el: HTMLDivElement; pos: () => THREE.Vector3; visible?: () => boolean }

const _v = new THREE.Vector3();
const _plane = new THREE.Plane();
const _ray = new THREE.Raycaster();

export class Engine {
  private container: HTMLElement;
  private labelsLayer: HTMLElement;
  private ev: EngineEvents;

  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(58, 1, 0.05, 40000);
  private lastFrame = 0;
  private raf = 0;
  private ro: ResizeObserver | null = null;
  private disposed = false;
  private cleanup: (() => void)[] = [];

  physics: PhysicsParams = { ...DEFAULT_PHYSICS };
  laws: Laws = { ...REAL_LAWS };
  derived: Derived = deriveLaws(REAL_LAWS, 1);
  level: Level = 'map';
  private active = true;
  private restoreState: EngineState | null = null;

  private universeParams: UniverseParams = { ...DEFAULT_UNIVERSE };
  private universe!: UniverseView;
  private map!: MapView;
  private mapOrbit = { theta: 0.6, phi: 1.05, dist: 300 };
  // fisheye lens (universe map)
  private cubeRT: THREE.WebGLCubeRenderTarget | null = null;
  private cubeCam: THREE.CubeCamera | null = null;
  private fishScene: THREE.Scene | null = null;
  private fishCam: THREE.OrthographicCamera | null = null;
  private fishMat: THREE.ShaderMaterial | null = null;
  private galaxy: GalaxyView | null = null;
  private galaxyIndex = -1;
  private galaxyOverrides = new Map<number, GalaxyParams>();
  private system: SystemView | null = null;
  private systemKey = '';
  private systemFactory: (() => SystemDef) | null = null;
  private planet: PlanetView | null = null;

  private starfield!: THREE.Points;
  private streaks!: THREE.LineSegments;
  private reticle!: THREE.Sprite;

  // camera
  private mode: 'free' | 'follow' = 'free';
  private yaw = 0; private pitch = -0.25; private roll = 0;
  private vel = new THREE.Vector3();
  private speedScale = 1;
  private keys = new Set<string>();
  private follow = { theta: 0.8, phi: 1.1, dist: 30 };
  private selectedId: string | null = null;
  private mobileThrust = 0;

  // input
  private pointers = new Map<number, { x: number; y: number }>();
  private downPos = { x: 0, y: 0, t: 0 };
  private pinchDist = 0;
  private lastClick = { t: 0, id: '' };
  private pendingSpawn: SpawnSpec | null = null;

  // warp
  private warping = false;
  private warpT = 0;
  private warpSwap: (() => void) | null = null;
  private warpSwapped = false;
  private instantWarp = new URLSearchParams(window.location.search).has('instant');

  // HUD sync
  private labels: Label[] = [];
  private labelsKey = '';
  private lastStats = 0;
  private lastInfo = 0;

  constructor(container: HTMLElement, labelsLayer: HTMLElement, events: EngineEvents, initial?: Partial<PhysicsParams>, state?: EngineState) {
    this.container = container;
    this.labelsLayer = labelsLayer;
    this.ev = events;
    if (initial) Object.assign(this.physics, initial);
    if (state) {
      this.restoreState = state;
      this.physics = { ...state.physics };
      this.laws = { ...state.laws };
      this.universeParams = { ...state.universe };
      this.galaxyOverrides = new Map(state.galaxyOverrides);
    }
    this.derived = deriveLaws(this.laws, this.physics.gMult);
    this.init();
  }

  // ───────────── setup ─────────────

  private init() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = 'cosmos-canvas';
    this.container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x020409);
    this.scene.add(this.camera);
    this.scene.add(new THREE.AmbientLight(0x8899ff, 0.35));

    this.buildStarfield();
    this.buildStreaks();
    this.reticle = new THREE.Sprite(new THREE.SpriteMaterial({ map: reticleTexture(), transparent: true, depthWrite: false, depthTest: false }));
    this.reticle.visible = false;
    this.reticle.renderOrder = 999;
    this.scene.add(this.reticle);

    this.universe = new UniverseView(this.universeParams, this.physics);
    this.universe.group.visible = false;
    this.scene.add(this.universe.group);
    this.map = new MapView(this.universe.field, this.physics);
    this.scene.add(this.map.group);

    this.onResize();
    this.showLevel('map');
    if (this.restoreState) this.applyRestore(this.restoreState);
    this.bindInput();
    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(this.container);
    this.emitContext();
    this.loop();
  }

  private applyRestore(st: EngineState) {
    this.universe.clock.restore(st.clock);
    if (st.map) { this.map.setState(st.map); this.mapOrbit = { ...st.map.orbit }; }
    if (st.galaxyIndex >= 0) {
      this.ensureGalaxy(st.galaxyIndex);
      this.galaxy!.advance(st.galaxyTimeMyr, st.physics.darkMatter, st.physics.gMult);
    }
    if (st.system) {
      const snap = st.system;
      this.setSystem(() => snapshotToDef(snap), st.systemKey);
    }
    if (st.planetId && this.system?.bodyDef(st.planetId)) {
      this.planet = new PlanetView(this.system, st.planetId);
      this.scene.add(this.planet.group);
    }
    const lvl: Level = st.level === 'planet' && !this.planet ? 'system' : st.level === 'system' && !this.system ? 'galaxy' : st.level === 'galaxy' && !this.galaxy ? 'map' : st.level;
    this.showLevel(lvl);
    if (st.map) this.mapOrbit = { ...st.map.orbit };
    if (lvl !== 'map') {
      this.camera.position.set(...st.camera.pos);
      this.yaw = st.camera.yaw; this.pitch = st.camera.pitch;
      this.applyRotation();
    }
    this.restoreState = null;
  }

  /** Full state for forking into a parallel universe. */
  exportState(): EngineState {
    return {
      physics: { ...this.physics, paused: this.physics.paused },
      laws: { ...this.laws },
      universe: { ...this.universeParams },
      clock: this.universe.clock.state(),
      galaxyIndex: this.galaxy ? this.galaxyIndex : -1,
      galaxyOverrides: [...this.galaxyOverrides.entries()].map(([k, v]) => [k, { ...v }] as [number, GalaxyParams]),
      galaxyTimeMyr: this.galaxy?.timeMyr ?? 0,
      level: this.level,
      system: this.system?.snapshot() ?? null,
      systemKey: this.systemKey,
      planetId: this.planet?.planetId ?? null,
      camera: { pos: [this.camera.position.x, this.camera.position.y, this.camera.position.z], yaw: this.yaw, pitch: this.pitch },
      map: { ...this.map.getState(), orbit: { ...this.mapOrbit } },
    };
  }

  /** Numbers for the parallel-universe comparison table. */
  summary(): SummaryRow[] {
    const c = this.universe.clock;
    const age = c.age();
    const rows: SummaryRow[] = [
      { k: 'Level', v: this.level === 'map' ? 'universe map' : this.level === 'universe' ? 'cosmic expansion' : this.level },
      { k: 'G', v: `${this.physics.gMult.toFixed(3)}×`, num: this.physics.gMult },
      { k: 'Cosmic age', v: age === null ? '—' : `${age.toFixed(3)} Gyr`, num: age ?? undefined },
      { k: 'Scale factor a', v: c.a.toFixed(4), num: c.a },
      { k: 'H(t)', v: `${c.hubbleKms().toFixed(1)} km/s/Mpc`, num: c.hubbleKms() },
      { k: 'Ωm / ΩΛ', v: `${this.physics.omegaM.toFixed(3)} / ${this.physics.omegaL.toFixed(3)}` },
      { k: 'Dark-matter halo', v: `${this.physics.darkMatter.toFixed(2)}×`, num: this.physics.darkMatter },
      { k: 'Star luminosity', v: `${this.derived.lumFactor.toPrecision(3)}× ours`, num: this.derived.lumFactor },
      { k: 'Star lifetime', v: `${(10 * this.derived.lifetimeFactor).toPrecision(3)} Gyr`, num: this.derived.lifetimeFactor },
      { k: 'Primordial helium', v: `${(this.derived.heliumY * 100).toFixed(1)} %`, num: this.derived.heliumY },
      { k: 'Life-friendly physics', v: this.derived.life === 'ok' ? 'plausible' : this.derived.life === 'warn' ? 'marginal' : 'unlikely' },
    ];
    if (this.galaxy) rows.push({ k: 'Galaxy', v: this.galaxy.params.name }, { k: 'Galactic time', v: `${this.galaxy.timeMyr.toFixed(0)} Myr`, num: this.galaxy.timeMyr });
    if (this.system) {
      const st = this.system.stats(this.physics);
      rows.push({ k: 'System', v: this.system.def.name });
      for (const r of st.rows.slice(0, 3)) rows.push({ k: r.k, v: r.v });
    }
    return rows;
  }

  /** Current positions of N-body bodies (for divergence between parallel universes). */
  bodyPositions(): Map<string, [number, number, number]> {
    const m = new Map<string, [number, number, number]>();
    if (this.system) for (const b of this.system.nbody.bodies) m.set(b.id, [b.x, b.y, b.z]);
    return m;
  }
  systemIdentity(): string { return this.systemKey; }

  setLaws(l: Partial<Laws>) {
    this.laws = { ...this.laws, ...l };
    this.derived = deriveLaws(this.laws, this.physics.gMult);
  }

  setActive(on: boolean) { this.active = on; if (!on) this.keys.clear(); }

  private onResize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private buildStarfield() {
    const n = 7000, r = 20000;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      pos.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
      const t = Math.random();
      const c = t < 0.75 ? [0.9, 0.92, 1] : t < 0.9 ? [1, 0.95, 0.85] : [0.8, 0.85, 1];
      const b = 0.25 + Math.random() * 0.55;
      col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.starfield = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 30, sizeAttenuation: true, vertexColors: true, map: softDotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.starfield.frustumCulled = false;
    this.scene.add(this.starfield);
  }

  private buildStreaks() {
    const N = 240, pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 46;
      const x = r * Math.cos(a), y = r * Math.sin(a), z = -Math.random() * 300;
      pos.set([x, y, z, x, y, z - 4], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.streaks = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x9a92d9, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.streaks.frustumCulled = false;
    this.camera.add(this.streaks);
  }

  // ───────────── views ─────────────

  private view(level = this.level): View | null {
    return level === 'map' ? this.map : level === 'universe' ? this.universe : level === 'galaxy' ? this.galaxy : level === 'system' ? this.system : this.planet;
  }

  private galaxyParamsAt(index: number): GalaxyParams {
    return this.galaxyOverrides.get(index) ?? (index === 0 ? MILKY_WAY : galaxyParamsFor(this.universe.field, index));
  }

  private ensureGalaxy(index: number) {
    if (this.galaxy && this.galaxyIndex === index) return;
    this.disposeView('galaxy');
    this.disposeView('system');
    this.disposeView('planet');
    this.galaxyIndex = index;
    this.galaxy = new GalaxyView(this.galaxyParamsAt(index), this.physics.darkMatter, index === 0);
    this.galaxy.group.visible = false;
    this.scene.add(this.galaxy.group);
  }

  private setSystem(factory: () => SystemDef, key: string) {
    this.disposeView('system');
    this.disposeView('planet');
    this.systemKey = key;
    this.systemFactory = factory;
    this.system = new SystemView(factory());
    this.system.onMerge = (_m, gone, into) => this.ev.onToast(`${gone} merged into ${into}`);
    this.system.group.visible = false;
    this.scene.add(this.system.group);
  }

  private disposeView(level: Level) {
    const v = this.view(level);
    if (!v || level === 'universe' || level === 'map') return;
    this.scene.remove(v.group);
    v.dispose();
    if (level === 'galaxy') { this.galaxy = null; this.galaxyIndex = -1; }
    if (level === 'system') { this.system = null; this.systemKey = ''; }
    if (level === 'planet') this.planet = null;
  }

  private showLevel(level: Level) {
    for (const l of ALL_LEVELS) { const v = this.view(l); if (v) v.group.visible = l === level; }
    this.starfield.visible = level !== 'map';
    this.level = level;
    const [near, far] = CLIP[level];
    this.camera.near = near; this.camera.far = far; this.camera.updateProjectionMatrix();
    this.select(null);
    this.setCameraPreset(level);
    this.labelsKey = '';
    this.emitContext();
  }

  private emitContext() {
    const crumbs: Crumb[] = [{ level: 'map', label: 'Observable universe' }];
    if (this.level === 'universe') crumbs.push({ level: 'universe', label: 'Cosmic expansion' });
    const idx = LEVEL_ORDER.indexOf(this.level);
    if (idx >= 1) crumbs.push({ level: 'galaxy', label: this.galaxy?.params.name ?? 'Milky Way' });
    if (idx >= 2 && this.system) crumbs.push({ level: 'system', label: this.system.def.name });
    if (idx >= 3 && this.planet) crumbs.push({ level: 'planet', label: this.system?.bodyDef(this.planet.planetId)?.name ?? 'Planet' });
    this.ev.onContext({
      level: this.level, crumbs, universe: { ...this.universeParams },
      galaxy: this.galaxy ? { ...this.galaxy.params } : null,
      system: this.system ? { name: this.system.def.name, subtitle: this.system.def.subtitle } : null,
    });
  }

  // ───────────── navigation ─────────────

  private warpTo(swap: () => void) {
    if (this.warping) {
      if (!this.warpSwapped) { this.warpSwap = swap; return; } // first half of a warp: the latest request wins
      this.warping = false;
      (this.streaks.material as THREE.LineBasicMaterial).opacity = 0;
      this.ev.onWarp(false);
    }
    this.cancelPlacement();
    if (this.instantWarp || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) { swap(); return; }
    this.warping = true;
    this.warpT = 0;
    this.warpSwapped = false;
    this.warpSwap = swap;
    this.ev.onWarp(true);
  }

  /** Breadcrumb navigation (upwards, or re-show a cached deeper level). */
  goToLevel(level: Level) {
    if (level === this.level) return;
    if (level === 'galaxy' && !this.galaxy) { this.warpTo(() => { this.ensureGalaxy(0); this.showLevel('galaxy'); }); return; }
    if (level === 'system' && !this.system) { this.loadPreset('solar'); return; }
    if (level === 'planet' && !this.planet) return;
    this.warpTo(() => this.showLevel(level));
  }

  goUp() {
    if (this.level === 'universe') { this.goToLevel('map'); return; }
    const i = LEVEL_ORDER.indexOf(this.level);
    if (i > 0) this.goToLevel(LEVEL_ORDER[i - 1]);
  }

  enterGalaxy(index: number) {
    this.warpTo(() => { this.ensureGalaxy(index); this.showLevel('galaxy'); });
  }

  enterStar(entry: StarEntry) {
    const key = `star:${this.galaxyIndex}:${entry.seed}`;
    this.warpTo(() => {
      if (this.systemKey !== key) {
        this.setSystem(() => (entry.preset && getPreset(entry.preset)) || proceduralSystem({ seed: entry.seed, name: entry.name, cls: entry.cls }), key);
      }
      this.showLevel('system');
    });
  }

  /** The galaxy's central supermassive black hole. */
  enterNucleus() {
    if (!this.galaxy) return;
    const g = this.galaxy;
    const key = `nucleus:${this.galaxyIndex}`;
    this.warpTo(() => {
      if (this.systemKey !== key) {
        const mw = g.params.name === 'Milky Way';
        this.setSystem(() => (mw ? getPreset('sgra')! : smbhSystem(`nuc-${g.params.seed}`, `${g.params.name} nucleus`, g.smbhMass(), g.params.seed,
          'Supermassive black hole at the centre of this galaxy; mass from the bulge–black-hole relation.')), key);
      }
      this.showLevel('system');
    });
  }

  /** Load any system definition (e.g. from the exoplanet catalog). */
  loadDef(make: () => SystemDef, key: string) {
    this.warpTo(() => { this.ensureGalaxyContext(); this.setSystem(make, `${key}:${Date.now()}`); this.showLevel('system'); });
  }

  enterPlanet(id: string) {
    if (!this.system) return;
    this.warpTo(() => {
      if (!this.system?.bodyDef(id)) return;
      if (this.planet?.planetId !== id) {
        this.disposeView('planet');
        this.planet = new PlanetView(this.system, id);
        this.scene.add(this.planet.group);
      }
      this.showLevel('planet');
    });
  }

  enterSelected() {
    const id = this.selectedId;
    if (!id) return;
    if (this.level === 'map') { this.runMapAction(this.map.action(id)); return; }
    if (this.level === 'universe') { const i = this.universe.indexOf(id); if (i >= 0) this.enterGalaxy(i); }
    else if (this.level === 'galaxy' && this.galaxy) {
      if (id === 'core') { this.enterNucleus(); return; }
      const i = this.galaxy.indexOf(id); if (i >= 0) this.enterStar(this.galaxy.starEntry(i));
    }
    else if (this.level === 'system') {
      const k = this.system?.bodyDef(id)?.kind;
      if (k === 'planet' || k === 'blackhole') this.enterPlanet(id);
    }
  }

  private runMapAction(a: MapAction) {
    switch (a.kind) {
      case 'galaxy': this.enterGalaxy(a.index); break;
      case 'galaxyDef': this.galaxyOverrides.set(a.key, a.params); this.enterGalaxy(a.key); break;
      case 'star': this.warpTo(() => { this.ensureGalaxy(0); this.setSystem(() => proceduralSystem({ seed: a.entry.seed, name: a.entry.name, cls: a.entry.cls }), `star:0:${a.entry.seed}`); this.showLevel('system'); }); break;
      case 'preset': this.warpTo(() => { this.ensureGalaxy(0); this.setSystem(() => getPreset(a.id)!, `preset:${a.id}`); this.showLevel('system'); }); break;
      case 'nucleus': this.warpTo(() => { this.ensureGalaxy(0); this.setSystem(() => getPreset('sgra')!, 'nucleus:0'); this.showLevel('system'); }); break;
      case 'solar': {
        const body = a.bodyId;
        this.warpTo(() => {
          this.ensureGalaxy(0);
          if (!this.systemKey.startsWith('preset:solar')) this.setSystem(() => getPreset('solar')!, 'preset:solar');
          this.showLevel('system');
          if (body && this.system?.bodyDef(body)) this.select(body);
        });
        break;
      }
      default: this.ev.onToast('Nothing more detailed to open here yet — use “Fly here” to travel to it.');
    }
  }

  /** Map: fly the viewpoint to the selected object (log-scale journey). */
  travelToSelected() {
    if (this.level !== 'map' || !this.selectedId) return;
    const eps = this.map.flyTo(this.selectedId);
    if (eps !== null) this.mapZoomTarget = Math.max(mapRadius(eps * 40), 30);
  }
  // ── explore: search, select anything, show only it ──
  mapSearch(q: string): SearchHit[] { return this.map.search(q); }
  mapBrowse(cat: Category): SearchHit[] { return this.map.browse(cat); }
  mapIsolation(): Isolation | null { return this.map.isolation(); }
  /** Select an object on the universe map and fly to it. */
  focusObject(id: string, fly = true) {
    const go = () => { this.select(id); if (fly && this.selectedId === id) this.travelToSelected(); };
    if (this.level !== 'map') { this.goToLevel('map'); setTimeout(go, 900); } else go();
  }
  /** Hide everything except this object and the space around it (normal and fisheye lenses alike). */
  showOnly(id?: string) {
    const run = () => {
      const target = id ?? this.selectedId;
      if (!target) return;
      const r = this.map.isolateObject(target);
      if (!r) { this.ev.onToast('Can’t isolate that object.'); return; }
      this.select(target);
      if (this.selectedId === target) this.map.flyTo(target);
      this.mapZoomTarget = Math.min(Math.max(mapRadius(r.radius) * 2.6, 3), MAP_DIST[1]);
      this.ev.onToast(`Showing only ${r.label}`);
    };
    if (this.level !== 'map') { this.goToLevel('map'); setTimeout(run, 900); } else run();
  }
  showCategory(cat: Category) {
    if (this.level !== 'map') this.goToLevel('map');
    this.map.isolateCategory(cat);
    this.ev.onStats(this.map.stats(this.physics));
  }
  showAll() { this.map.clearIsolation(); this.ev.onStats(this.map.stats(this.physics)); }
  /** Look any name up in SIMBAD, place it on the map and fly there. */
  async lookupName(name: string): Promise<Lookup | null> {
    const l = await dataStore.lookup(name, { H0: this.physics.H0, omegaM: this.physics.omegaM, omegaL: this.physics.omegaL, gMult: this.physics.gMult });
    if (!l || !isFinite(l.distLy)) return l;
    await new Promise((r) => setTimeout(r, 150));
    const hit = this.map.search(l.name, 1)[0];
    if (hit) this.focusObject(hit.id);
    return l;
  }
  cosmoParams() { return { H0: this.physics.H0, omegaM: this.physics.omegaM, omegaL: this.physics.omegaL, gMult: this.physics.gMult }; }

  /** Universe-map bookmark: viewpoint, camera orbit, date and what is shown. */
  mapBookmark(): MapBookmark { return { ...this.map.getState(), orbit: { ...this.mapOrbit }, isolation: this.map.isolation(), selected: this.level === 'map' ? this.selectedId : null }; }
  gotoBookmark(b: MapBookmark) {
    const apply = () => {
      this.map.setState({ center: b.center, jd: b.jd });
      this.mapOrbit = { ...b.orbit };
      this.mapZoomTarget = null;
      if (!b.isolation) this.map.clearIsolation();
      else if (b.isolation.kind === 'category') this.map.isolateCategory(b.isolation.cat);
      else this.map.isolateObject(b.isolation.id);
      if (b.selected) this.select(b.selected);
    };
    if (this.level !== 'map') { this.goToLevel('map'); setTimeout(apply, 900); } else apply();
  }

  mapHome() { if (this.level === 'map') { this.map.resetCenter(); this.mapZoomTarget = 300; } else this.goToLevel('map'); }
  openExpansion() { this.warpTo(() => this.showLevel('universe')); }
  setMapDate(d: Date) { this.map.setDate(d); }
  private mapZoomTarget: number | null = null;

  private ensureGalaxyContext() {
    if (!this.galaxy) this.ensureGalaxy(Math.max(this.galaxyIndex, 0));
  }

  loadPreset(id: string) {
    if (!getPreset(id)) return;
    this.warpTo(() => { this.ensureGalaxyContext(); this.setSystem(() => getPreset(id)!, `preset:${id}:${Date.now()}`); this.showLevel('system'); });
  }

  generateSystem(seed?: number) {
    const s = seed ?? Math.floor(Math.random() * 1e9);
    this.warpTo(() => { this.ensureGalaxyContext(); this.setSystem(() => proceduralSystem({ seed: s }), `seed:${s}:${Date.now()}`); this.showLevel('system'); });
  }

  loadSnapshot(snap: SystemSnapshot) {
    const make = () => snapshotToDef(snap);
    this.warpTo(() => { this.ensureGalaxyContext(); this.setSystem(make, `save:${Date.now()}`); this.showLevel('system'); });
  }

  /** Rebuild the current system from its original definition. */
  resetSystem() {
    if (!this.system || !this.systemFactory) return;
    const f = this.systemFactory, key = this.systemKey, lvl = this.level;
    this.setSystem(f, key);
    this.showLevel(lvl === 'planet' ? 'system' : lvl);
  }

  snapshot(): SystemSnapshot | null { return this.system?.snapshot() ?? null; }

  setUniverseParams(p: Partial<UniverseParams>) {
    this.universeParams = { ...this.universeParams, ...p };
    this.disposeView('planet'); this.disposeView('system'); this.disposeView('galaxy');
    this.galaxyOverrides.clear();
    this.scene.remove(this.universe.group);
    this.universe.dispose();
    this.universe = new UniverseView(this.universeParams, this.physics);
    this.scene.add(this.universe.group);
    this.showLevel('universe');
  }

  /** Regenerate the current galaxy with edited parameters (kept for this session). */
  setGalaxyParams(p: Partial<GalaxyParams>) {
    if (!this.galaxy || this.galaxyIndex < 0) return;
    const idx = this.galaxyIndex;
    const next = { ...this.galaxy.params, ...p };
    this.galaxyOverrides.set(idx, next);
    this.disposeView('planet'); this.disposeView('system'); this.disposeView('galaxy');
    this.ensureGalaxy(idx);
    this.showLevel('galaxy');
  }

  // ───────────── selection ─────────────

  select(id: string | null) {
    this.selectedId = id;
    if (!id) {
      this.mode = 'free';
      this.reticle.visible = false;
      this.ev.onSelect(null);
      return;
    }
    const r = this.view()?.target(id, _v);
    if (r === null || r === undefined) { this.select(null); return; }
    if (this.level === 'system' || this.level === 'planet') this.startFollow(r);
    this.pushInfo(true);
  }

  private startFollow(radius: number) {
    // derive orbit angles from the current viewing direction for a smooth hand-off
    const off = this.camera.position.clone().sub(_v);
    const len = off.length();
    if (len > 1e-6) {
      this.follow.theta = Math.atan2(off.x, off.z);
      this.follow.phi = THREE.MathUtils.clamp(Math.acos(off.y / len), 0.15, Math.PI - 0.15);
    }
    this.follow.dist = Math.max(radius * 7, FOLLOW_MIN[this.level]);
    this.mode = 'follow';
  }

  /** Toggle camera follow on the selection (any level). */
  toggleFocus() {
    if (!this.selectedId) return;
    if (this.level === 'map') { this.travelToSelected(); return; }
    if (this.mode === 'follow') { this.mode = 'free'; return; }
    const r = this.view()?.target(this.selectedId, _v);
    if (r !== null && r !== undefined) this.startFollow(r);
  }

  isFollowing() { return this.mode === 'follow'; }

  private pushInfo(force = false) {
    const now = performance.now();
    if (!force && now - this.lastInfo < 300) return;
    this.lastInfo = now;
    if (!this.selectedId) return;
    const info = this.view()?.info(this.selectedId) ?? null;
    if (!info) { this.select(null); return; }
    this.ev.onSelect(info);
  }

  // ───────────── editing (system level) ─────────────

  spawn(spec: SpawnSpec) {
    if (!this.system || this.level !== 'system') { this.ev.onToast('Open a star system to add bodies.'); return; }
    const d = this.system.addBody(spec);
    if (d) { this.labelsKey = ''; this.select(d.id); this.ev.onToast(`${d.name} added`); }
  }

  armPlacement(spec: SpawnSpec) {
    if (!this.system || this.level !== 'system') { this.ev.onToast('Open a star system to add bodies.'); return; }
    this.pendingSpawn = spec;
    this.renderer.domElement.classList.add('placing');
    this.ev.onPlacement(true);
  }

  cancelPlacement() {
    if (!this.pendingSpawn) return;
    this.pendingSpawn = null;
    this.renderer.domElement.classList.remove('placing');
    this.ev.onPlacement(false);
  }

  setSelectedMass(massSim: number) { if (this.selectedId && this.system) { this.system.setMass(this.selectedId, massSim); this.pushInfo(true); } }
  kickSelected(f: number) { if (this.selectedId && this.system) { this.system.kick(this.selectedId, f); this.pushInfo(true); } }
  deleteSelected() {
    if (!this.selectedId || !this.system || this.level !== 'system') return;
    const name = this.system.bodyDef(this.selectedId)?.name;
    this.system.remove(this.selectedId);
    this.select(null);
    if (name) this.ev.onToast(`${name} removed`);
  }
  addMoonToSelected() {
    if (!this.selectedId || !this.system) return;
    const d = this.system.addMoon(this.selectedId);
    if (d) this.ev.onToast(`${d.name} added`);
  }

  setPhysics(p: Partial<PhysicsParams>) {
    Object.assign(this.physics, p);
    if (p.gMult !== undefined) this.derived = deriveLaws(this.laws, this.physics.gMult);
  }
  setMobileThrust(dir: number) { this.mobileThrust = dir; }

  // ───────────── input ─────────────

  private onWin<K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) {
    window.addEventListener(type, fn);
    this.cleanup.push(() => window.removeEventListener(type, fn));
  }
  private onEl<K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) {
    el.addEventListener(type, fn, opts);
    this.cleanup.push(() => el.removeEventListener(type, fn, opts));
  }

  private bindInput() {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';

    this.onEl(el, 'pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) this.downPos = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    this.onEl(el, 'pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.dolly((this.pinchDist - d) * -0.02);
        this.pinchDist = d;
        return;
      }
      if (this.pointers.size !== 1) return;
      if (this.level === 'map') {
        const k = this.physics.fisheye ? 0.004 : 0.005;
        this.mapOrbit.theta -= dx * k;
        this.mapOrbit.phi = THREE.MathUtils.clamp(this.mapOrbit.phi - dy * k, 0.05, Math.PI - 0.05);
        return;
      }
      if (this.mode === 'follow') {
        this.follow.theta -= dx * 0.006;
        this.follow.phi = THREE.MathUtils.clamp(this.follow.phi - dy * 0.006, 0.15, Math.PI - 0.15);
      } else {
        this.yaw -= dx * 0.0032;
        this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0032, -1.45, 1.45);
      }
    });
    const end = (e: PointerEvent) => {
      const single = this.pointers.size === 1;
      this.pointers.delete(e.pointerId);
      if (!single) return;
      const dist = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
      if (dist < 8 && performance.now() - this.downPos.t < 500) this.handleClick(e.clientX, e.clientY);
    };
    this.onEl(el, 'pointerup', end);
    this.onEl(el, 'pointercancel', (e) => this.pointers.delete(e.pointerId));
    this.onEl(el, 'wheel', (e) => { e.preventDefault(); this.dolly(-e.deltaY * 0.002); }, { passive: false });

    this.onWin('keydown', (e) => {
      if (!this.active) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      this.keys.add(e.code);
      switch (e.code) {
        case 'Escape': if (this.pendingSpawn) this.cancelPlacement(); else this.select(null); break;
        case 'Space': e.preventDefault(); this.patchPhysics({ paused: !this.physics.paused }); break;
        case 'BracketLeft': this.patchPhysics({ timeWarp: Math.max(this.physics.timeWarp / 2, 0.1) }); break;
        case 'BracketRight': this.patchPhysics({ timeWarp: Math.min(this.physics.timeWarp * 2, 200) }); break;
        case 'Backslash': this.patchPhysics({ reverse: !this.physics.reverse }); break;
        case 'KeyL': this.patchPhysics({ labels: !this.physics.labels }); break;
        case 'KeyC': this.toggleFocus(); break;
        case 'Enter': this.enterSelected(); break;
        case 'Backspace': e.preventDefault(); this.goUp(); break;
        case 'Delete': this.deleteSelected(); break;
      }
    });
    this.onWin('keyup', (e) => this.keys.delete(e.code));
    this.onEl(el, 'pointerdown', () => this.ev.onFocus?.());
    this.onWin('blur', () => this.keys.clear());
  }

  private patchPhysics(p: Partial<PhysicsParams>) {
    this.setPhysics(p);
    this.ev.onPhysics({ ...this.physics });
  }

  private dolly(amount: number) {
    if (this.level === 'map') {
      this.mapZoomTarget = null;
      this.mapOrbit.dist = THREE.MathUtils.clamp(this.mapOrbit.dist * Math.exp(-amount * 0.6), MAP_DIST[0], MAP_DIST[1]);
      return;
    }
    if (this.mode === 'follow') {
      const r = this.selectedId ? this.view()?.target(this.selectedId, _v) ?? 1 : 1;
      this.follow.dist = THREE.MathUtils.clamp(this.follow.dist * (1 - amount * 0.4), Math.max(r * 1.6, 0.05), 5000);
    } else {
      this.speedScale = THREE.MathUtils.clamp(this.speedScale * (1 - amount * 0.35), 0.05, 12);
    }
  }

  private handleClick(x: number, y: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((x - rect.left) / rect.width) * 2 - 1;
    const ny = -((y - rect.top) / rect.height) * 2 + 1;

    if (this.pendingSpawn && this.system && this.level === 'system') {
      const c = this.system.centreFor(this.pendingSpawn.aroundId);
      _ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
      _plane.set(new THREE.Vector3(0, 1, 0), -(c?.y ?? 0));
      const hit = _ray.ray.intersectPlane(_plane, new THREE.Vector3());
      if (hit) {
        const d = this.system.addBody(this.pendingSpawn, hit);
        this.cancelPlacement();
        if (d) { this.labelsKey = ''; this.select(d.id); this.ev.onToast(`${d.name} placed`); }
      } else this.ev.onToast('Click on the orbital plane (look down at the system).');
      return;
    }

    const id = this.view()?.pick(nx, ny, this.camera, rect.width, rect.height) ?? null;
    const now = performance.now();
    if (id) {
      const dbl = this.lastClick.id === id && now - this.lastClick.t < 420;
      this.lastClick = { t: now, id };
      if (id !== this.selectedId) this.select(id);
      if (dbl) this.enterSelected();
    } else {
      this.lastClick = { t: now, id: '' };
      this.select(null);
    }
  }

  // ───────────── labels ─────────────

  private rebuildLabels(specs: LabelSpec[]) {
    for (const l of this.labels) l.el.remove();
    this.labels = specs.map((s) => {
      const el = document.createElement('div');
      el.className = `cosmos-label ${s.cls}`;
      el.textContent = s.text;
      {
        el.classList.add('clickable');
        el.addEventListener('pointerup', (e) => {
          e.stopPropagation();
          if (this.selectedId === s.id) this.enterSelected(); else this.select(s.id);
        });
      }
      this.labelsLayer.appendChild(el);
      return { id: s.id, el, pos: s.pos, visible: s.visible };
    });
  }

  private updateLabels() {
    const v = this.view();
    const ver = v && 'labelsVersion' in v ? (v as unknown as { labelsVersion: number }).labelsVersion : 0;
    const key = `${this.level}:${ver}:${this.physics.labels}`;
    if (key !== this.labelsKey) {
      this.labelsKey = key;
      this.rebuildLabels(this.physics.labels && v && !this.warping ? v.labels() : []);
    }
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const proj = this.projector(w, h);
    // place labels by priority (selected → major → rest) and hide any that would overlap one already placed
    const order = [...this.labels].sort((a, b) => this.labelRank(a) - this.labelRank(b));
    const placed: [number, number, number, number][] = [];
    for (const l of order) {
      if (l.visible && l.id !== this.selectedId && !l.visible()) { l.el.style.display = 'none'; continue; }
      const s = proj(l.pos());
      const x = s.x, y = s.y;
      let hidden = !s.ok || x < -80 || x > w + 80 || y < -40 || y > h + 40;
      if (!hidden) {
        const bw = (l.el.textContent?.length ?? 4) * 7 + 18, bh = 22;
        const r: [number, number, number, number] = [x - bw / 2, y - bh * 1.3, x + bw / 2, y - bh * 0.3];
        if (l.id !== this.selectedId && placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) hidden = true;
        else placed.push(r);
      }
      l.el.style.display = hidden ? 'none' : 'block';
      if (!hidden) l.el.style.transform = `translate(-50%, -130%) translate(${x}px, ${y}px)`;
      l.el.classList.toggle('selected', l.id === this.selectedId);
    }
  }

  private labelRank(l: Label): number {
    if (l.id === this.selectedId) return 0;
    if (l.el.classList.contains('major')) return 1;
    if (l.el.classList.contains('ring')) return 4;
    if (l.el.classList.contains('tiny')) return 3;
    return 2;
  }

  /** World → CSS pixel projection for the active lens (normal perspective or fisheye). */
  private projector(w: number, h: number): (p: THREE.Vector3) => { x: number; y: number; ok: boolean } {
    if (this.level === 'map' && this.physics.fisheye) {
      const half = THREE.MathUtils.degToRad(this.physics.fisheyeFov) / 2;
      const inv = this.camera.quaternion.clone().invert();
      const rad = Math.min(w, h) / 2;
      const q = new THREE.Vector3();
      return (p) => {
        q.copy(p).sub(this.camera.position).applyQuaternion(inv);
        const len = q.length();
        if (len < 1e-9) return { x: w / 2, y: h / 2, ok: false };
        const theta = Math.acos(THREE.MathUtils.clamp(-q.z / len, -1, 1));
        if (theta > half) return { x: 0, y: 0, ok: false };
        const r = (theta / half) * rad, pl = Math.hypot(q.x, q.y) || 1;
        return { x: w / 2 + (r * q.x) / pl, y: h / 2 - (r * q.y) / pl, ok: true };
      };
    }
    return (p) => {
      _v.copy(p).project(this.camera);
      return { x: (_v.x * 0.5 + 0.5) * w, y: (-_v.y * 0.5 + 0.5) * h, ok: _v.z < 1 };
    };
  }

  /** Equidistant fisheye: render a cube map at the camera, then remap r ∝ angle (up to 360°). */
  private renderFisheye() {
    if (!this.cubeRT) {
      this.cubeRT = new THREE.WebGLCubeRenderTarget(1536, { type: THREE.HalfFloatType });
      this.cubeCam = new THREE.CubeCamera(0.01, 60000, this.cubeRT);
      this.fishScene = new THREE.Scene();
      this.fishCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.fishMat = new THREE.ShaderMaterial({
        uniforms: { tCube: { value: this.cubeRT.texture }, uHalf: { value: 1 }, uAspect: { value: 1 }, uRot: { value: new THREE.Matrix3() } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `
          uniform samplerCube tCube; uniform float uHalf; uniform float uAspect; uniform mat3 uRot; varying vec2 vUv;
          void main() {
            vec2 p = vUv * 2.0 - 1.0;
            if (uAspect > 1.0) p.x *= uAspect; else p.y /= uAspect;
            float r = length(p);
            if (r > 1.0) { gl_FragColor = vec4(0.008, 0.016, 0.035, 1.0); return; }
            float th = r * uHalf;
            vec2 d2 = r > 1e-6 ? p / r : vec2(0.0);
            vec3 dir = vec3(sin(th) * d2.x, sin(th) * d2.y, -cos(th));
            vec3 c = textureCube(tCube, uRot * dir).rgb;
            float edge = smoothstep(1.0, 0.985, r);
            gl_FragColor = vec4(c * edge, 1.0);
          }`,
        depthTest: false, depthWrite: false,
      });
      this.fishScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fishMat));
    }
    this.cubeCam!.position.copy(this.camera.position);
    this.cubeCam!.updateMatrixWorld();
    this.cubeCam!.update(this.renderer, this.scene);
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.fishMat!.uniforms.uHalf.value = THREE.MathUtils.degToRad(this.physics.fisheyeFov) / 2;
    this.fishMat!.uniforms.uAspect.value = w / h;
    (this.fishMat!.uniforms.uRot.value as THREE.Matrix3).setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(this.camera.quaternion));
    this.renderer.render(this.fishScene!, this.fishCam!);
  }

  private updateMapCamera(dt: number) {
    if (this.mapZoomTarget !== null) {
      this.mapOrbit.dist += (this.mapZoomTarget - this.mapOrbit.dist) * Math.min(dt * 1.8, 1);
      if (Math.abs(this.mapZoomTarget - this.mapOrbit.dist) < 0.5) this.mapZoomTarget = null;
    }
    const { theta, phi, dist } = this.mapOrbit;
    const sp = Math.sin(phi);
    this.camera.position.set(dist * sp * Math.sin(theta), dist * Math.cos(phi), dist * sp * Math.cos(theta));
    this.camera.lookAt(0, 0, 0);
    this.map.camDist = dist;
    // travel: WASD moves the viewpoint through REAL space; speed scales with the zoom level
    const dir = new THREE.Vector3();
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) dir.z -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) dir.z += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) dir.x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dir.x += 1;
    if (this.keys.has('KeyR')) dir.y += 1;
    if (this.keys.has('KeyF')) dir.y -= 1;
    if (this.mobileThrust !== 0) dir.z -= this.mobileThrust;
    if (dir.lengthSq() > 0) {
      const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 5 : 1;
      dir.normalize().applyQuaternion(this.camera.quaternion);
      this.map.travelBy(dir, mapInverse(dist) * 0.6 * boost * dt);
    }
  }

  // ───────────── camera ─────────────

  private setCameraPreset(level: Level) {
    this.mode = 'free';
    this.vel.set(0, 0, 0);
    this.roll = 0;
    this.speedScale = 1;
    if (level === 'map') { this.mapZoomTarget = null; return; }
    if (level === 'universe') { this.camera.position.set(0, 420, 1250); this.pitch = -0.28; }
    else if (level === 'galaxy') { this.camera.position.set(0, 105, 205); this.pitch = -0.44; }
    else if (level === 'system') {
      let maxR = 10;
      for (const b of this.system?.nbody.bodies ?? []) maxR = Math.max(maxR, Math.hypot(b.x, b.y, b.z));
      maxR = Math.min(maxR, 60);
      this.camera.position.set(0, maxR * 0.8, maxR * 1.65);
      this.pitch = -0.45;
    } else { this.camera.position.set(0, 2.2, 7.5); this.pitch = -0.18; }
    this.yaw = 0;
    this.applyRotation();
  }

  private applyRotation() {
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ'));
  }

  private updateCamera(dt: number) {
    if (this.mode === 'follow' && this.selectedId) {
      const r = this.view()?.target(this.selectedId, _v);
      if (r === null || r === undefined) { this.select(null); return; }
      const { theta, phi, dist } = this.follow;
      const sp = Math.sin(phi);
      this.camera.position.set(_v.x + dist * sp * Math.sin(theta), _v.y + dist * Math.cos(phi), _v.z + dist * sp * Math.cos(theta));
      this.camera.lookAt(_v);
      const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.yaw = e.y; this.pitch = e.x;
      return;
    }
    if (this.keys.has('KeyQ')) this.roll += dt * 1.6;
    if (this.keys.has('KeyE')) this.roll -= dt * 1.6;
    this.applyRotation();
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4 : 1;
    const accel = THRUST[this.level] * this.speedScale * boost;
    const dir = new THREE.Vector3();
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) dir.z -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) dir.z += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) dir.x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dir.x += 1;
    if (this.keys.has('KeyR')) dir.y += 1;
    if (this.keys.has('KeyF')) dir.y -= 1;
    if (this.mobileThrust !== 0) dir.z -= this.mobileThrust;
    if (dir.lengthSq() > 0) {
      if (this.mode === 'follow') this.mode = 'free';
      dir.normalize().applyQuaternion(this.camera.quaternion);
      this.vel.addScaledVector(dir, accel * dt);
    }
    this.vel.multiplyScalar(Math.exp(-1.7 * dt));
    this.camera.position.addScaledVector(this.vel, dt);
  }

  // ───────────── frame loop ─────────────

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const nowMs = performance.now();
    const dt = this.lastFrame ? Math.min((nowMs - this.lastFrame) / 1000, 0.05) : 0;
    this.lastFrame = nowMs;

    if (this.warping) this.updateWarp(dt);
    else if (this.level === 'map') this.updateMapCamera(dt);
    else this.updateCamera(dt);
    this.starfield.position.copy(this.camera.position);

    const p = this.physics;
    const ctx: FrameCtx = {
      dtReal: dt, simDt: p.paused ? 0 : dt * p.timeWarp * (p.reverse ? -1 : 1), physics: p,
      laws: this.laws, derived: this.derived, camera: this.camera,
    };
    if (this.level === 'map') {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      this.map.projector = this.projector(w, h);
      this.map.update(ctx);
    } else if (this.level === 'universe') this.universe.update(ctx);
    else if (this.level === 'galaxy') this.galaxy?.update(ctx);
    else {
      this.system?.update(ctx);
      if (this.level === 'planet' && this.planet) {
        this.planet.update(ctx);
        if (this.planet.lost) {
          this.ev.onToast('The planet was destroyed — back to the system view.');
          this.disposeView('planet');
          this.showLevel('system');
        }
      }
    }

    // reticle
    if (this.selectedId) {
      const r = this.view()?.target(this.selectedId, this.reticle.position);
      if (r === null || r === undefined) this.select(null);
      else {
        const dist = this.reticle.position.distanceTo(this.camera.position);
        this.reticle.visible = true;
        this.reticle.scale.setScalar((this.level === 'map' ? dist * 0.035 : Math.max(r * 3.2, dist * 0.045)) * (1 + Math.sin(performance.now() * 0.003) * 0.05));
      }
    }

    const now = performance.now();
    if (now - this.lastStats > 250) {
      this.lastStats = now;
      const v = this.view();
      if (v) this.ev.onStats(v.stats(p));
    }
    this.pushInfo();
    this.updateLabels();
    if (this.level === 'map' && this.physics.fisheye && !this.warping) this.renderFisheye();
    else this.renderer.render(this.scene, this.camera);
  };

  private updateWarp(dt: number) {
    this.warpT += dt / 1.5;
    const t = this.warpT;
    const mat = this.streaks.material as THREE.LineBasicMaterial;
    const intensity = t < 0.5 ? t * 2 : (1 - t) * 2;
    mat.opacity = intensity * 0.85;
    const pos = this.streaks.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const speed = 260 * intensity + 30;
    for (let i = 0; i < arr.length; i += 6) {
      arr[i + 2] += speed * dt; arr[i + 5] += speed * dt;
      if (arr[i + 2] > 6) {
        const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 46;
        const x = r * Math.cos(a), y = r * Math.sin(a), z = -280 - Math.random() * 30;
        arr[i] = x; arr[i + 1] = y; arr[i + 2] = z; arr[i + 3] = x; arr[i + 4] = y; arr[i + 5] = z - 4 - intensity * 26;
      }
    }
    pos.needsUpdate = true;
    if (t >= 0.5 && !this.warpSwapped) { this.warpSwapped = true; this.warpSwap?.(); }
    if (t >= 1) { this.warping = false; mat.opacity = 0; this.labelsKey = ''; this.ev.onWarp(false); }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    for (const c of this.cleanup) c();
    for (const l of this.labels) l.el.remove();
    for (const l of LEVEL_ORDER) this.disposeView(l);
    this.universe.dispose();
    this.map.dispose();
    this.cubeRT?.dispose();
    this.fishMat?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function snapshotToDef(snap: SystemSnapshot): SystemDef {
  return {
    ...snap.system,
    scale: { ...snap.system.scale },
    belts: snap.system.belts?.map((b: NonNullable<SystemDef['belts']>[number]) => ({ ...b })),
    bodies: snap.system.bodies.map((b: BodyDef): BodyDef => ({ ...b, pos: [b.pos[0], b.pos[1], b.pos[2]], vel: [b.vel[0], b.vel[1], b.vel[2]], kepler: b.kepler ? { ...b.kepler } : undefined })),
  };
}
