#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""고친 뒤 어순이 어색해진 문장을 그 언어에 맞게 다시 쓴다.

fix-toolnames.py가 '남은 영문 낱말만' 고치도록 지시했기 때문에, 낱말만 바뀌고
뒷 문장은 그대로인 경우가 있다. 여기서는 문장 전체를 다시 쓴다.

  python3 tools/polish-grammar.py              # 전량
  python3 tools/polish-grammar.py --langs he   # 지정 언어만
  python3 tools/polish-grammar.py --dry-run    # 무엇을 바꿀지 출력만
"""
from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

from translate_worker import CHAIN, LANGS, call_model

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT.parent
ITEMS = WORK / "검수_Jev" / "문법재검토_대상.json"
PLACEHOLDER = re.compile(r"\{[A-Za-z0-9_.]+\}")


def polish_batch(lang: str, rows: list[list[str]]) -> dict[int, str]:
    name = LANGS.get(lang, {}).get("name", lang)
    lines = [f"{i+1}|{en}|{now}" for i, (_l, _k, en, now) in enumerate(rows)]
    prompt = (
        "이 일은 주어진 글만 보고 판단하는 일이다. 도구를 쓰지 말고 답만 적어라.\n\n"
        f"You are polishing {name} UI strings for a desktop app.\n"
        "Each line is: 번호|영문 원문|현재 번역\n"
        "The current translation is semantically right but its word order or grammar may be "
        f"awkward, because only one word was replaced. Rewrite the whole sentence in natural "
        f"{name} so a native speaker reads it without effort.\n\n"
        "Rules:\n"
        "- Keep every {placeholder} exactly as it is.\n"
        "- Keep product names and protocol names in English (DSH, Cordis, MCP, JSON ...).\n"
        "- The ordinary English word 'Files' must NOT survive. Use your own language's word "
        "for file, exactly as this app's other strings do.\n"
        "- Keep the meaning of the English source exactly. Do not add or drop information.\n"
        "- Keep the same length register: labels stay short, sentences stay sentences.\n"
        "- If the current translation is already natural, return it unchanged.\n"
        "- Return ONLY lines in the form: 번호|고친값\n"
        "- No explanation, no code fences.\n\n"
        "Lines:\n" + "\n".join(lines)
    )
    out: dict[int, str] = {}
    for provider, url, key_env, model, protocol in CHAIN:
        text, err, _ = call_model(provider, url, key_env, model, protocol, prompt)
        if err or not text:
            continue
        for line in text.strip().splitlines():
            line = line.strip().strip("`")
            if "|" not in line:
                continue
            head, _, val = line.partition("|")
            head = head.strip().lstrip("\ufeff").strip()
            if not head.isdigit():
                continue
            idx = int(head) - 1
            if 0 <= idx < len(rows):
                out[idx] = val.strip()
        if len(out) >= len(rows):
            break
    return out


def write_value(lang: str, full: str, new: str) -> bool:
    parts = full.split(".")
    for cut in range(len(parts) - 1, 0, -1):
        p = ROOT / "locale" / lang / (".".join(parts[:cut]) + ".json")
        if p.exists():
            k = ".".join(parts[cut:])
            d = json.loads(p.read_text(encoding="utf-8"))
            if k not in d:
                return False
            d[k] = new
            p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            return True
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--langs", default="")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    rows = json.loads(ITEMS.read_text(encoding="utf-8"))
    if args.langs:
        want = {x.strip() for x in args.langs.split(",")}
        rows = [r for r in rows if r[0] in want]

    by_lang: dict[str, list[list[str]]] = defaultdict(list)
    for r in rows:
        by_lang[r[0]].append(r)

    changed = 0
    for lang in sorted(by_lang):
        items = by_lang[lang]
        print(f"\n=== {lang}  {len(items)}건 ===", flush=True)
        fixed: dict[int, str] = {}
        for start in range(0, len(items), 8):
            chunk = items[start : start + 8]
            fixed.update({start + k: v for k, v in polish_batch(lang, chunk).items()})
        for i, (_l, key, _en, now) in enumerate(items):
            new = fixed.get(i)
            if not new or new == now:
                continue
            if PLACEHOLDER.findall(new) != PLACEHOLDER.findall(now):
                print(f"  보류    {key}  (표시 자리가 달라짐)")
                continue
            # 여러 줄 값은 줄 수가 어긋나면 잘린 것이다. 모델 출력이 줄바꿈에서 끊기는 일이 있다.
            if new.count("\n") != now.count("\n"):
                print(f"  보류    {key}  (줄 수 {now.count(chr(10)) + 1} → {new.count(chr(10)) + 1})")
                continue
            print(f"  다시씀  {key}")
            print(f"     {now!r}")
            print(f"  →  {new!r}")
            if not args.dry_run and write_value(lang, key, new):
                changed += 1
    print(f"\n다시 쓴 값 {changed}건")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
