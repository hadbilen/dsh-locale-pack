#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""도구 이름(Read/Write/Edit)이 문구에 남은 자리를 고친다.

판단 없이 고치는 자리다. 영문 원문에서 도구 이름이 더 긴 문구에 들어가면
그 언어로 함께 번역해야 한다. translate_worker의 모델 사슬을 그대로 쓴다.

  python3 tools/fix-toolnames.py            # 전량
  python3 tools/fix-toolnames.py --langs ar # 지정 언어만
  python3 tools/fix-toolnames.py --dry-run  # 무엇을 바꿀지 출력만
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from translate_worker import CHAIN, LANGS, call_model  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT.parent
ITEMS = WORK / "검수_Jev" / "도구이름_잔존_139.json"
PLACEHOLDER = re.compile(r"\{[A-Za-z0-9_.]+\}")


def fix_batch(lang: str, rows: list[list[str]]) -> dict[int, str]:
    """한 언어의 행 묶음을 보내 고친 값을 받는다."""
    name = LANGS.get(lang, {}).get("name", lang)
    lines = []
    for i, (_l, key, word, en, now) in enumerate(rows):
        lines.append(f"{i+1}|{key}|{en}|{now}")
    prompt = (
        "이 일은 주어진 글만 보고 판단하는 일이다. 도구를 쓰지 말고 답만 적어라.\n\n"
        f"You are fixing {name} UI strings for a desktop app.\n"
        "Each line is: 번호|키|영문 원문|현재 번역\n"
        "In the current translation, the English tool name (Read, Write, or Edit) is left "
        "untranslated inside a phrase. Fix ONLY that: translate the leftover English word into "
        f"{name}, keeping the rest of the sentence exactly as it is.\n\n"
        "Rules:\n"
        "- Keep every {placeholder} exactly as it is.\n"
        "- Keep product names and protocol names in English (DSH, Cordis, MCP, JSON ...).\n"
        "- Do not change words that are already correct.\n"
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
            head = head.strip().lstrip("﻿").strip()
            if not head.isdigit():
                continue
            idx = int(head) - 1
            if 0 <= idx < len(rows):
                out[idx] = val.strip()
        if len(out) >= len(rows):
            break
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--langs", default="")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    rows = json.loads(ITEMS.read_text(encoding="utf-8"))
    if args.langs:
        want = set(x.strip() for x in args.langs.split(","))
        rows = [r for r in rows if r[0] in want]
    if args.limit:
        rows = rows[: args.limit]

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
            fixed.update({start + k: v for k, v in fix_batch(lang, chunk).items()})
        for i, (l, key, word, en, now) in enumerate(items):
            new = fixed.get(i)
            if not new or new == now:
                print(f"  건너뜀  {key}  (고친 값 없음)")
                continue
            if PLACEHOLDER.findall(new) != PLACEHOLDER.findall(now):
                print(f"  보류    {key}  (표시 자리가 달라짐)")
                continue
            print(f"  고침    {key}")
            print(f"     {now!r}")
            print(f"  →  {new!r}")
            if not args.dry_run:
                p = ROOT / "locale" / l / (key.split(".")[0] + ".json")
                ns = key.rsplit(".", 1)[0]
                # 네임스페이스에 점이 들어갈 수 있어 긴 접두부터 찾는다
                for cut in range(len(key) - 1, 0, -1):
                    if key[cut] == ".":
                        cand = ROOT / "locale" / l / (key[:cut] + ".json")
                        if cand.exists():
                            p, ns = cand, key[cut + 1 :]
                            break
                d = json.loads(p.read_text(encoding="utf-8"))
                if ns in d:
                    d[ns] = new
                    p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                    changed += 1
    print(f"\n바뀐 값 {changed}건")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
