// Cosmos desktop app (Electron main process).
// Serves the built app from a private app:// address instead of a localhost server, so it
// opens like any program, keeps its own saved data, and still downloads star/galaxy
// catalogues straight from the observatories' archives.

const { app, BrowserWindow, protocol, net, shell, Menu, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const DIST = path.join(__dirname, 'dist');
// public astronomy archives the app reads from; they already allow any website, this just
// guarantees the app:// origin is accepted even if an archive changes its CORS headers
const ARCHIVES = new Set([
  'simbad.cds.unistra.fr', 'vizier.cds.unistra.fr', 'dc.zah.uni-heidelberg.de', 'raw.githubusercontent.com',
  // official CDS mirrors, used when Strasbourg cannot be reached
  'vizier.cfa.harvard.edu', 'vizier.iucaa.in', 'vizier.nao.ac.jp', 'vizier.idia.ac.za', 'vizier.china-vo.org',
  'simbad.harvard.edu', 'simbad.cfa.harvard.edu', 'simbad.idia.ac.za',
  // real-time feeds
  'ssd.jpl.nasa.gov', 'ssd-api.jpl.nasa.gov', 'gracedb.ligo.org', 'exoplanetarchive.ipac.caltech.edu',
  'services.swpc.noaa.gov', 'api.alerce.online', 'api.wheretheiss.at',
]);
let win = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#050a21', title: 'Cosmos', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  // links to websites open in the normal browser, never inside the app window
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/i.test(url)) void shell.openExternal(url); } });
  // F11 full screen · Ctrl+R reload · Ctrl+Shift+I developer tools
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (input.control && !input.shift && input.key.toLowerCase() === 'r') { win.webContents.reload(); e.preventDefault(); }
    else if (input.control && input.shift && input.key.toLowerCase() === 'i') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  win.on('closed', () => { win = null; });
  void win.loadURL('app://cosmos/index.html');
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  session.defaultSession.webRequest.onHeadersReceived((d, cb) => {
    let host = '';
    try { host = new URL(d.url).hostname; } catch { /* ignore */ }
    if (!ARCHIVES.has(host)) { cb({}); return; }
    const h = { ...d.responseHeaders };
    for (const k of Object.keys(h)) if (k.toLowerCase() === 'access-control-allow-origin') delete h[k];
    h['Access-Control-Allow-Origin'] = ['*'];
    cb({ responseHeaders: h });
  });
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
