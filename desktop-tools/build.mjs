// Production build of Cosmos for the desktop app, without the Vite dev server.
// Bundles src/ with esbuild and runs Tailwind/PostCSS on the CSS, writing desktop/dist/.
// Usage: ESBUILD_BINARY_PATH=<esbuild binary> node desktop-tools/build.mjs <esbuild package dir>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const req = createRequire(path.join(root, 'package.json'));
const esbuild = createRequire(path.join(process.argv[2], 'package.json'))('./lib/main.js');
const postcss = req('postcss');
const tailwind = req('tailwindcss');
const autoprefixer = req('autoprefixer');

const out = path.join(root, 'desktop', 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

const cssPlugin = {
  name: 'tailwind',
  setup(b) {
    b.onLoad({ filter: /\.css$/ }, async (a) => {
      const r = await postcss([tailwind(path.join(root, 'tailwind.config.cjs')), autoprefixer]).process(fs.readFileSync(a.path, 'utf8'), { from: a.path });
      return { contents: r.css, loader: 'css' };
    });
  },
};

const res = await esbuild.build({
  absWorkingDir: root,
  entryPoints: { index: 'src/main.tsx' },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  outdir: path.join(out, 'assets'), minify: true, legalComments: 'none',
  jsx: 'automatic', alias: { '@': path.join(root, 'src') },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.MODE': '"production"' },
  loader: { '.svg': 'file', '.png': 'file', '.jpg': 'file', '.woff': 'file', '.woff2': 'file' },
  plugins: [cssPlugin], logLevel: 'warning', metafile: true,
});

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const hasCss = fs.existsSync(path.join(out, 'assets', 'index.css'));
html = html.replace(/<script type="module" src="\/src\/main\.tsx"><\/script>/,
  `${hasCss ? '<link rel="stylesheet" href="./assets/index.css" />\n    ' : ''}<script type="module" src="./assets/index.js"></script>`);
if (!html.includes('./assets/index.js')) throw new Error('index.html: entry script tag not found');
// move the script to the end of <head> is unnecessary: type=module scripts are deferred
fs.writeFileSync(path.join(out, 'index.html'), html);

const sizes = Object.entries(res.metafile.outputs).map(([f, o]) => `${path.basename(f)} ${(o.bytes / 1e6).toFixed(2)} MB`);
console.log('BUILD OK', sizes.join(', '), res.warnings.length ? `(${res.warnings.length} warnings)` : '');
