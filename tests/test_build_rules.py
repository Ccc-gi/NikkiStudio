import json
import os
import struct
import unittest
from pathlib import Path

from adapters import build_rules
from asset_pipeline.runtime import Runtime

FIXTURE = Path(os.environ.get('NIKKI_TEST_RULES', str(Path(__file__).resolve().parents[1] / 'local' / 'validation-reference' / 'build_rules_expected.json')))


def run(value, count, tail=b''):
    """A record holding one count-prefixed run, as the game writes its flags."""
    return b'\x00' + bytes([count]) + bytes([value]) * count + tail


def reference(ident, tail=b'', path=b'/Game/A.B_C'):
    """One item's record: the game writes a marker, the id, a byte, then the path."""
    return b'\xf0' + struct.pack('>I', ident) + b'\x00' + path + tail


def scaled(low, high, tail=b''):
    return struct.pack('<2f', low, high) + tail


class RecordsTest(unittest.TestCase):
    def test_splits_on_home_object_references_and_keys_by_id(self):
        blob = reference(1170000015, b'x' * 4) + reference(1170000016, b'y' * 4)
        found = build_rules.records(blob)
        self.assertEqual(sorted(found), [1170000015, 1170000016])
        self.assertEqual(found[1170000015], reference(1170000015, b'x' * 4))

    def test_ignores_references_outside_the_item_range(self):
        self.assertEqual(build_rules.records(reference(1160000001)), {})

    def test_keeps_the_longest_copy_of_a_repeated_id(self):
        blob = reference(1170000015, b'x' * 2) + reference(1170000015, b'y' * 40)
        self.assertEqual(build_rules.records(blob)[1170000015],
                         reference(1170000015, b'y' * 40))


class ScaleRangeTest(unittest.TestCase):
    def test_identifies_each_stated_range(self):
        for pair in build_rules.SCALE_PAIRS:
            self.assertEqual(build_rules.scale_range(scaled(*pair)), list(pair))

    def test_an_item_with_no_stated_range_cannot_be_scaled(self):
        self.assertEqual(build_rules.scale_range(b'\x00' * 64), [1.0, 1.0])

    def test_a_single_float_is_not_mistaken_for_a_range(self):
        self.assertEqual(build_rules.scale_range(struct.pack('<f', 0.7)), [1.0, 1.0])

    def test_the_ranges_are_read_in_min_max_order(self):
        low, high = build_rules.scale_range(scaled(0.1, 2.0))
        self.assertLess(low, high)


class RotationTest(unittest.TestCase):
    def test_first_block_frees_both_axes_when_the_run_is_present(self):
        self.assertEqual(build_rules.rotation_allowed(1170000040, run(1, 4)),
                         {'x': True, 'y': True, 'z': True})

    def test_first_block_locks_both_axes_without_the_run(self):
        self.assertEqual(build_rules.rotation_allowed(1170000040, run(2, 4)),
                         {'x': False, 'y': False, 'z': True})

    def test_placeables_lock_pitch_unless_a_run_says_otherwise(self):
        self.assertEqual(build_rules.rotation_allowed(1173000001, run(2, 4)),
                         {'x': True, 'y': False, 'z': True})
        self.assertEqual(build_rules.rotation_allowed(1173000001, run(1, 4)),
                         {'x': True, 'y': True, 'z': True})
        self.assertEqual(build_rules.rotation_allowed(1173000001, run(0, 4)),
                         {'x': False, 'y': False, 'z': True})

    def test_brushes_free_both_axes_only_with_the_run(self):
        self.assertEqual(build_rules.rotation_allowed(1174000001, run(1, 4)),
                         {'x': True, 'y': True, 'z': True})
        self.assertEqual(build_rules.rotation_allowed(1174000001, run(0, 4)),
                         {'x': False, 'y': False, 'z': True})

    def test_the_second_block_inverts_roll_and_pitch(self):
        self.assertEqual(build_rules.rotation_allowed(1175000001, run(2, 4)),
                         {'x': True, 'y': False, 'z': True})
        self.assertEqual(build_rules.rotation_allowed(1175000001, run(1, 4)),
                         {'x': False, 'y': True, 'z': True})

    def test_an_unknown_layout_is_reported_rather_than_guessed(self):
        self.assertIsNone(build_rules.rotation_allowed(1199000001, run(1, 4)))

    def test_yaw_is_never_restricted(self):
        for block in (1170000040, 1173000001, 1174000001, 1175000001):
            self.assertTrue(build_rules.rotation_allowed(block, run(0, 4))['z'])


