"""Per-item build limits read from the game's own HomeObject records.

Nothing here consumes third-party data: the input is the player's own PaperBin.

Scale range
    The observed schema only ever states four ranges, three of which are written
    as a distinctive float32 pair (0.7/1.3, 0.7/2, 0.1/2). Finding one of those
    pairs identifies the range; a record without one cannot be scaled. Verified
    against every known rule with no false positives and no misses.

Rotation
    Yaw is never restricted, so only Roll and Pitch vary. The game writes them in
    four record layouts, told apart by the item-id block, and each marks the
    states it does not default to with a count-prefixed byte run
    (``<count> <byte> repeated <count> times``):

    ==========  ============================================================
    id block    encoding
    ==========  ============================================================
    1170        a run of 1 marks Roll+Pitch allowed, otherwise both forbidden
    1173        a run of 1 marks Roll+Pitch allowed, a run of 0 marks both
                forbidden, neither means Roll allowed and Pitch forbidden
    1174        a run of 1 marks both allowed, otherwise both forbidden
    1175        a run of 1 marks Roll forbidden and Pitch allowed, otherwise
                Roll allowed and Pitch forbidden
    ==========  ============================================================

    The layouts themselves are facts about the format; the mapping onto
    Roll/Pitch was confirmed against every known rule. A record whose layout this
    module does not recognise is left out of the result rather than guessed, so
    callers can report it as unverified.
"""
import re
import struct

SCALE_PAIRS = ((0.7, 1.3), (0.7, 2.0), (0.1, 2.0))
SCALE_PATTERNS = tuple((pair, struct.pack('<2f', *pair)) for pair in SCALE_PAIRS)
FIXED_SCALE = (1.0, 1.0)

IDENT_RANGE = range(1170000000, 1180000000)
RECORD = re.compile(
    rb'\xf0(.{4})(?:[^\x80]|\x80.)(?:/Game/|/Script/X6Game.X6HomeObject)', re.S)

ROLL, PITCH = 'x', 'y'


def records(data):
    """Split the blob into per-item chunks keyed by item id."""
    hits = sorted(
        (m.start(), struct.unpack('>I', m.group(1))[0])
        for m in RECORD.finditer(data)
        if struct.unpack('>I', m.group(1))[0] in IDENT_RANGE)
    bounds = {}
    for index, (position, ident) in enumerate(hits):
        end = hits[index + 1][0] if index + 1 < len(hits) else len(data)
        if ident not in bounds or end - position > bounds[ident][1] - bounds[ident][0]:
            bounds[ident] = (position, end)
    return {ident: data[start:end] for ident, (start, end) in bounds.items()}


def scale_range(record):
    """[min, max] from the pair the record states, or the unscalable default."""
    for pair, pattern in SCALE_PATTERNS:
        if pattern in record:
            return [pair[0], pair[1]]
    return [FIXED_SCALE[0], FIXED_SCALE[1]]


def _count_prefixed_runs(record):
    """Values the record writes as <count><value repeated count times>."""
    values = set()
    at = 0
    while at < len(record):
        run = 1
        while at + run < len(record) and record[at + run] == record[at]:
            run += 1
        if run >= 2 and at >= 1 and record[at - 1] == run:
            values.add(record[at])
        at += run
    return values


def rotation_allowed(ident, record):
    """{'x': Roll, 'y': Pitch, 'z': True} for the layouts this module reads."""
    block = str(ident)[:4]
    runs = _count_prefixed_runs(record)
    if block == '1170':
        roll, pitch = (True, True) if 1 in runs else (False, False)
    elif block == '1173':
        roll, pitch = ((True, True) if 1 in runs else
                       (False, False) if 0 in runs else (True, False))
    elif block == '1174':
        roll, pitch = (True, True) if 1 in runs else (False, False)
    elif block == '1175':
        roll, pitch = (False, True) if 1 in runs else (True, False)
    else:
        return None
    return {ROLL: roll, PITCH: pitch, 'z': True}


def parse(data):
    """Rules for every record this module can read."""
    rules = {}
    for ident, record in records(data).items():
        rule = {'scaleRange': scale_range(record)}
        rotation = rotation_allowed(ident, record)
        if rotation is not None:
            rule['rotationAllowed'] = rotation
        rules[ident] = rule
    return rules


def coverage(data):
    """How much of the blob this module could read, for reporting to the user."""
    rules = parse(data)
    return {
        'items': len(rules),
        'scale': sum(1 for rule in rules.values() if 'scaleRange' in rule),
        'rotation': sum(1 for rule in rules.values() if 'rotationAllowed' in rule),
        'both': sum(1 for rule in rules.values()
                    if 'scaleRange' in rule and 'rotationAllowed' in rule),
    }
