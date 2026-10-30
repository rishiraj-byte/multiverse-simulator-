// electron-builder afterPack hook: put the Cosmos icon and name into Cosmos.exe
// (done in plain JavaScript with `resedit`, so no extra signing tools are downloaded).
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function setIcon(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  try {
    const ResEdit = await import('resedit');
    const R = ResEdit.default ?? ResEdit;
    const exeObj = R.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
    const res = R.NtExecutableResource.from(exeObj);
    const iconFile = R.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'desktop', 'icon.ico')));
    const groups = R.Resource.IconGroupEntry.fromEntries(res.entries);
    const targets = groups.length ? groups.map((g) => [g.id, g.lang]) : [[1, 1033]];
    for (const [id, lang] of targets) R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, iconFile.icons.map((i) => i.data));
    const vi = R.Resource.VersionInfo.fromEntries(res.entries)[0];
    if (vi) {
      for (const l of vi.getAllLanguagesForStringValues()) {
        vi.setStringValues(l, { ProductName: 'Cosmos', FileDescription: 'Cosmos — observable universe simulator', CompanyName: 'Rj', OriginalFilename: 'Cosmos.exe', InternalName: 'Cosmos' });
      }
      vi.outputToResourceEntries(res.entries);
    }
    res.outputResource(exeObj);
    fs.writeFileSync(exe, Buffer.from(exeObj.generate()));
    console.log('  • Cosmos icon set on', path.basename(exe));
  } catch (e) {
    console.warn('  • Could not set the icon (app still works):', e && e.message);
  }
};
