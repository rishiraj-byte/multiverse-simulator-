"""Replace the icon inside a Windows .exe in place (no extra tools).

Each existing RT_ICON image is overwritten with a PNG of the same pixel size made from the
source image, as long as the PNG fits in the old slot (PNG icons are valid in Windows Vista+).
The RT_GROUP_ICON directory entries are updated to the new byte sizes.
Usage: python3 set_exe_icon.py app.exe icon.png
"""
import io, struct, sys
from PIL import Image

exe_path, png_path = sys.argv[1], sys.argv[2]
d = bytearray(open(exe_path, 'rb').read())
pe = struct.unpack_from('<I', d, 0x3C)[0]
nsec = struct.unpack_from('<H', d, pe + 6)[0]
optsz = struct.unpack_from('<H', d, pe + 20)[0]
opt = pe + 24
magic = struct.unpack_from('<H', d, opt)[0]
dd = opt + (112 if magic == 0x20B else 96)
rsrc_rva = struct.unpack_from('<I', d, dd + 2 * 8)[0]
secs = []
for i in range(nsec):
    o = opt + optsz + i * 40
    vs, va, rs, rp = struct.unpack_from('<IIII', d, o + 8)
    secs.append((va, max(vs, rs), rp))

def off(rva):
    for va, sz, rp in secs:
        if va <= rva < va + sz:
            return rva - va + rp
    raise ValueError(hex(rva))

base = off(rsrc_rva)

def entries(dir_off):
    named, ids = struct.unpack_from('<HH', d, dir_off + 12)
    for k in range(named + ids):
        name, target = struct.unpack_from('<II', d, dir_off + 16 + 8 * k)
        yield name, target

def leaves(type_id):
    """[(id, lang, data_entry_offset)] for a resource type."""
    out = []
    for name, t in entries(base):
        if name == type_id and t & 0x80000000:
            for rid, t2 in entries(base + (t & 0x7FFFFFFF)):
                for lang, t3 in entries(base + (t2 & 0x7FFFFFFF)):
                    out.append((rid, lang, base + t3))
    return out

icons = {rid: de for rid, _, de in leaves(3)}
src = Image.open(png_path).convert('RGBA')
changed = 0
for gid, glang, gde in leaves(14):
    grva, gsize = struct.unpack_from('<II', d, gde)
    g = off(grva)
    count = struct.unpack_from('<H', d, g + 4)[0]
    for k in range(count):
        e = g + 6 + 14 * k
        w, h = d[e] or 256, d[e + 1] or 256
        rid = struct.unpack_from('<H', d, e + 12)[0]
        de = icons[rid]
        rva, size = struct.unpack_from('<II', d, de)
        buf = io.BytesIO()
        src.resize((w, h), Image.LANCZOS).save(buf, 'PNG', optimize=True)
        png = buf.getvalue()
        if len(png) > size:  # try fewer colours before giving up on this size
            buf = io.BytesIO(); src.resize((w, h), Image.LANCZOS).quantize(256).save(buf, 'PNG', optimize=True); png = buf.getvalue()
        if len(png) > size:
            print(f'  skip {w}x{h}: {len(png)} > {size} bytes'); continue
        o = off(rva)
        d[o:o + size] = png + bytes(size - len(png))
        struct.pack_into('<I', d, de + 4, len(png))          # data entry size
        struct.pack_into('<HHI', d, e + 4, 1, 32, len(png))   # planes, bit count, bytes in res
        changed += 1
        print(f'  {w}x{h}: {len(png)} bytes (slot {size})')
# show "Cosmos" instead of "Electron" in Task Manager / file properties (same-length, in place)
rs_va, rs_sz, rs_rp = next((va, sz, rp) for va, sz, rp in secs if va == rsrc_rva)
old, new = 'Electron\0'.encode('utf-16le'), 'Cosmos\0\0\0'.encode('utf-16le')
seg = bytes(d[rs_rp:rs_rp + rs_sz])
n = seg.count(old)
d[rs_rp:rs_rp + rs_sz] = seg.replace(old, new)
print(f'renamed {n} version strings')
struct.pack_into('<I', d, opt + 64, 0)  # clear the optional-header checksum (not checked for apps)
open(exe_path, 'wb').write(d)
print(f'replaced {changed} icon images')
