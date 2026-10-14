"""Resolve a scene's material graph in breadth-first batches, preserving exact paths."""
import json
import re
from pathlib import Path
from backend.storage import write_json

PATTERNS = {
    'color': ['^DiffusePatternArray$', '^Albedo Tex$', '^Albedo Tex Array$', '^Albedo', 'Base.?Color', '^Layer 01 BC Tex$', '^T_Jewel_D$', '^Base_Tex$', '^BackGround$', 'Diffuse', '^BaseMap$', '^Fabric_Tex$'],
    'normal': ['^NormalArray$', '^Normal Tex$', '^Normal Tex Array$', '^Layer 01 Normal Tex$', 'Normal'],
    'orm': ['^ORMArray$', '(?<![A-Za-z])ORM(?![A-Za-z])', '^Mask Tex$'],
    'palette': ['^DiffuseColorArray$', '^HBC_ColorBlocks$'],
    'topGrass': ['^Top Layer BC Tex$'],
    'terrain': ['^Layer 01 Terrain T2DArray$'],
}


def texture_parameter(parameters, patterns):
    # Master materials keep white array placeholders even when the instance
    # supplies a real 2D albedo. Never let that placeholder win over real data.
    matches = [(key, value) for pattern in patterns for key, value in parameters.items()
               if re.search(pattern, key, re.I)]
    real = [(key, value) for key, value in matches
            if value.split('/')[-1].split('.')[0] not in ('T_Base_rgb_Array', 'T_BaseNA_Array')]
    return real[0][1] if real else None


def foliage_material(name):
    lower = name.lower()
    if any(word in lower for word in ('bark', 'trunk')):
        return False
    return any(word in lower for word in ('leaf', 'shrub', 'grass', 'flower', 'hedge', 'tree'))


def mesh_material_slots(objects):
    """CUE4Parse serializes skeletal slots outside Properties, unlike static slots."""
    for obj in objects:
        if obj.get('Type') not in ('StaticMesh', 'SkeletalMesh'):
            continue
        props = obj.get('Properties') or {}
        for container, field in ((obj, 'SkeletalMaterials'), (props, 'StaticMaterials'),
                                 (props, 'Materials'), (props, 'SkeletalMaterials')):
            slots = container.get(field)
            if isinstance(slots, list) and slots:
                return slots
    return []


