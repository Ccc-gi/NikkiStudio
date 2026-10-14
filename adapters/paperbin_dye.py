"""Observed current-game HomeColor table: preset code, icon, packed variants, slots."""
import re
import struct


def parse_dye(data):
    def integer(p):
        value = data[p]
        if value < 128:
            return value, p + 1
        if value == 128:
            return data[p + 1], p + 2
        raise ValueError('Unsupported compact dye integer')
    configs = {}
    for hit in re.finditer(rb'\xf0(.{4})', data, re.S):
        ident = struct.unpack('>I', hit[1])[0]
        if not 1170000000 <= ident < 1180000000:
            continue
        try:
            code, p = integer(hit.end())
            size, p = integer(p)
            icon = data[p:p + size].decode('ascii')
            p += size
            if not icon.startswith('/Game/UI/SysHomeUI/Common/Textures/Icon/Color/'):
                continue
            count, p = integer(p)
            if not 0 < count <= 64:
                continue
            variants = []
            for _ in range(count):
                value, p = integer(p)
                if value >= 625:
                    raise ValueError('Invalid packed dye variant')
                variants.append(value)
            _, p = integer(p)  # current schema's optional variant flags
            slot_count, p = integer(p)
            if slot_count != count:
                raise ValueError('Dye slot count mismatch')
            slots = []
            for _ in range(count):
                value, p = integer(p)
                slots.append(value)
            group, choice = divmod(code, 10)
            if not choice:
                continue
            cfg = [[index, value // 25, value % 25] for index, value in enumerate(variants)]
            table = configs.setdefault(str(ident), {}).setdefault(str(group), {})
            table[str(choice)] = {'idx': choice, 'cfg': cfg, 'sourceIcon': icon,
                                  'packedVariants': variants, 'sourceSlotList': slots}
            table.setdefault('0', {'idx': 0, 'cfg': [[s, 0, 0] for s in range(count)], 'packedVariants': [0] * count})
        except (ValueError, IndexError, UnicodeError):
            continue
    return configs


def resolve_slots(config, parts):
    """Translate component presets into the scene's original UE material slot space."""
    import copy
    result = copy.deepcopy(config)
    start = 0
    for group in sorted(result, key=int):
        choices = result[group]
        count = max((len(choice.get('packedVariants', [])) for choice in choices.values()), default=0)
        for choice in choices.values():
            values = choice.get('packedVariants', [])
            indices = ([part['offset'] for part in parts] if group == '0' and len(values) == len(parts)
                       else list(range(start, start + len(values))))
            choice['cfg'] = [[slot, value // 25, value % 25] for slot, value in zip(indices, values)]
        if group != '0':
            start += count
    return result
