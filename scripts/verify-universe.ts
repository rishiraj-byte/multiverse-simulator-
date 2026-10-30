// Verifies cosmology, laws of physics, black holes and radioactive decay against published values.
// Run: npx tsx scripts/verify-universe.ts
import { ageTodayGyr, timeAtA, aAtTime, cmbTemperature, epochs, kTeV, CosmicClock } from '../src/sim/cosmology';
import { deriveLaws, blackHole, REAL_LAWS, fmtTime, fmtSci } from '../src/sim/laws';
import { bateman, monteCarlo } from '../src/sim/decay';
const P = { H0: 67.4, omegaM: 0.315, omegaL: 0.685 };
console.log('age (with radiation)', ageTodayGyr(P)?.toFixed(3), 'Gyr  [Planck 2018: 13.79]');
console.log('t(a=1) from timeline', (timeAtA(1, P) / 3.15576e16).toFixed(3), 'Gyr');
const aMeV = (() => { let lo=-80, hi=0; for (let i=0;i<80;i++){const m=(lo+hi)/2; if (kTeV(Math.exp(m))>1e6) lo=m; else hi=m;} return Math.exp((lo+hi)/2); })();
console.log('t at kT=1 MeV', timeAtA(aMeV, P).toFixed(3), 's  [2.42/sqrt(10.75)=0.738 s]');
console.log('t at recombination z=1090', (timeAtA(1/1091, P)/3.15576e7/1e3).toFixed(0), 'kyr [~372–380 kyr]');
console.log('t at z=14.3', (timeAtA(1/15.3, P)/3.15576e16*1000).toFixed(0), 'Myr [~290 Myr]');
console.log('T(a=1/1091)', cmbTemperature(1/1091).toFixed(0), 'K [2976]');
console.log('a at t=1e-6 s', aAtTime(1e-6, P).toExponential(2), 'kT', (kTeV(aAtTime(1e-6,P))/1e6).toFixed(0), 'MeV [~1 GeV-ish at 1µs? standard: ~200 MeV at 10 µs]');
console.log('EdS check age H0=70', ageTodayGyr({H0:70, omegaM:1, omegaL:0, omegaR:0})?.toFixed(3), '[9.313]');
console.log(epochs(P).map(e => `${e.name}@${fmtTime(e.tStart)}`).join(' | '));
const c = new CosmicClock(P); for (let i=0;i<2000;i++) c.step(-0.05); console.log('rewind', c.event, c.a, c.age()?.toFixed(4));
// laws
const d = deriveLaws(REAL_LAWS, 1); console.log('\nREAL laws:', d.rows.map(r=>`${r.k}=${r.v}`).join(' | '), 'life', d.life);
const d2 = deriveLaws({...REAL_LAWS, alphaS: 0.88}, 1); console.log('weak strong:', d2.rows.filter(r=>r.verdict).map(r=>`${r.k}=${r.v}`).join(' | '), d2.life);
const d3 = deriveLaws(REAL_LAWS, 2); console.log('G×2:', d3.rows.slice(-3).map(r=>`${r.k}=${r.v}`).join(' | '), d3.life);
const d4 = deriveLaws({...REAL_LAWS, dMnp: 0.3}, 1); console.log('Δm×0.3:', d4.rows.filter(r=>/neutron|Proton|helium/i.test(r.k)).map(r=>`${r.k}=${r.v}`).join(' | '));
// BH
for (const [m, s] of [[1,0],[10,0],[4.3e6,0],[1,0.998]] as const) { const b = blackHole(m, s, REAL_LAWS, 1);
  console.log(`BH ${m} M☉ a*=${s}: rs=${(b.rsM/1e3).toFixed(3)} km ISCO=${(b.iscoPro/b.rsM*2).toFixed(3)} M η=${(b.efficiency*100).toFixed(1)}% T_H=${fmtSci(b.hawkingK)} K t_evap=${fmtSci(b.evapYears)} yr L_Edd=${fmtSci(b.eddingtonW)} W`); }
// decay
const bU = bateman('U238', 1);
const t1 = 4.468e9*3.15576e7; const a = bU.amounts(t1);
console.log('\nU238 after 1 half-life: U238', a[0].toFixed(4), 'Pb206', a[a.length-1].toFixed(4), 'sum', a.reduce((s,v)=>s+v,0).toFixed(6));
const ra = a[bU.idx.get('Ra226')!]; console.log('Ra226/U238 secular eq', (ra/a[0]).toExponential(3), 'expected λU/λRa =', (1600/4.468e9).toExponential(3));
const bk = bateman('K40',1).amounts(1.248e9*3.15576e7); console.log('K40 after t½:', bk.map(v=>v.toFixed(4)).join(' '), '[0.5, 0.4464, 0.0536]');
const bt = bateman('Th232',1); const at = bt.amounts(1e3*3.15576e7*1e3); console.log('Th232 chain order', bt.chain.map(n=>n.id).join('>'));
console.log('Th232 Tl208 / Po212 eq ratio', (at[bt.idx.get('Tl208')!]/at[bt.idx.get('Po212')!]).toExponential(3), 'expected', ((0.3594*3.053*60)/(0.6406*0.299e-6)).toExponential(3));
const mc = monteCarlo('C14', 20000, 1); const s = mc.state(5730*3.15576e7); console.log('MC C14 after t½ remaining', (s.filter(k=>k===0).length/20000).toFixed(3), '[0.5 ± 0.0035]');
const mk = monteCarlo('K40', 20000, 2); const sk = mk.state(1e20); console.log('MC K40 branch to Ar40', (sk.filter(k=>mk.chain[k].id==='Ar40').length/20000).toFixed(4), '[0.1072]');
// belts & small bodies
import { solarSystem, toDisplay } from '../src/sim/systems';
import { generateBelt } from '../src/sim/belts';
const sol = solarSystem();
const main = generateBelt(sol.belts!.find((b) => b.id === 'main-belt')!);
console.log('\nKirkwood gaps (AU):', sol.belts![0].gaps!.map((g) => g.toFixed(3)).join(', '), '[2.50, 2.82, 2.96, 3.28]',
  '| asteroids inside a gap:', Array.from(main.a).filter((a) => sol.belts![0].gaps!.some((g) => Math.abs(a - g) < 0.02)).length);
console.log('Plutino resonance:', (30.07 * Math.pow(1.5, 2 / 3)).toFixed(2), 'AU [39.4] → display', toDisplay(39.4, sol.scale).toFixed(1));
