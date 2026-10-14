"""Synthetic game archives and models. Never contains extracted game content."""
import json
import struct
from pathlib import Path
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

KEY = bytes(range(32))
GUID = '12345678123456781234567812345678'
PACKAGE = 'X6Game/Content/UI/SysHome/Assets/Test/S_TestCube.uasset'
ITEM = 1170000001


def create_game(root, revision=1):
    root = Path(root)
    pak = root / 'X6Game/Content/Paks'
    pak.mkdir(parents=True, exist_ok=True)
    def string(value):
        raw = value.encode() + b'\0'
        return struct.pack('<i', len(raw)) + raw
    # One directory and one file, mounted at the package parent.
    raw = string('../../../' + PACKAGE.rsplit('/', 1)[0] + '/')
    raw += struct.pack('<I4I', 1, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0)
    raw += struct.pack('<I3I', 1, 0, 0xFFFFFFFF, 0)
    raw += struct.pack('<I', 1) + string('S_TestCube.uasset')
    raw += bytes((-len(raw)) % 16)
    transformed = bytearray(raw)
    for i in range(0, len(transformed), 16):
        transformed[i] ^= KEY[-1]
        transformed[i + 15] ^= KEY[0]
    encryptor = Cipher(algorithms.AES(KEY), modes.ECB()).encryptor()
    ciphertext = encryptor.update(transformed) + encryptor.finalize()
    header = bytearray(144)
    header[:16] = b'-==--==--==--==-'
    header[16] = 5
    struct.pack_into('<I', header, 20, 144)
    struct.pack_into('<I', header, 48, len(ciphertext))
    for p in (64, 68, 72, 76):
        struct.pack_into('<I', header, p, 0x12345678)
    header[80] = 10
    (pak / 'Test.utoc').write_bytes(header + ciphertext)
    (pak / 'Test.ucas').write_bytes(b'SYNTHETIC_GAME_' + str(revision).encode())
    def compact(value):
        raw = value.encode()
        return bytes([len(raw)]) + raw
    paper = b'\xf0' + struct.pack('>I', ITEM) + compact('/Script/X6Game.X6HomeObject')
    paper += b'\x01' + compact('/Game/UI/SysHome/Assets/Test/S_TestCube.S_TestCube') + b'\x01'
    paper += struct.pack('<10f', 0, 0, 0, 1, 0, 0, 0, 1, 1, 1)
    paper += bytes(5) + struct.pack('<3f', 0, 0, 0)
    saved = root / 'X6Game/Saved'
    saved.mkdir(exist_ok=True)
    (saved / 'PaperBin').write_bytes(paper)
    builds = saved / 'SavedData/BuildData'
    builds.mkdir(parents=True, exist_ok=True)
    save = {'futureMetadata': {'keep': 'synthetic'}, 'PlaceInfo': [{'ItemID': ITEM, 'InstanceID': 1,
            'Location': {'X': 0, 'Y': 0, 'Z': 100}, 'Rotation': {'Pitch': 0, 'Yaw': 0, 'Roll': 0},
            'Scale': {'X': 1, 'Y': 1, 'Z': 1}, 'unknown': {'keep': True}}]}
    (builds / 'BUILD_SAVEDATA_12345.json').write_text(json.dumps(save), encoding='utf-8')
    parser = root.parent / 'synthetic-parser.exe'
    parser.write_bytes(b'TEST-ONLY-NOT-AN-EXECUTABLE')
    return {'gameRoot': str(root), 'keys': {'mainKey': KEY.hex(), 'dynamicKeys': [{'guid': GUID, 'key': KEY.hex()}]},
            'usmapBytes': b'\xc4\x30\x03\x00' + bytes(16), 'parser': str(parser)}


def cube_glb(revision=1):
    vertices = [(-50,-50,-50),(50,-50,-50),(50,50,-50),(-50,50,-50),(-50,-50,50),(50,-50,50),(50,50,50),(-50,50,50)]
    indices = [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5]
    binary = b''.join(struct.pack('<3f', *v) for v in vertices) + struct.pack('<36H', *indices)
    doc = {'asset': {'version': '2.0', 'generator': 'Nikki Studio synthetic test'}, 'scene': 0,
           'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'scale': [.01,.01,.01]}],
           'meshes': [{'primitives': [{'attributes': {'POSITION': 0}, 'indices': 1, 'material': 0}]}],
           'materials': [{'name': 'Synthetic', 'pbrMetallicRoughness': {'baseColorFactor': [.2,.7,.4,1] if revision == 1 else [.7,.3,.2,1], 'metallicFactor': 0}}],
           'buffers': [{'byteLength': len(binary)}],
           'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': 96}, {'buffer': 0, 'byteOffset': 96, 'byteLength': 72}],
           'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': 8, 'type': 'VEC3', 'min': [-50]*3, 'max': [50]*3},
                         {'bufferView': 1, 'componentType': 5123, 'count': 36, 'type': 'SCALAR'}]}
    raw = json.dumps(doc).encode()
    raw += b' ' * ((-len(raw)) % 4)
    binary += bytes((-len(binary)) % 4)
    length = 12 + 8 + len(raw) + 8 + len(binary)
    return struct.pack('<5I', 0x46546C67, 2, length, len(raw), 0x4E4F534A) + raw + struct.pack('<2I', len(binary), 0x004E4942) + binary


def fixture_runtime():
    from asset_pipeline.runtime import Runtime
    class FixtureRuntime(Runtime):
        def export(self, packages, output, fmt):
            if not packages:
                raise ValueError('Empty selector')
            for package in packages:
                self.select(package)
                target = Path(output) / Path(package).with_suffix('.json' if fmt == 'json' else '.glb')
                target.parent.mkdir(parents=True, exist_ok=True)
                if fmt == 'json':
                    target.write_text(json.dumps([{'Type': 'StaticMesh', 'Name': 'S_TestCube',
                                                  'Properties': {'StaticMaterials': []}}]))
                else:
                    revision = int((Path(self.config['gameRoot']) / 'X6Game/Content/Paks/Test.ucas').read_bytes().split(b'_')[-1])
                    target.write_bytes(cube_glb(revision))
    return FixtureRuntime