class ParseTest(unittest.TestCase):
    def test_a_record_yields_both_limits(self):
        blob = reference(1170000015, b'\x00' * 8 + scaled(0.7, 1.3) + run(1, 3))
        rule = build_rules.parse(blob)[1170000015]
        self.assertEqual(rule['scaleRange'], [0.7, 1.3])
        self.assertEqual(rule['rotationAllowed'], {'x': True, 'y': True, 'z': True})

    def test_coverage_counts_what_was_read(self):
        blob = reference(1170000015, scaled(0.7, 1.3) + run(1, 3))
        self.assertEqual(build_rules.coverage(blob),
                         {'items': 1, 'scale': 1, 'rotation': 1, 'both': 1})


class RuntimeRulesTest(unittest.TestCase):
    def _runtime(self, constraints=None, area=None, schemes=None):
        runtime = object.__new__(Runtime)
        runtime.version = 'v' * 64
        runtime.constraints = constraints or {}
        runtime.build_area = area or {}
        runtime.dye_schemes = schemes or {}
        return runtime

    def test_rules_are_reported_as_coming_from_the_game(self):
        rules = self._runtime({'1170000040': {'scaleRange': [1, 1]}}).validation_rules()
        self.assertEqual(rules['source'], 'game PaperBin')
        self.assertEqual(rules['version'], 'v' * 64)

    def test_the_dye_presets_each_item_accepts_travel_with_the_rules(self):
        rules = self._runtime(schemes={'1170000040': [11, 12]}).validation_rules()
        self.assertEqual(rules['dyeSchemes']['1170000040'], [11, 12])

    def test_area_ships_with_the_editor_so_the_check_is_never_empty(self):
        from adapters import build_area
        self.assertEqual(len(build_area.POLYGONS), len(build_area.UNLOCKS))
        self.assertTrue(all(len(ring) >= 3 for ring in build_area.POLYGONS.values()))


@unittest.skipUnless(os.environ.get('NIKKI_TEST_PAPERBIN'),
                     'set NIKKI_TEST_PAPERBIN to the game PaperBin to run')
class AgainstGameTest(unittest.TestCase):
    """Reads the real blob and compares with the recorded expectations."""

    @classmethod
    def setUpClass(cls):
        cls.rules = build_rules.parse(Path(os.environ['NIKKI_TEST_PAPERBIN']).read_bytes())
        cls.expected = json.loads(FIXTURE.read_text(encoding='utf-8'))['items']

    def test_scale_is_exact(self):
        wrong = [ident for ident, want in self.expected.items()
                 if [round(v, 4) for v in self.rules[int(ident)]['scaleRange']]
                 != [round(want[0], 4), round(want[1], 4)]]
        self.assertEqual(wrong, [])

    def test_rotation_matches_at_least_99_percent(self):
        checked = wrong = 0
        for ident, want in self.expected.items():
            rotation = self.rules[int(ident)]['rotationAllowed']
            checked += 1
            if (rotation['x'], rotation['y']) != (want[2], want[3]):
                wrong += 1
        self.assertGreater(checked, 1200)
        self.assertLess(wrong / checked, .01, f'{wrong} of {checked} disagree')

    def test_every_referenced_item_is_covered(self):
        missing = [ident for ident in self.expected if int(ident) not in self.rules]
        self.assertEqual(missing, [])


if __name__ == '__main__':
    unittest.main()
