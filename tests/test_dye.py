import struct
import unittest
from adapters.paperbin_dye import parse_dye, resolve_slots
from asset_pipeline.runtime import package_path


class DyeTest(unittest.TestCase):
    def test_packed_presets_keep_multiple_component_colors(self):
        icon=b'/Game/UI/SysHomeUI/Common/Textures/Icon/Color/T_test.T_test'
        raw=b'\xf0'+struct.pack('>I',1170000001)+bytes([2,len(icon)])+icon+bytes([3,0,2,2,0,3,0,0,1,0,0])
        config=parse_dye(raw)['1170000001']
        resolved=resolve_slots(config,[{'offset':0},{'offset':2},{'offset':3}])
        self.assertEqual(resolved['0']['2']['cfg'],[[0,0,0],[2,0,2],[3,0,2]])

    def test_independent_regions_do_not_overwrite_each_other(self):
        config={str(group):{'1':{'packedVariants':[26]}} for group in (1,2)}
        resolved=resolve_slots(config,[{'offset':0,'count':2}])
        self.assertEqual(resolved['1']['1']['cfg'],[[0,1,1]])
        self.assertEqual(resolved['2']['1']['cfg'],[[1,1,1]])

    def test_nested_object_reference_is_not_a_package_name(self):
        self.assertEqual(package_path('/Game/Folder/BP_Item.BP_Item_C.Mesh'), 'X6Game/Content/Folder/BP_Item.uasset')
