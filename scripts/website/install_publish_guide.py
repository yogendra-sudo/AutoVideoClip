#!/usr/bin/env python3
"""Install the publishing guide in autovideoclip_intro and link it from the home-page FAQ, footer, and sitemap. Safe to rerun."""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
GUIDE_SRC = HERE / "guides" / "publish" / "index.html"
SITEMAP_URL = "https://yogendra-sudo.github.io/autovideoclip_intro/guides/publish/"

FAQ_HTML = """        <details>
          <summary data-i18n="faq.7.q">How do I publish to Bilibili and other platforms?</summary>
          <p data-i18n-html="faq.7.a">Add an Upload-Post key and a Bilibili cookie in Settings, choose platforms for a clip, and select Only me for a first test. See the <a class="link" href="guides/publish/">publishing guide</a>.</p>
        </details>
"""

FOOTER_HTML = '      <a href="guides/publish/" data-i18n="footer.publish">Publishing guide</a>\n'

# Insert before each locale's faq.6.q; order is irrelevant as long as all eight locale keys are present.
COMPACT_FAQ = {
    "zh": "'faq.7.q':'How do I publish to Bilibili and other platforms?','faq.7.a':'Add an Upload-Post key and a Bilibili cookie in Settings, choose platforms for a clip, and select Only me for a first test. See the <a class=\"link\" href=\"guides/publish/\">publishing guide</a>.',",
    "en": "'faq.7.q':'How do I publish to Bilibili and overseas platforms?','faq.7.a':'Add an Upload-Post key and a Bilibili cookie in Settings, pick platforms on a clip, and keep Only me for a first try. Step-by-step: <a class=\"link\" href=\"guides/publish/\">publish guide</a>.',",
    "ja": "'faq.7.q':'How do I publish to Bilibili and other platforms?','faq.7.a':'Add an Upload-Post key and a Bilibili cookie in Settings, choose platforms for a clip, and select Only me for a first test. See the <a class=\"link\" href=\"guides/publish/\">publishing guide</a>.',",
    "ko": "'faq.7.q':'How do I publish to Bilibili and other platforms?','faq.7.a':'Add an Upload-Post key and a Bilibili cookie in Settings, choose platforms for a clip, and select Only me for a first test. See the <a class=\"link\" href=\"guides/publish/\">publishing guide</a>.',",
}
COMPACT_FOOTER = {
    "zh": "'footer.publish':'Publishing guide',",
    "en": "'footer.publish':'Publish guide',",
    "ja": "'footer.publish':'Publishing guide',",
    "ko": "'footer.publish':'Publishing guide',",
}
COMPACT_FAQ_ANCHOR = {
    "zh": "'faq.6.q':'\u7b2c\u4e00\u6b21\u600e\u4e48\u8bd5\uff1f'",
    "en": "'faq.6.q':'How should I try it the first time?'",
    "ja": "'faq.6.q':'\u6700\u521d\u306f\u3069\u3046\u8a66\u305b\u3070\u3044\u3044\uff1f'",
    "ko": "'faq.6.q':'\ucc98\uc74c\uc5d0\ub294 \uc5b4\ub5bb\uac8c \uc2dc\ud5d8\ud574 \ubcf4\ub098\uc694?'",
}
COMPACT_FOOTER_ANCHOR = {
    "zh": "'footer.podcast':'\u64ad\u5ba2\u5207\u7247'",
    "en": "'footer.podcast':'Podcast clips'",
    "ja": "'footer.podcast':'\u30dd\u30c3\u30c9\u30ad\u30e3\u30b9\u30c8'",
    "ko": "'footer.podcast':'\ud31f\uce90\uc2a4\ud2b8'",
}

JSON_FAQ = {
    "es": '      "faq.7.q": "How do I publish to Bilibili and other platforms?",\n      "faq.7.a": "Add an Upload-Post key and a Bilibili cookie in Settings, choose platforms for a clip, and select Only me for a first test. See the <a class=\\"link\\" href=\\"guides/publish/\\">publishing guide</a>.",\n',
    "pt": '      "faq.7.q": "How do I publish to Bilibili and other platforms?",\n      "faq.7.a": "Add an Upload-Post key and a Bilibili cookie in Settings, choose platforms for a clip, and select Only me for a first test. See the <a class=\\"link\\" href=\\"guides/publish/\\">publishing guide</a>.",\n',
    "ru": '      "faq.7.q": "How do I publish to Bilibili and other platforms?",\n      "faq.7.a": "Add an Upload-Post key and a Bilibili cookie in Settings, choose platforms for a clip, and select Only me for a first test. See the <a class=\\"link\\" href=\\"guides/publish/\\">publishing guide</a>.",\n',
    "fr": '      "faq.7.q": "How do I publish to Bilibili and other platforms?",\n      "faq.7.a": "Add an Upload-Post key and a Bilibili cookie in Settings, choose platforms for a clip, and select Only me for a first test. See the <a class=\\"link\\" href=\\"guides/publish/\\">publishing guide</a>.",\n',
}
JSON_FOOTER = {
    "es": '      "footer.publish": "Publishing guide",\n',
    "pt": '      "footer.publish": "Publishing guide",\n',
    "ru": '      "footer.publish": "Publishing guide",\n',
    "fr": '      "footer.publish": "Publishing guide",\n',
}
JSON_FAQ_ANCHOR = {
    "es": '      "faq.6.q": "\u00bfC\u00f3mo probarlo la primera vez?"',
    "pt": '      "faq.6.q": "Como experimentar na primeira vez?"',
    "ru": '      "faq.6.q": "\u0421 \u0447\u0435\u0433\u043e \u043d\u0430\u0447\u0430\u0442\u044c \u0432 \u043f\u0435\u0440\u0432\u044b\u0439 \u0440\u0430\u0437?"',
    "fr": '      "faq.6.q": "Comment essayer pour la premi\u00e8re fois ?"',
}
JSON_FOOTER_ANCHOR = {
    "es": '      "footer.podcast": "P\u00f3dcast"',
    "pt": '      "footer.podcast": "Podcast",\n      "footer.course": "Curso"',
    "ru": '      "footer.podcast": "\u041f\u043e\u0434\u043a\u0430\u0441\u0442"',
    "fr": '      "footer.podcast": "Podcast",\n      "footer.course": "Cours"',
}