def prepare_materials(runtime, packages):
    from asset_pipeline.runtime import package_path, glb_document
    root = runtime.directory / 'properties'
    assets = runtime.directory / 'assets'
    missing = [p for p in packages if not (runtime.directory / 'materials' / Path(p).with_suffix('.json')).exists()]
    if not missing:
        return
    runtime.export(missing, root, 'json')
    slots_by_mesh, material_props = {}, {}
    pending = set()
    for package in missing:
        objects = runtime.read_objects(root, package)
        slots = mesh_material_slots(objects)
        glb = assets / Path(package).with_suffix('.glb')
        names = {m.get('name') for m in glb_document(glb).get('materials', [])} if glb.exists() else set()
        selected = []
        for slot_index, slot in enumerate(slots):
            reference = slot.get('MaterialInterface') or slot.get('Material') or {}
            ref = reference.get('ObjectPath', '')
            if not ref.startswith('/Game/'):
                continue
            name = ref.split('/')[-1].split('.')[0]
            if names and name not in names:
                continue  # only exported LOD's material slots
            target = package_path(ref)
            pending.add(target)
            selected.append((name, target, slot_index))
        slots_by_mesh[package] = selected
    for _ in range(32):
        if not pending:
            break
        batch = sorted(pending - material_props.keys())
        if not batch:
            break
        runtime.export(batch, root, 'json')
        pending = set()
        for package in batch:
            props = next((o.get('Properties') or {} for o in runtime.read_objects(root, package)
                          if o.get('Type') in ('MaterialInstanceConstant', 'Material')), {})
            material_props[package] = props
            parent = (props.get('Parent') or {}).get('ObjectPath', '')
            if parent.startswith('/Game/'):
                pending.add(package_path(parent))
    else:
        raise ValueError('Material dependency limit exceeded')
    plans, textures = {}, set()
    for package, slots in slots_by_mesh.items():
        plans[package] = {}
        for name, source, slot_index in slots:
            current, seen, chain = source, set(), []
            while current and current not in seen:
                seen.add(current)
                props = material_props.get(current, {})
                chain.append(props)
                parent = (props.get('Parent') or {}).get('ObjectPath', '')
                current = package_path(parent) if parent.startswith('/Game/') else None
            parameters, base, vectors = {}, {}, {}
            for props in reversed(chain):
                base.update({key: props[key] for key in ('TwoSided', 'BlendMode', 'OpacityMaskClipValue') if key in props})
                base.update(props.get('BasePropertyOverrides', {}))
                for parameter in props.get('VectorParameterValues', []):
                    vectors[parameter.get('ParameterInfo', {}).get('Name', '')] = parameter.get('ParameterValue', {})
                for parameter in props.get('TextureParameterValues', []):
                    path = (parameter.get('ParameterValue') or {}).get('ObjectPath')
                    if path:
                        parameters[parameter.get('ParameterInfo', {}).get('Name', '')] = path
            requested = {}
            inferred = []
            unavailable = []
            for field, patterns in PATTERNS.items():
                ref = texture_parameter(parameters, patterns)
                if ref and ref.startswith('/Game/'):
                    target = package_path(ref)
                    if target in runtime.by_package:
                        requested[field] = target
                    else:
                        unavailable.append(target)
            # Current game has null texture parameters on some materials. Accept
            # only a present exact local material stem, never a global basename.
            stem = Path(source).stem.replace('MI_', 'T_', 1)
            for field, suffix in [('color', '_D'), ('normal', '_N'), ('orm', '_ORM'), ('palette', '_Array')]:
                local = (Path(source).parent / (stem + suffix + '.uasset')).as_posix()
                if field not in requested and local in runtime.by_package:
                    requested[field] = local
                    inferred.append(field)
            if 'color' in requested:
                color = Path(requested['color'])
                paired = re.sub(r'(_D_Array|_D|_Array)$', '', color.stem)
                for field, suffix in [('normal', '_N'), ('orm', '_ORM')]:
                    local = (color.parent / (paired + suffix + '.uasset')).as_posix()
                    if field not in requested and local in runtime.by_package:
                        requested[field] = local
                        inferred.append(field)
            plans[package][name] = {'source': source, 'requested': requested, 'base': base, 'inferred': inferred,
                                   'unavailable': unavailable, 'vectors': vectors, 'chain': list(seen), 'slotIndex': slot_index}
            textures.update(requested.values())
    if textures:
        runtime.export(sorted(textures), assets, 'ktx2')
    if not runtime.current(force=True):
        raise ValueError('Game updated during material conversion')
    def variants(package):
        found = {}
        for ext in ('.png', '.ktx2'):
            file = assets / Path(package).with_suffix(ext)
            if file.exists():
                found['0'] = '/asset/' + runtime.version + '/' + file.relative_to(assets).as_posix()
            for layer in file.parent.glob(file.stem + '_LAYER*' + ext):
                index = layer.stem.removeprefix(file.stem + '_LAYER')
                if index.isdigit():
                    found[index] = '/asset/' + runtime.version + '/' + layer.relative_to(assets).as_posix()
        return found
    for package, slots in plans.items():
        result = {}
        for name, plan in slots.items():
            tables = {field: variants(target) for field, target in plan['requested'].items()}
            terrain = tables.pop('terrain', {})
            if terrain:
                for index, field in enumerate(('color', 'normal', 'orm')):
                    if str(index) in terrain:
                        tables.setdefault(field, {'0': terrain[str(index)]})
            base = plan['base']
            urls = {field: table['0'] for field, table in tables.items() if '0' in table and field != 'palette'}
            foliage = foliage_material(name)
            chain = ' '.join(plan['chain']).lower()
            effect = 'water' if 'water' in chain else 'glass' if any(s in chain for s in ('glass', 'translusent', 'translucent', 'jewel', 'mirror')) else None
            tint = next((plan['vectors'][key] for key in ('AlbedoColorTint', 'Jewel_D_Tint', 'Tint Color', 'WaterBaseColor', 'BaseColor', 'Layer 01 Albedo Tint') if key in plan['vectors']), None)
            result[name] = {'name': name, **urls, 'variants': tables, 'source': plan['source'], 'foliage': foliage,
                            'slotIndex': plan['slotIndex'],
                            'unavailableTextures': plan['unavailable'],
                            'effect': effect, 'tint': [tint[c] for c in ('R', 'G', 'B')] if tint else None,
                            'layeredTerrain': bool(terrain),
                            'roughness': .8, 'twoSided': base.get('TwoSided', False) or foliage,
                            'masked': 'Masked' in base.get('BlendMode', '') or foliage,
                            'alphaTest': base.get('OpacityMaskClipValue', .3333),
                            'ormLayout': 'ORM' if terrain or 'ORM' in urls.get('orm', '') else 'unknown',
                            'inferredLocalTexture': bool(plan['inferred'])}
        write_json(runtime.directory / 'materials' / Path(package).with_suffix('.json'), result)
