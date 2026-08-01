import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ratio_spoof_manager import AMOUNT_PATTERN, SPEED_PATTERN, normalize_parameter


class ParameterTests(unittest.TestCase):
    def test_normalizes_spaces_case_and_decimal_comma(self):
        self.assertEqual(normalize_parameter(" 100 MBPS "), "100mbps")
        self.assertEqual(normalize_parameter("1,5 mbps"), "1.5mbps")

    def test_fixes_common_speed_typos(self):
        self.assertEqual(normalize_parameter("100mpbs"), "100mbps")
        self.assertEqual(normalize_parameter("500kpbs"), "500kbps")

    def test_accepts_supported_amounts(self):
        for value in ("100%", "1.5gb", "800mb", "42kb"):
            self.assertIsNotNone(AMOUNT_PATTERN.fullmatch(value))

    def test_rejects_invalid_speeds(self):
        for value in ("100", "100mb", "fast", "-5mbps"):
            self.assertIsNone(SPEED_PATTERN.fullmatch(value))


if __name__ == "__main__":
    unittest.main()
