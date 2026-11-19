import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "website" / "install_publish_guide.py"
SPEC = importlib.util.spec_from_file_location("install_publish_guide", SCRIPT)
INSTALLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALLER)


class PublishGuideInstallerTests(unittest.TestCase):
    def test_patch_index_adds_each_locale_and_is_idempotent(self):
        anchors = []
        for name in (
            "COMPACT_FAQ_ANCHOR",
            "COMPACT_FOOTER_ANCHOR",
            "JSON_FAQ_ANCHOR",
            "JSON_FOOTER_ANCHOR",
        ):
            anchors.extend(getattr(INSTALLER, name).values())

        source = (
            "        </details>\n"
            "      </div>\n"
            "    </div>\n"
            "  </div>\n"
            "</section>\n\n</main>\n"
            '      <a href="https://github.com/zhouxiaoka/autoclip" target="_blank" rel="noopener">GitHub</a>\n'
            + "\n".join(anchors)
        )

        patched = INSTALLER.patch_index(source)

        self.assertEqual(patched.count("faq.7.q"), 9)
        self.assertEqual(patched.count("footer.publish"), 9)
        self.assertEqual(INSTALLER.patch_index(patched), patched)


if __name__ == "__main__":
    unittest.main()
