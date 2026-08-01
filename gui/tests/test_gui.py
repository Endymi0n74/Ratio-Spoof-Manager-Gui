import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ratio_spoof_manager import (
    AMOUNT_PATTERN,
    SPEED_PATTERN,
    normalize_parameter,
    parse_terminal_output,
)


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


class TerminalOutputTests(unittest.TestCase):
    def test_detects_screen_refresh_and_removes_escape_sequences(self):
        resets_screen, content = parse_terminal_output(
            "\x1b[H\x1b[2J\x1b[32mRATIO-SPOOF\x1b[0m\n"
        )

        self.assertTrue(resets_screen)
        self.assertEqual(content, "RATIO-SPOOF\n")

    def test_preserves_regular_log_output(self):
        resets_screen, content = parse_terminal_output("Tracker announced\r\n")

        self.assertFalse(resets_screen)
        self.assertEqual(content, "Tracker announced\n")

    def test_detects_windows_cls_form_feed(self):
        resets_screen, content = parse_terminal_output("\fRATIO-SPOOF\n")

        self.assertTrue(resets_screen)
        self.assertEqual(content, "RATIO-SPOOF\n")


if __name__ == "__main__":
    unittest.main()
