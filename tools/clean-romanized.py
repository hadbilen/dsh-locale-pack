#!/usr/bin/env python3
"""로마자 표기 오류 정리 도구.

번역 모델이 한국어·일본어·러시아어 문구를 로마자로 적어 내보낸 값을 찾아 지운다.
지워진 키는 다음 번역 실행에서 다시 채워진다.

판정: 값이 원문(영어)과 다른데 자기 문자 체계가 하나도 없고 라틴 문자만 있으면 오류이다.
원문과 같은 값(ID, JSON, compact 같은 식별자)은 그대로 둔다.

사용법: python3 tools/clean-romanized.py [--dry]
"""

import json
import glob
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
BASELINE = os.path.join(ROOT, "tools", "en.baseline.json")

# 언어별 자기 문자 체계
NATIVE = {
    "ko": r"[\uac00-\ud7a3]",
    "ja": r"[\u3040-\u30ff\u4e00-\u9fff]",
    "zh-tw": r"[\u4e00-\u9fff]",
    "zh-hk": r"[\u4e00-\u9fff]",
    "ru": r"[\u0400-\u04ff]",
    "uk": r"[\u0400-\u04ff]",
    "th": r"[\u0e00-\u0e7f]",
    "hi": r"[\u0900-\u097f]",
    "ar": r"[\u0600-\u06ff]",
    "ur": r"[\u0600-\u06ff]",
    "he": r"[\u0590-\u05ff]",
    "fa": r"[\u0600-\u06ff]",
    "bn": r"[\u0980-\u09ff]",
}

# 원문과 같아도 다시 번역해야 하는 값(번역되지 않은 채 남은 단어)
FORCE_DROP = {
    ("conversation.detail.field.model", "ko"),
    ("cordis.body.copied", "ko"),
    ("pluginManager.registryDefault", "ko"),
    ("pluginManager.registryOfficial", "ko"),
    ("pluginManager.registryNpmmirror", "ko"),
    ("pluginManager.registryLegend", "ko"),
    ("pluginManager.registryToggle", "ko"),
}

LATIN = re.compile(r"[A-Za-z]")


def main():
    dry = "--dry" in sys.argv
    base = json.load(open(BASELINE, encoding="utf-8"))
    removed = 0
    per_lang = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "locale", "*", "*.json"))):
        lang = os.path.basename(os.path.dirname(path))
        if lang not in NATIVE:
            continue
        ns = os.path.basename(path)[:-5]
        native = re.compile(NATIVE[lang])
        data = json.load(open(path, encoding="utf-8"))
        drop = []
        for key, value in data.items():
            if not isinstance(value, str):
                continue
            english = base.get(ns, {}).get(key, "")
            forced = (f"{ns}.{key}", lang) in FORCE_DROP
            if value == english:
                if forced:
                    drop.append(key)  # 번역되지 않은 채 원문이 남은 값
                continue
            if LATIN.search(value) and not native.search(value):
                drop.append(key)
        if drop:
            per_lang[lang] = per_lang.get(lang, 0) + len(drop)
            for key in drop:
                del data[key]
            if not dry:
                with open(path, "w", encoding="utf-8") as fh:
                    json.dump(data, fh, ensure_ascii=False, indent=2, sort_keys=True)
                    fh.write("\n")
    for lang in sorted(per_lang):
        print(f"{lang}: {per_lang[lang]}건 제거(다시 번역 대상)")
    print(f"합계 {sum(per_lang.values())}건" + (" (시뮬레이션)" if dry else ""))
    if dry:
        print("실제로 지우려면 --dry를 빼고 다시 실행하세요.")


if __name__ == "__main__":
    main()
