// Numerical verification of the physics core. Run: npx tsx scripts/verify-sim.ts
import { NBody, DEFAULT_PHYSICS, orbitalElements, type SimBody } from '../src/sim/physics';
import { solarSystem, trappistSystem, kepler16System } from '../src/sim/systems';
import { habitableZone, equilibriumTemp, starFromMass, planetRadiusEarth } from '../src/sim/astro';
import { ageTodayGyr, CosmicClock } from '../src/sim/cosmology';
import { _bessel, MILKY_WAY, vCirc, massModel } from '../src/sim/galaxy';

function sim(def: any, T: number, p = { ...DEFAULT_PHYSICS, collisions: false }) {
  const nb = new NBody();
  nb.set(def.bodies.filter((b: any) => b.kind !== 'moon').map((b: any) => ({ id: b.id, mass: b.mass, radius: b.radius, x: b.pos[0], y: b.pos[1], z: b.pos[2], vx: b.vel[0], vy: b.vel[1], vz: b.vel[2], ax: 0, ay: 0, az: 0 } as SimBody)));
  const d0 = nb.diagnostics(p);
  const frames = Math.round(T / 0.2);
  let maxDE = 0;
  for (let i = 0; i < frames; i++) { nb.step(0.2, p); const d = nb.diagnostics(p); maxDE = Math.max(maxDE, Math.abs((d.energy - d0.energy) / d0.energy)); }
  const d1 = nb.diagnostics(p);
  return { nb, d0, d1, maxDE };
}
// 1. Sol: energy/momentum over ~14 Earth years (100 sim-s)
let r = sim(solarSystem(), 100);
console.log('Sol  maxΔE/E', r.maxDE.toExponential(2), 'Δp', Math.hypot(r.d1.px-r.d0.px, r.d1.py-r.d0.py, r.d1.pz-r.d0.pz).toExponential(2), 'ΔLz/L', ((r.d1.lz-r.d0.lz)/r.d0.lz).toExponential(2));
// Earth period check
const sol = solarSystem(); const e = sol.bodies.find(b => b.id==='earth')!; const rE = Math.hypot(...e.pos);
console.log('Earth display r', rE.toFixed(3), 'expected period', (2*Math.PI*Math.sqrt(rE**3/400)).toFixed(3));
// 2. time reversibility: run forward 50, back 50
{ const def = solarSystem(); const nb = new NBody(); const p={...DEFAULT_PHYSICS,collisions:false};
  nb.set(def.bodies.filter(b=>b.kind!=='moon').map(b=>({id:b.id,mass:b.mass,radius:b.radius,x:b.pos[0],y:b.pos[1],z:b.pos[2],vx:b.vel[0],vy:b.vel[1],vz:b.vel[2],ax:0,ay:0,az:0})));
  const x0 = nb.get('mercury')!.x, z0 = nb.get('mercury')!.z;
  for (let i=0;i<250;i++) nb.step(0.2,p); for (let i=0;i<250;i++) nb.step(-0.2,p);
  console.log('Reversibility Mercury pos error', Math.hypot(nb.get('mercury')!.x-x0, nb.get('mercury')!.z-z0).toExponential(2)); }
// 3. TRAPPIST period ratios
{ const def = trappistSystem(); const s = def.bodies[0]; const per = def.bodies.slice(1).map(b => 2*Math.PI*Math.sqrt(Math.hypot(...b.pos.map((v,i)=>v-s.pos[i]))**3/(s.mass+b.mass)));
  console.log('TRAPPIST period ratios', per.slice(1).map((p,i)=>(p/per[i]).toFixed(3)).join(' '), '(real 1.603 1.672 1.507 1.509 1.342 1.520)');
  r = sim(def, 300); console.log('TRAPPIST maxΔE/E', r.maxDE.toExponential(2), 'survivors', r.nb.bodies.length); }
// 4. Kepler-16: stays bound for 20 planet orbits?
{ const def = kepler16System(); r = sim(def, 1000, {...DEFAULT_PHYSICS}); const b = r.nb.bodies; const pl = r.nb.get('k16-b-planet');
  const A = r.nb.get('k16-a')!, B = r.nb.get('k16-b')!;
  const M = A.mass+B.mass; const cx=(A.x*A.mass+B.x*B.mass)/M, cz=(A.z*A.mass+B.z*B.mass)/M, cvx=(A.vx*A.mass+B.vx*B.mass)/M, cvz=(A.vz*A.mass+B.vz*B.mass)/M;
  const oe = pl ? orbitalElements(pl.x-cx, pl.y, pl.z-cz, pl.vx-cvx, pl.vy, pl.vz-cvz, M+pl.mass) : null;
  const ob = orbitalElements(B.x-A.x,B.y-A.y,B.z-A.z,B.vx-A.vx,B.vy-A.vy,B.vz-A.vz,M);
  console.log('Kepler-16 after 1000 sim-s: bodies', b.length, 'planet a', oe?.a.toFixed(2), 'e', oe?.e.toFixed(3), 'binary e', ob.e.toFixed(4), '(real 0.1594)', 'maxΔE/E', r.maxDE.toExponential(2),
   'period ratio', oe && ob.period ? (oe.period!/ob.period).toFixed(2) : '-', '(real 5.57)'); }