def fail(msg: str) -> None:
    raise SystemExit(msg)


def insert_before(text: str, needle: str, insertion: str) -> str:
    idx = text.find(needle)
    if idx < 0:
        fail(f"Insertion point not found: {needle[:80]}")
    return text[:idx] + insertion + text[idx:]


def insert_before_once(text: str, needle: str, insertion: str) -> str:
    idx = text.find(needle)
    if idx < 0:
        fail(f"Insertion point not found: {needle[:80]}")
    if text[max(0, idx - len(insertion)) : idx] == insertion:
        return text
    return text[:idx] + insertion + text[idx:]


def patch_index(html: str) -> str:
    if 'data-i18n="faq.7.q"' not in html:
        html = insert_before(
            html,
            '        </details>\n      </div>\n    </div>\n  </div>\n</section>\n\n</main>',
            FAQ_HTML,
        )
    if 'data-i18n="footer.publish"' not in html:
        html = insert_before(
            html,
            '      <a href="https://github.com/yogendra-sudo/AutoVideoClip" target="_blank" rel="noopener">GitHub</a>',
            FOOTER_HTML,
        )

    for lang, blob in COMPACT_FAQ.items():
        html = insert_before_once(html, COMPACT_FAQ_ANCHOR[lang], blob)
    for lang, blob in COMPACT_FOOTER.items():
        html = insert_before_once(html, COMPACT_FOOTER_ANCHOR[lang], blob)
    for lang, blob in JSON_FAQ.items():
        html = insert_before_once(html, JSON_FAQ_ANCHOR[lang], blob)
    for lang, blob in JSON_FOOTER.items():
        html = insert_before_once(html, JSON_FOOTER_ANCHOR[lang], blob)

    # Counts include one data-i18n="faq.7.q" / footer.publish attribute each.
    if html.count("'faq.7.q'") != 4:
        fail(f"Unexpected faq.7.q count for zh/en/ja/ko: {html.count(chr(39) + 'faq.7.q' + chr(39))}")
    if html.count('"faq.7.q"') != 5:
        fail(f"Unexpected faq.7.q count for es/pt/ru/fr: {html.count(chr(34) + 'faq.7.q' + chr(34))}")
    if html.count("'footer.publish'") != 4 or html.count('"footer.publish"') != 5:
        fail("Unexpected number of footer.publish keys across the eight locales")
    return html


def patch_sitemap(xml: str) -> str:
    if SITEMAP_URL in xml:
        return xml
    if "</urlset>" not in xml:
        fail("sitemap.xml is missing </urlset>")
    entry = (
        f"  <url>\n    <loc>{SITEMAP_URL}</loc>\n    <lastmod>2026-09-22</lastmod>\n  </url>\n"
    )
    return xml.replace("</urlset>", entry + "</urlset>")


def patch_i18n_test(src: str) -> str:
    old = "['dl.alt','fb.alt','fb.stuck','faq.5.a','faq.6.a']"
    new = "['dl.alt','fb.alt','fb.stuck','faq.5.a','faq.6.a','faq.7.a']"
    if new in src:
        return src
    if old not in src:
        fail("Could not find the FAQ link check list in scripts/i18n.test.cjs")
    return src.replace(old, new)


def install(target: Path) -> None:
    index = target / "index.html"
    if not index.is_file():
        fail(f"No index.html found under {target}")
    if not GUIDE_SRC.is_file():
        fail(f"Missing {GUIDE_SRC}")

    dest = target / "guides" / "publish" / "index.html"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(GUIDE_SRC.read_text(encoding="utf-8"), encoding="utf-8")
    index.write_text(patch_index(index.read_text(encoding="utf-8")), encoding="utf-8")

    sitemap = target / "sitemap.xml"
    if sitemap.is_file():
        sitemap.write_text(patch_sitemap(sitemap.read_text(encoding="utf-8")), encoding="utf-8")

    i18n_test = target / "scripts" / "i18n.test.cjs"
    if i18n_test.is_file():
        i18n_test.write_text(patch_i18n_test(i18n_test.read_text(encoding="utf-8")), encoding="utf-8")


def main() -> None:
    if len(sys.argv) != 2:
        fail(f"Usage: {sys.argv[0]} <autovideoclip_intro repository path>")
    target = Path(sys.argv[1]).resolve()
    install(target)
    print(f"Wrote {target / 'guides' / 'publish' / 'index.html'}")
    print("Updated index.html, sitemap.xml (if present), and scripts/i18n.test.cjs (if present)")


if __name__ == "__main__":
    main()
