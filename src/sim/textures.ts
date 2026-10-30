// Procedural canvas textures — no external assets, everything code-drawn.
// Shared textures (glow, dot, ring, selection) are cached and flagged with
// userData.shared so scene disposal never frees them while still in use.
import * as THREE from 'three';
import type { TexStyle } from './systems';

const cache = new Map<string, THREE.Texture>();
function shared<T extends THREE.Texture>(key: string, make: () => T): T {
  let t = cache.get(key) as T | undefined;
  if (!t) { t = make(); t.userData.shared = true; cache.set(key, t); }
  return t;
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.CanvasTexture {
  return shared(`glow:${inner}:${outer}`, () => makeGlow(inner, outer));
}
function makeGlow(inner: string, outer: string): THREE.CanvasTexture {
  const c = canvas(128, 128);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.25, inner.replace('1)', '0.6)'));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function softDotTexture(): THREE.CanvasTexture {
  return shared('dot', makeDot);
}
function makeDot(): THREE.CanvasTexture {
  const c = canvas(64, 64);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}
function shade(c: number, f: number): string {
  const r = Math.min(255, ((c >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((c >> 8) & 255) * f) | 0;
  const b = Math.min(255, (c & 255) * f) | 0;
  return `rgb(${r},${g},${b})`;
}

export function planetTexture(style: TexStyle, color: number, seed = 1): THREE.CanvasTexture {
  const W = 256, H = 128;
  const c = canvas(W, H);
  const ctx = c.getContext('2d')!;
  let s = seed * 9973 + 13;
  const rand = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };

  ctx.fillStyle = hex(color);
  ctx.fillRect(0, 0, W, H);

  if (style === 'gas' || style === 'ice') {
    // horizontal bands with sinusoidal distortion
    const bands = 7 + Math.floor(rand() * 5);
    for (let b = 0; b < bands; b++) {
      const y0 = (b / bands) * H;
      const hh = H / bands;
      ctx.fillStyle = shade(color, 0.75 + rand() * 0.55);
      ctx.beginPath();
      ctx.moveTo(0, y0);
      for (let x = 0; x <= W; x += 8) {
        ctx.lineTo(x, y0 + Math.sin(x * 0.05 + b * 2.3) * 3 + rand() * 2);
      }
      ctx.lineTo(W, y0 + hh); ctx.lineTo(0, y0 + hh);
      ctx.closePath();
      ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // storm spots
    if (style === 'gas') {
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = shade(color, 1.4);
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.ellipse(rand() * W, rand() * H, 8 + rand() * 14, 4 + rand() * 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    if (style === 'ice') {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgba(255,255,255,0.35)');
      g.addColorStop(0.5, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,0.35)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
  } else if (style === 'earth') {
    // oceans + continents
    ctx.fillStyle = '#1c4d7a'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = i % 3 === 0 ? '#c9b06a' : '#3f7a4a';
      const cx = rand() * W, cy = H * 0.2 + rand() * H * 0.6;
      for (let j = 0; j < 7; j++) {
        ctx.beginPath();
        ctx.ellipse(cx + (rand() - 0.5) * 40, cy + (rand() - 0.5) * 18, 5 + rand() * 16, 4 + rand() * 9, rand() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // clouds
    ctx.globalAlpha = 0.22; ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 26; i++) {
      ctx.beginPath();
      ctx.ellipse(rand() * W, rand() * H, 8 + rand() * 18, 2 + rand() * 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // ice caps
    ctx.fillStyle = 'rgba(240,248,255,0.9)';
    ctx.fillRect(0, 0, W, 8); ctx.fillRect(0, H - 9, W, 9);
  } else if (style === 'lava') {
    ctx.fillStyle = shade(color, 0.5); ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = shade(color, 0.9 + rand() * 0.7);
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(rand() * W, rand() * H, 2 + rand() * 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (style === 'blackhole') {
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, H);
  } else if (style === 'star') {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, shade(color, 1.15)); g.addColorStop(0.5, hex(color)); g.addColorStop(1, shade(color, 0.85));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = rand() < 0.5 ? shade(color, 1.3) : shade(color, 0.7);
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.arc(rand() * W, rand() * H, 2 + rand() * 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else {
    // rock: speckled craters
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = shade(color, 0.6 + rand() * 0.8);
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(rand() * W, rand() * H, 0.5 + rand() * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function ringTexture(): THREE.CanvasTexture {
  return shared('ring', makeRing);
}
function makeRing(): THREE.CanvasTexture {
  const c = canvas(256, 16);
  const ctx = c.getContext('2d')!;
  let s = 5;
  const rand = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  for (let x = 0; x < 256; x++) {
    const a = 0.15 + rand() * 0.55 * Math.sin((x / 256) * Math.PI);
    ctx.fillStyle = `rgba(232,220,190,${Math.max(a, 0)})`;
    ctx.fillRect(x, 0, 1, 16);
  }
  // Cassini-like gaps
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(150, 0, 6, 16);
  ctx.fillRect(60, 0, 3, 16);
  return new THREE.CanvasTexture(c);
}

/** Accretion disk: hot inner edge → cooler outer rim, with turbulent streaks. */
export function accretionTexture(): THREE.CanvasTexture {
  return shared('accretion', () => {
    const S = 256;
    const c = canvas(S, S);
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.18, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,250,235,0)');
    g.addColorStop(0.04, 'rgba(255,246,220,1)');
    g.addColorStop(0.3, 'rgba(255,170,80,0.85)');
    g.addColorStop(0.7, 'rgba(200,70,30,0.35)');
    g.addColorStop(1, 'rgba(120,30,20,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    let s = 17;
    const rand = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 90; i++) {
      const r = S * (0.2 + rand() * 0.28);
      const a0 = rand() * Math.PI * 2;
      ctx.strokeStyle = `rgba(0,0,0,${0.15 + rand() * 0.3})`;
      ctx.lineWidth = 1 + rand() * 2;
      ctx.beginPath(); ctx.arc(S / 2, S / 2, r, a0, a0 + 0.4 + rand() * 1.4); ctx.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Dashed selection reticle. */
export function reticleTexture(): THREE.CanvasTexture {
  return shared('reticle', () => {
    const c = canvas(128, 128);
    const ctx = c.getContext('2d')!;
    ctx.strokeStyle = 'rgba(154,146,217,0.95)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 7]);
    ctx.beginPath(); ctx.arc(64, 64, 52, 0, Math.PI * 2); ctx.stroke();
    return new THREE.CanvasTexture(c);
  });
}
