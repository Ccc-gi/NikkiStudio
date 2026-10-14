import unittest
from asset_pipeline.materials import mesh_material_slots, texture_parameter, PATTERNS, foliage_material


class MaterialSlotsTest(unittest.TestCase):
    def test_real_tree_textures_win_over_master_placeholders(self):
        params = {'Albedo Tex Array': '/Game/T_Base_rgb_Array.0',
                  'Albedo Tex': '/Game/T_Pine_Bark_01_D.0',
                  'Normal Tex Array': '/Game/T_Generic_Normal_Array_01.0',
                  'Normal Tex': '/Game/T_Pine_Bark_01_N.0'}
        self.assertEqual(texture_parameter(params, PATTERNS['color']), params['Albedo Tex'])
        self.assertEqual(texture_parameter(params, PATTERNS['normal']), params['Normal Tex'])
        self.assertFalse(foliage_material('MI_oaktree_Bark_LOD01'))
        self.assertTrue(foliage_material('MI_oaktree_Leaf_LOD01'))

    def test_actual_dye_arrays_still_take_priority(self):
        params = {'DiffusePatternArray': '/Game/T_Furniture_D_Array.0',
                  'Albedo Tex': '/Game/T_Furniture_D.0'}
        self.assertEqual(texture_parameter(params, PATTERNS['color']), params['DiffusePatternArray'])

    def test_skeletal_serialized_slots_are_outside_properties(self):
        slot = {'MaterialSlotName': 'MI_Chair', 'Material': {'ObjectPath': '/Game/Chair/MI_Chair.0'}}
        objects = [{'Type': 'AnimCurveMetaData'},
                   {'Type': 'SkeletalMesh', 'Properties': {'Skeleton': {}},
                    'SkeletalMaterials': [slot]}]
        self.assertEqual(mesh_material_slots(objects), [slot])

    def test_static_slots_and_indices_preserved(self):
        slots = [{'MaterialInterface': None}, {'MaterialInterface': {'ObjectPath': '/Game/Wall/MI.0'}}]
        self.assertEqual(mesh_material_slots([{'Type': 'StaticMesh', 'Properties': {'StaticMaterials': slots}}]), slots)
