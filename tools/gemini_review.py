#!/usr/bin/env python3
"""Antigravity(gemini-3.8-flash-high)로 불확실한 번역을 다시 확인한다.

Jev 판단에서 의미 점수가 낮았지만 확정하기 어려웠던 항목을 Gemini에 다시 물어본다.
결과는 검수_Jev/gemini_결과.txt에 이어 적는다.

사용법: python3 tools/gemini_review.py [시작배치] [끝배치]
"""

import json
import os
import subprocess
import sys

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
JUD = os.path.join(BASE, "검수_Jev")
PROMPT = os.path.join(JUD, "gemini_검수_프롬프트.txt")
TARGETS = os.path.join(JUD, "재검토_대상.json")
RESULT = os.path.join(JUD, "gemini_결과.txt")
BATCH = 20


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    end = int(sys.argv[2]) if len(sys.argv) > 2 else 9999
    head = open(PROMPT, encoding="utf-8").read()
    head = ("이 일은 주어진 글만 보고 판단하는 일이다. 파일을 읽거나 명령을 실행할 필요가 없다. "
            "도구를 쓰지 말고 답만 적어라.\n\n") + head
    items = json.load(open(TARGETS, encoding="utf-8"))
    batches = [items[i:i + BATCH] for i in range(0, len(items), BATCH)]
    print(f"대상 {len(items)}건, {len(batches)}배치, 배치 크기 {BATCH}")
    for bi, batch in enumerate(batches, 1):
        if bi < start or bi > end:
            continue
        lines = []
        for r in batch:
            lines.append(f"[{r['lang']}/{r['key']}]")
            lines.append(f"영문: {r['en']}")
            lines.append(f"번역: {r['tr']}")
        prompt = head + "\n".join(lines)
        print(f"배치 {bi}/{len(batches)} 요청 중...")
        out = subprocess.run(
            ["agy", "--model", "gemini-3.8-flash-high", "--effort", "high",
             "--disable-slash-commands", "--sandbox", "--print", prompt, "--print-timeout", "600s"],
            capture_output=True, text=True, timeout=700,
        )
        body = out.stdout.strip()
        with open(RESULT, "a", encoding="utf-8") as fh:
            fh.write(f"\n===== 배치 {bi} =====\n{body}\n")
        print(f"  저장 완료 ({len(body)}자)")


if __name__ == "__main__":
    main()
