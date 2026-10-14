"""Versioned adapter for the observed compact HomeObject schema; no guessed models."""
import math
import re
import struct
from pathlib import Path
from adapters.home_offsets import read_root_offset


def parse(data):
    def integer(p):
        v = data[p]
        if v < 128:
            return v, p + 1
        if v == 128:
            return data[p + 1], p + 2
        raise ValueError('Unsupported compact integer')
    def string(p):
        n, p = integer(p)
        if p + n > len(data):
            raise ValueError('Truncated compact string')
        return data[p:p + n].decode('ascii'), p + n
    def array(p):
        count, p = integer(p)
        if not 0 < count < 128:
            raise ValueError('Invalid mesh count')
        packages = []
        for _ in range(count):
            value, p = string(p)
            if not value.startswith('/Game/'):
                raise ValueError('Invalid package')
            packages.append('X6Game/Content/' + value.split('.')[0].removeprefix('/Game/') + '.uasset')
        nt, p = integer(p)
        if nt != count:
            raise ValueError('Transform count mismatch')
        components = []
        for package in packages:
            values = struct.unpack_from('<10f', data, p)
            p += 40
            if any(not math.isfinite(v) or abs(v) > 1e7 for v in values):
                raise ValueError('Invalid transform')
            if abs(sum(v*v for v in values[:4]) - 1) > .01:
                raise ValueError('Invalid quaternion')
            components.append({'package': package, 'quaternion': list(values[:4]),
                               'translation': list(values[4:7]), 'scale': list(values[7:])})
        return components, p
    found = {}
    for hit in re.finditer(rb'\xf0(.{4})(?:[^\x80]|\x80.)(?:/Game/|/Script/X6Game.X6HomeObject)', data, re.S):
        ident = struct.unpack('>I', hit[1])[0]
        if not 1170000000 <= ident < 1180000000:
            continue
        try:
            cls, p = string(hit.start() + 5)
            row = {'class': cls, 'components': [], 'blueprint': cls.split('.')[0] if cls.startswith('/Game/') else None}
            try:
                row['components'], end = array(p)
                offset, _ = read_root_offset(data, end)
                row.update(staticMeshRootOffset=offset, transformSpace='staticMeshRoot')
            except (ValueError, UnicodeError, IndexError, struct.error):
                # The observed schema has empty static fields before its skeletal array.
                row['components'] = []
                for skip in range(1, 81):
                    try:
                        components, _ = array(p + skip)
                        if all('SkMesh' in c['package'] or Path(c['package']).stem.startswith('SK_') for c in components):
                            row.update(components=components, transformSpace='actor', complete=False,
                                       limitations='Skeletal reference pose; runtime animation unsupported')
                            break
                    except (ValueError, UnicodeError, IndexError, struct.error):
                        pass
            if ident not in found or len(row['components']) > len(found[ident]['components']):
                found[ident] = row
        except (ValueError, UnicodeError, IndexError, struct.error):
            pass
    if not found or not any(row['components'] for row in found.values()):
        raise ValueError('PaperBin 格式不兼容，未找到有效家具变换；请更新适配器')
    return found