// 5. Astro
const hzS = habitableZone(1, 5772); console.log('Sun HZ', hzS.inner.toFixed(3), hzS.outer.toFixed(3), '(paper 0.99, 1.70)');
const hzT = habitableZone(0.000553, 2566); console.log('TRAPPIST HZ', hzT.inner.toFixed(4), hzT.outer.toFixed(4), 'e,f,g at 0.0293 0.0385 0.0468');
console.log('Earth Teq', equilibriumTemp(1, 1).toFixed(1), '(255)');
for (const m of [0.1, 0.5, 1, 2, 10]) { const s = starFromMass(m); console.log(`star ${m} M☉: L=${s.lum.toFixed(4)} R=${s.radiusSun.toFixed(3)} T=${Math.round(s.teff)} ${s.cls} color=${s.color.toString(16)}`); }
console.log('R(1 M⊕)', planetRadiusEarth(1).toFixed(2), 'R(17)', planetRadiusEarth(17).toFixed(2), '(Neptune 3.88)', 'R(318)', planetRadiusEarth(318).toFixed(2));
// 6. Cosmology
console.log('Age Planck', ageTodayGyr({H0:67.4, omegaM:0.315, omegaL:0.685})?.toFixed(3), '(13.79 w/ radiation; ~13.8)');
console.log('Age EdS H0=70', ageTodayGyr({H0:70, omegaM:1, omegaL:0})?.toFixed(3), '(2/3H0 = ', (2/3/(70*1.0227e-3)).toFixed(3), ')');
{ const c = new CosmicClock({H0:67.4, omegaM:0.315, omegaL:0.685}); for (let i=0;i<1000;i++) c.step(-0.05); console.log('Rewind 50Gyr → event', c.event, 'a', c.a.toFixed(3), 'age', c.age()?.toFixed(3), '(should ≈ 0 near a=0.02)'); }
{ const c = new CosmicClock({H0:67.4, omegaM:3, omegaL:0}); let t=0; while (c.event==='none' && t<200) { c.step(0.1); t+=0.1; } console.log('Closed Ωm=3 → event', c.event, 'after', t.toFixed(1), 'Gyr'); for(let i=0;i<Math.round(t/0.1);i++) c.step(-0.1); console.log('  reversed back a=', c.a.toFixed(4), '(expect 1)'); }
// 7. Bessel
const {besselI0,besselI1,besselK0,besselK1} = _bessel;
console.log('Bessel(1):', besselI0(1).toFixed(5), besselI1(1).toFixed(5), besselK0(1).toFixed(5), besselK1(1).toFixed(5), '(1.26607 0.56516 0.42102 0.60191)');
console.log('Bessel(3):', besselI0(3).toFixed(4), besselI1(3).toFixed(4), besselK0(3).toFixed(5), besselK1(3).toFixed(5), '(4.8808 3.9534 0.03474 0.04016)');
const mm = massModel(MILKY_WAY);
console.log('MW v(8.2) dm=1', vCirc(8.2, mm, 1).toFixed(1), 'dm=0', vCirc(8.2, mm, 0).toFixed(1), 'v(15) dm1', vCirc(15,mm,1).toFixed(1), 'dm0', vCirc(15,mm,0).toFixed(1), 'vInf', mm.vInf.toFixed(1));
// disk-only peak check: pure exponential disk vmax ≈ 0.6232 √(GM/Rd) at R≈2.2Rd
{ const m = {Mb:0,ab:1,Md:5e10,Rd:2.6,vInf:0,rc:5}; let best=0, rb=0; for (let R=0.5;R<15;R+=0.01){const v=vCirc(R,m,0); if(v>best){best=v;rb=R;}} console.log('disk vmax', best.toFixed(1), 'at R/Rd', (rb/2.6).toFixed(2), 'expect', (0.6232*Math.sqrt(4.30091e-6*5e10/2.6)).toFixed(1), 'at 2.15'); }
const P = 2*Math.PI/ (vCirc(8.2,mm,1)/8.2*1.0227e-3); console.log('Sun galactic period Myr', P.toFixed(0), '(~225)');
