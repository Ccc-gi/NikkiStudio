"""CUE4Parse-style numeric _P read order; equal highest orders remain ambiguous.

Reference: CUE4Parse/UE4/VirtualFileSystem/AbstractVfsReader.cs VerifyReadOrder.
This is a parser policy, not a claim about every future game launcher.
"""
import re
from pathlib import Path


def read_order(archive):
    name = Path(archive).name
    if not re.search(r'_P\.(?:pak|utoc|o\.utoc)$', name, re.I):
        return 3
    match = re.search(r'_(\d+)_P\.', name, re.I)
    version = int(match[1]) + 1 if match and int(match[1]) >= 1 else 1
    return 3 + 100 * version


def select_current(rows):
    unique = {r['archive']: r for r in rows}
    highest = max(read_order(name) for name in unique)
    candidates = [row for name, row in unique.items() if read_order(name) == highest]
    if len(candidates) != 1:
        raise ValueError('同优先级归档存在歧义，拒绝任意选择')
    return candidates[0]
