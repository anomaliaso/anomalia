#!/usr/bin/env python3
"""Extract docs strings from EN/ES/FR svelte sources and rewrite pages to use svelte-i18n."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC_DOCS = ROOT / "src/routes/[[lang=locale]]/docs"
OUT_DOCS = ROOT / "src/lib/i18n/locales/docs"
TMP = {
    "en": Path("/tmp/docs-en"),
    "es": Path("/tmp/docs-es"),
    "fr": Path("/tmp/docs-fr"),
}


def page_slug(rel: str) -> str:
    p = rel.replace("\\", "/")
    if p == "+layout.svelte":
        return "layout"
    if p == "+page.svelte":
        return "intro"
    p = p.replace("/+page.svelte", "").replace("+page.svelte", "")
    return p.replace("/", "_").replace("-", "_")


def find_pages(base: Path) -> list[str]:
    return sorted(str(p.relative_to(base)) for p in base.rglob("*.svelte"))


def mask_ranges(text: str, ranges: list[tuple[int, int]]) -> str:
    chars = list(text)
    for a, b in ranges:
        for i in range(a, b):
            chars[i] = " "
    return "".join(chars)


def find_brace_groups(text: str) -> list[tuple[int, int]]:
    """Find top-level {...} spans (Svelte expressions), respecting strings."""
    ranges: list[tuple[int, int]] = []
    i = 0
    n = len(text)
    while i < n:
        if text[i] != "{":
            i += 1
            continue
        depth = 0
        j = i
        in_str: str | None = None
        escape = False
        while j < n:
            c = text[j]
            if in_str:
                if escape:
                    escape = False
                elif c == "\\":
                    escape = True
                elif c == in_str:
                    in_str = None
            else:
                if c in ("'", '"', "`"):
                    in_str = c
                elif c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                    if depth == 0:
                        ranges.append((i, j + 1))
                        i = j + 1
                        break
            j += 1
        else:
            break
    return ranges


def find_tags(text: str) -> list[tuple[int, int]]:
    """Find tag spans, ignoring '>' inside Svelte {...} expressions."""
    brace = find_brace_groups(text)
    brace_at = set()
    for a, b in brace:
        for i in range(a, b):
            brace_at.add(i)

    tags: list[tuple[int, int]] = []
    i = 0
    n = len(text)
    while i < n:
        if text[i] != "<" or i in brace_at:
            i += 1
            continue
        j = i + 1
        while j < n:
            if j not in brace_at and text[j] == ">":
                tags.append((i, j + 1))
                i = j + 1
                break
            j += 1
        else:
            break
    return tags


def extract_text_nodes(html: str) -> list[tuple[int, int, str]]:
    """Return (start, end, text) for translatable text nodes (excluding script/head/style/code/pre)."""
    mask: list[tuple[int, int]] = []
    for pat in (
        r"<script[\s\S]*?</script>",
        r"<svelte:head>[\s\S]*?</svelte:head>",
        r"<style[\s\S]*?</style>",
        r"<pre[\s\S]*?</pre>",
        r"<code[\s\S]*?</code>",
    ):
        for m in re.finditer(pat, html, flags=re.I):
            mask.append((m.start(), m.end()))

    masked_s = mask_ranges(html, mask)
    # Also ignore svelte expressions so their contents aren't treated as text
    masked_s = mask_ranges(masked_s, find_brace_groups(html))

    results: list[tuple[int, int, str]] = []
    pos = 0
    for a, b in find_tags(masked_s):
        if a > pos:
            raw = html[pos:a]
            if re.search(r"[A-Za-zÀ-ÿ]", masked_s[pos:a]):
                results.append((pos, a, raw))
        pos = b
    if pos < len(html) and re.search(r"[A-Za-zÀ-ÿ]", masked_s[pos:]):
        results.append((pos, len(html), html[pos:]))
    return results


# Object keys whose string values are UI copy (nav labels/titles, etc.)
PROP_KEYS = ("title", "label")


def iter_prop_strings(svelte: str):
    """Yield (start, end, value) for title:/label: '...' or "..." in script objects."""
    for key in PROP_KEYS:
        for m in re.finditer(
            rf"{key}:\s*'((?:\\'|[^'])*)'", svelte
        ):
            yield m.start(), m.end(), m.group(1).replace("\\'", "'")
        for m in re.finditer(
            rf'{key}:\s*"((?:\\"|[^"])*)"', svelte
        ):
            yield m.start(), m.end(), m.group(1).replace('\\"', '"')


def collect_ordered_strings(svelte: str) -> list[str]:
    """Deterministic ordered list of translatable strings for a page."""
    strings: list[str] = []

    # Stable order: props by appearance, then head attrs, then copy buttons, then body text
    prop_matches = sorted(iter_prop_strings(svelte), key=lambda x: x[0])
    for _a, _b, val in prop_matches:
        strings.append(val)

    for m in re.finditer(r"<title>(.*?)</title>", svelte, re.S):
        strings.append(m.group(1).strip())
    for m in re.finditer(r'<meta\s+name="description"\s+content="([^"]*)"', svelte):
        strings.append(m.group(1))
    for m in re.finditer(r'aria-label="([^"]*)"', svelte):
        strings.append(m.group(1))
    for m in re.finditer(r"copied === '[^']+' \? '✓' : '([^']+)'", svelte):
        strings.append(m.group(1))

    for _s, _e, raw in extract_text_nodes(svelte):
        text = raw.strip()
        if not re.search(r"[A-Za-zÀ-ÿ]", text):
            continue
        if text.startswith("{") and text.endswith("}"):
            continue
        strings.append(text)
    return strings


def rewrite_page(en_src: str, slug: str, n_strings: int) -> str:
    """Rewrite EN svelte to use $_ keys docs.{slug}.s0.."""
    replacements: list[tuple[int, int, str]] = []
    key_i = 0

    def add(start: int, end: int, new: str) -> None:
        replacements.append((start, end, new))

    for start, end, _val in sorted(iter_prop_strings(en_src), key=lambda x: x[0]):
        # Detect which prop key
        snippet = en_src[start:end]
        prop = snippet.split(":", 1)[0].strip()
        add(start, end, f"{prop}: $_('docs.{slug}.s{key_i}')")
        key_i += 1
    for m in re.finditer(r"<title>(.*?)</title>", en_src, re.S):
        add(m.start(), m.end(), f"<title>{{$_('docs.{slug}.s{key_i}')}}</title>")
        key_i += 1
    for m in re.finditer(r'<meta\s+name="description"\s+content="([^"]*)"', en_src):
        add(
            m.start(),
            m.end(),
            f'<meta name="description" content={{$_(\'docs.{slug}.s{key_i}\')}}',
        )
        key_i += 1
    for m in re.finditer(r'aria-label="([^"]*)"', en_src):
        add(m.start(), m.end(), f"aria-label={{$_('docs.{slug}.s{key_i}')}}")
        key_i += 1
    for m in re.finditer(r"copied === '[^']+' \? '✓' : '([^']+)'", en_src):
        add(m.start(), m.end(), m.group(0).rsplit(":", 1)[0] + f": $_('docs.{slug}.s{key_i}')")
        key_i += 1

    for start, end, raw in extract_text_nodes(en_src):
        text = raw.strip()
        if not re.search(r"[A-Za-zÀ-ÿ]", text):
            continue
        if text.startswith("{") and text.endswith("}"):
            continue
        lead = raw[: len(raw) - len(raw.lstrip())]
        trail = raw[len(raw.rstrip()) :]
        add(start, end, f"{lead}{{$_('docs.{slug}.s{key_i}')}}{trail}")
        key_i += 1

    if key_i != n_strings:
        raise SystemExit(f"Key count mismatch for {slug}: rewrite={key_i} collect={n_strings}")

    out = en_src
    for start, end, new in sorted(replacements, key=lambda x: -x[0]):
        out = out[:start] + new + out[end:]

    if "from 'svelte-i18n'" not in out:
        out = out.replace(
            '<script lang="ts">',
            '<script lang="ts">\n  import { _, locale } from \'svelte-i18n\';',
            1,
        )
    else:

        def fix_import(m: re.Match[str]) -> str:
            names = {x.strip() for x in m.group(1).split(",") if x.strip()}
            names.update({"_", "locale"})
            ordered = [n for n in ["_", "locale"] if n in names] + sorted(
                names - {"_", "locale"}
            )
            return f"import {{ {', '.join(ordered)} }} from 'svelte-i18n'"

        out = re.sub(r"import \{([^}]+)\} from 'svelte-i18n'", fix_import, out, count=1)

    if "from '$lib/i18n/locale'" not in out:
        out = re.sub(
            r"(import \{[^}]+\} from 'svelte-i18n';)",
            r"\1\n  import { localePath, type Locale } from '$lib/i18n/locale';",
            out,
            count=1,
        )
    elif "type Locale" not in out:
        out = out.replace(
            "import { localePath } from '$lib/i18n/locale';",
            "import { localePath, type Locale } from '$lib/i18n/locale';",
        )

    out = re.sub(
        r"const lp = \$derived\(\(p: string\) => localePath\(p, \(\(\$locale as 'en' \| 'it'\) \?\? 'en'\)\)\);",
        "const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));",
        out,
    )

    # toc.set with $_ must be reactive
    if "toc.set(" in out and "$effect(() => {\n" not in out:
        out = re.sub(r"(\n\s*)toc\.set\(", r"\1$effect(() => {\n\1  toc.set(", out, count=1)
        out = re.sub(r"(toc\.set\(\[[\s\S]*?\]\);)", r"\1\n  });", out, count=1)

    return out


def main() -> None:
    pages = find_pages(TMP["en"])
    catalogs: dict[str, dict] = {"en": {}, "es": {}, "fr": {}}
    rewritten: dict[str, str | None] = {}

    for rel in pages:
        slug = page_slug(rel)
        en = (TMP["en"] / rel).read_text()
        es = (TMP["es"] / rel).read_text()
        fr = (TMP["fr"] / rel).read_text()

        en_s = collect_ordered_strings(en)
        es_s = collect_ordered_strings(es)
        fr_s = collect_ordered_strings(fr)

        if not (len(en_s) == len(es_s) == len(fr_s)):
            print(f"COUNT MISMATCH {rel}: en={len(en_s)} es={len(es_s)} fr={len(fr_s)}")
            minlen = min(len(en_s), len(es_s), len(fr_s))
            for i in range(minlen):
                if i < 3 or i > minlen - 3:
                    print(f"  [{i}] EN={en_s[i][:60]!r}")
                    print(f"       ES={es_s[i][:60]!r}")
                    print(f"       FR={fr_s[i][:60]!r}")
            print("  en extras:", en_s[minlen:][:3])
            print("  es extras:", es_s[minlen:][:3])
            print("  fr extras:", fr_s[minlen:][:3])
            raise SystemExit(1)

        for i, (a, b, c) in enumerate(zip(en_s, es_s, fr_s)):
            key = f"s{i}"
            catalogs["en"].setdefault(slug, {})[key] = a
            catalogs["es"].setdefault(slug, {})[key] = b
            catalogs["fr"].setdefault(slug, {})[key] = c

        if rel == "+layout.svelte":
            rewritten[rel] = None
        else:
            rewritten[rel] = rewrite_page(en, slug, len(en_s))

        print(f"OK {rel} → {slug} ({len(en_s)} strings)")

    OUT_DOCS.mkdir(parents=True, exist_ok=True)
    for lang, data in catalogs.items():
        (OUT_DOCS / f"{lang}.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        )
        print(f"Wrote {lang}.json ({sum(len(v) for v in data.values())} keys)")

    for rel, content in rewritten.items():
        if content is None:
            continue
        dest = SRC_DOCS / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content)
        print(f"Wrote {dest.relative_to(ROOT)}")

    (OUT_DOCS / "_meta.json").write_text(
        json.dumps({"pages": {page_slug(r): r for r in pages}}, indent=2) + "\n"
    )


if __name__ == "__main__":
    main()
