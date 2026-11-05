# Cosmos — observable universe simulator

Start at the Solar System inside a sphere that is the whole observable universe, then zoom
out (normal or fisheye lens) past the stars, the Milky Way, galaxy clusters and superclusters
to the cosmic microwave background — and travel anywhere. Real catalogues (Gaia, SIMBAD,
VizieR, HYG) can be downloaded into the app; every object can be searched, selected and
shown on its own. Each scale is enterable: **Universe → Galaxy → Star system → Planet**.

## Run it

**Windows desktop app** — if `Cosmos-App-win64.zip` is attached to this repo's Releases, download it,
unzip, and double-click `Add Cosmos to Desktop and Start menu.bat` once (or just `Cosmos.exe`).

**From source**
```
npm install
npm run dev                    # browser version at http://localhost:3000
```
Requires Node.js 20.19+ or 22.12+.

**Build the desktop app yourself** — `make-desktop-app.bat` (Windows, needs internet) builds an
installer with electron-builder. The app wrapper lives in `desktop/` (Electron main process
serving the build from a private `app://` address — no localhost server).

## Universe map
- Every object at its real direction and distance; radius compressed as R = 60·log10(1 + d / 10⁻⁶ ly).
- Solar System from JPL elements for any date, the Milky Way from the Sun's real position,
  ~100 built-in landmarks, cosmic web, CMB at last scattering (45.2 Gly comoving).
- **Data tab** — load real catalogues: HYG stars, Gaia DR3 (G < 9/10/11), exoplanets, black holes &
  X-ray binaries, pulsars, white dwarfs, star clusters, nebulae, nearby galaxies (UNGC),
  Cosmicflows-4, 2MRS, Abell & SIMBAD clusters, superclusters, quasars. Saved locally after the first download.
- Modelled (clearly labelled) components: dark-matter halos (NFW, Moster et al. 2013), gas, dark energy;
  motion arrows for the CMB dipole and the disputed "dark flow".
- **Explore tab** — search any name (plus live SIMBAD lookup), browse by kind, and **Show only** one
  object or one kind of object across the whole universe.

## Live universe and Sandbox
The app opens on two views (switch at the top left):
- **Live universe** — read-only, locked to the real clock and measured data. Planets, moons,
  12 spacecraft (JPL Horizons), the ISS and close-approach asteroids (JPL CAD) sit where they are
  this second; HYG and Gaia stars are moved forward from their catalogue epoch by their measured
  proper motion and radial velocity. The **Now** tab lists what observatories are reporting:
  solar flares, X-ray level and Kp (NOAA SWPC), the SDO image of the Sun, new supernovae (ZTF via
  ALeRCE; distances are rough standard-candle estimates) and gravitational-wave mergers (GraceDB,
  placed at the most likely sky pixel and distance). Light delay means events are what has been
  *detected*, not what is happening out there at this instant. Galaxies do not visibly move in a
  human lifetime; planet formation is shown through catalogued young stars, not live.
- **Sandbox** — the fully editable multiverse; the same live feeds can be shown on it
  (Now tab → *Show live events on the map*). *Copy to sandbox* turns the live view into an editable copy.

Some feeds (JPL, GraceDB, NASA Exoplanet Archive) need the desktop app, which adds the
cross-origin header those archives do not send. SIMBAD/VizieR fall back to official mirrors
(CfA Harvard, IUCAA, NAOJ, IDIA, NAOC) when Strasbourg cannot be reached.

## What's inside

**Five scales, all linked by the same laws of physics**
Universe (Friedmann expansion, cosmic web) → Galaxy (rotation curves, density-wave arms, nucleus black hole)
→ Star system (N-body + belts) → Planet / black-hole close-up → Lab (particles, nuclei, timeline).

**Physics Lab (⚛ Lab button)**
- *Laws of physics* — tune G, α, αs, G_F, mₑ, m_p, Δm(n−p), c, ħ; see atoms, deuterium, neutron decay,
  Big Bang helium, Chandrasekhar mass, star luminosity and lifetime respond. G and stellar output feed back
  into the 3-D universe (orbits, galaxy rotation, expansion, planet temperatures).
