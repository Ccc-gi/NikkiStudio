"""Decode actor-local StaticMeshRootOffset in the installed PaperBin schema."""
import math
import struct


def read_root_offset(data, position):
    """position follows StaticMeshTransformList; return offset and field address."""
    def count(p):
        value = data[p]
        if value < 128:
            return value, p + 1
        if value == 128:
            return data[p + 1], p + 2
        raise ValueError('Unsupported PaperBin count')

    # ReplaceMeshList, VirtualMesh PC/Mobile, ReplaceVirtualMesh PC/Mobile.
    # This schema omits empty optional skeletal arrays.
    for _ in range(5):
        size, position = count(position)
        if size > 100:
            raise ValueError('Invalid mesh list count')
        for _ in range(size):
            length, position = count(position)
            data[position:position + length].decode('ascii')
            position += length
    offset = list(struct.unpack_from('<3f', data, position))
    if any(not math.isfinite(v) or abs(v) > 100000 for v in offset):
        raise ValueError('Invalid StaticMeshRootOffset')
    return offset, position


def apply_root_offsets(mapping, configs, offsets):
    """Table-created meshes use StaticMeshRoot regardless of actor class name.

    Authored Blueprint templates are actor-relative and must not receive this
    table root a second time. Identify provenance using actual components.
    """
    for ident, asset in mapping.items():
        cfg = configs.get(ident, {})
        if asset.get('transformSpace') == 'actor' or asset.get('group'):
            continue
        configured = {c['package'] for c in cfg.get('components', [])}
        components = asset.get('components', [])
        if not components or not all(c.get('package') in configured for c in components):
            continue
        if ident not in offsets:
            continue
        record = offsets[ident]
        asset['staticMeshRootOffset'] = record['offset']
        asset['transformSpace'] = 'staticMeshRoot'
        asset['rootOffsetSource'] = {
            'field': 'StaticMeshRootOffset', 'paperbin_offset': record['source_offset']}
        asset.pop('modelRotationPivot', None)
        asset.pop('modelPivotEvidence', None)