- *Cosmic timeline* — Planck time → 10¹² yr: a, z, T, kT, epoch, which particles exist.
- *Particles* — the 17 Standard Model particles (PDG), when each froze out in this universe.
- *Radioactive decay* — U-238, Th-232, U-235, Pu-239 series and 9 other nuclides: 2 500 Monte-Carlo atoms next to exact Bateman curves.
- *Black holes* — Kerr horizons, ISCO, shadow, Hawking temperature/evaporation, Eddington limit, tidal forces.
- *Forces sandbox* — gravity, EM, Yukawa strong force, weak β-decay: a classical analogue (labelled as such).

**Parallel universes (⑂ Fork)** — copy the focused universe exactly (cosmic clock, galaxy, system, laws, camera);
up to 4 run side by side; Compare shows every quantity and the chaos divergence between forked systems.

**Contents** — full Solar System (8 planets, Ceres/Pluto/Haumea/Makemake/Eris/Sedna, Halley, 21 moons,
main belt with computed Kirkwood gaps, Hildas, Jupiter trojans, Kuiper belt with plutinos, scattered disc,
Oort cloud), α Centauri, Proxima, TRAPPIST-1, Kepler-16/442, Ross 128, 51 Pegasi, Sgr A* with S2, M87*,
procedural systems from any star, and the full NASA Exoplanet Archive via CSV import (Build tab).

## Architecture

```
src/sim/            physics core (no rendering, deterministic, tested)
  laws.ts           fundamental constants → consequences; black-hole physics
  cosmology.ts      Friedmann (radiation+matter+Λ+curvature), g*(T) thermal history, epochs
  particles.ts      Standard Model table        decay.ts   nuclides, Bateman, Monte Carlo
  physics.ts        leapfrog N-body             belts.ts   Keplerian small-body swarms
  galaxy.ts         rotation curve, density-wave arms        universe.ts  cosmic web
  systems.ts        real & procedural systems, SMBH clusters, catalog builder, save schema
  catalog.ts        NASA Exoplanet Archive CSV parser
src/engine/         Engine (navigation, fork state) + one View per scale
src/components/     HUD, Lab (6 tabs), Compare
scripts/            verify-sim.ts, verify-universe.ts  (npm run verify)
```

## Physics and its limits

| Scale | Model | Simplification |
|---|---|---|
| Universe | Friedmann (Ωm, ΩΛ, curvature), Hubble's law on proper distance | radiation ignored; Local Group kept bound; named galaxies placed closer than real |
| Galaxy | v² = v²bulge + v²disk(Freeman) + v²halo, MW-calibrated (229 km/s at 8.2 kpc) | stars on circular orbits + density-wave perturbation; no N-body |
| System | Newtonian N-body, leapfrog, momentum-conserving merges | distances compressed for wide systems (period ratios exact only on linear maps) |
| Moons | kinematic, real period ratios, 150× slowed (Moon clock slider) | a compressed map puts moons outside their planet's Hill sphere |
| Small bodies | Keplerian test particles on real elements, radially mapped | their pull on planets is neglected (as in reality, to good approximation) |
| Laws | exact formulas + standard scaling laws (see `laws.ts`) | luminosity/lifetime scalings and nuclear-binding thresholds are approximate |
| Particles | classical analogue in the Forces sandbox | exact quantum simulation of even ~50 particles is beyond any computer |

Sources: Kopparapu et al. 2013 (habitable zone), Chen & Kipping 2017 (mass–radius),
Bland-Hawthorn & Gerhard 2016 and Eilers et al. 2019 (Milky Way), Planck 2018 (cosmology),
Agol et al. 2021 (TRAPPIST-1), Doyle et al. 2011 (Kepler-16), Holman & Wiegert 1999 (binary stability),
Faria et al. 2022 (Proxima), GRAVITY 2020/2022 (S2, Sgr A*), EHT 2019 (M87*), Bardeen et al. 1972 (ISCO),
Kolb & Turner 1990 (g*), PDG 2024 (particles), NNDC/ENSDF (half-lives), Häring & Rix 2004 (M_BH–M_bulge).

## Keys

W A S D / R F fly · drag look · scroll speed/zoom · click select · double-click or Enter to enter ·
Backspace up a level · C follow · Space pause · [ ] slower/faster · \ reverse time · L labels ·
Delete remove body · Esc deselect.
