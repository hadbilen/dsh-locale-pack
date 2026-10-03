#!/usr/bin/env python3
"""Grok 4.7로 번역 재판정 (dsh-locale-pack).

Hermes에 연결된 공급자(commandcode)의 xai/grok-4.7로 불확실한 번역을 다시 판단한다.
Jev·Gemini 판정과 겹쳐 보는 교차 확인용이다.

사용법: python3 tools/grok_review.py [시작배치] [끝배치]
결과: 검수_Jev/grok_결과.txt
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
JUD = os.path.join(BASE, "검수_Jev")
TARGETS = os.path.join(JUD, "grok_대상.json")
RESULT = os.path.join(JUD, "grok_결과.txt")
URL = "https://api.commandcode.ai/provider/v1/chat/completions"
MODEL = "xai/grok-4.7"
BATCH = 8

CONTEXT = """당신은 번역 검수자다. 대상은 DeepSeek Harness 데스크톱 앱의 화면 문구다. 개발자가 할 일을 넘기면 에이전트가 파일을 읽고 고치고 터미널 명령을 실행하는 코딩 도구이며, 화면은 대화, 설정, 플러그인 관리, 하위 에이전트, 작업 기록, 승인, 음성 입력, 예약 작업으로 이뤄진다. 쓰는 사람은 개발자다.

번역은 기술 낱말은 정확하게, 문장은 짧게여야 한다. 버튼과 라벨은 명사나 동사 한두 낱말로 끝내고, 안내 문장은 완결된 문장으로 쓴다. 사무 용어나 상담 말투로 바꾸면 안 된다.

아래 항목을 하나씩 보고 판정한다.

1. 의미 정확성: 영문의 뜻을 그대로 전달하는가. 뜻이 빠지거나 반대가 되거나 조건이 사라진 곳이 있는가
2. 화면 문구다운 어조: 짧은 라벨은 짧게, 안내 문장은 완결된 문장으로 되어 있는가
3. 용어 일관성: 같은 영문 낱말이 같은 말로 옮겨졌는가

지켜야 할 것
- 제품명과 프로토콜명(DeepSeek Harness, DSH, MCP, JSON, OpenAI Responses, Anthropic Messages)은 번역하지 않는다
- `{name}`, `{count}` 같은 표시는 글자 하나까지 그대로 둔다
- 코드 조각, 파일 경로, 명령어, 주소는 번역하지 않는다
- 짧은 라벨이 원문과 같게 남아 있다면 그것은 의도한 것이라 보고 틀리다고 하지 않는다
- 해당 언어의 관례에 맞는 표기라면 틀리다고 하지 않는다

판정은 아래 형식으로, 같은 줄에 이어서 적는다. 고칠 것이 없으면 "맞음"이라고만 적는다.

[언어/키] 맞음
[언어/키] 틀림 | 이유 | 고친 값

마지막 줄에는 "맞음 N건, 틀림 M건"으로 합계를 남긴다. 다른 설명은 붙이지 않는다.

아래 항목들:
"""


def load_key():
    for line in open(os.path.expanduser("~/.hermes/profiles/planner/.env"), encoding="utf-8"):
        line = line.strip()
        if line.startswith("COMMANDCODE_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("COMMANDCODE_API_KEY를 찾을 수 없습니다")


def ask(prompt, key):
    body = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        "max_tokens": 8000,
    }
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
        "Accept": "application/json",
    })
    for attempt in range(3):
        try:
            out = json.load(urllib.request.urlopen(req, timeout=300))
            return out["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 500, 502, 503, 504, 520, 521, 522, 524) and attempt < 2:
                time.sleep(3 + attempt * 5)
                continue
            raise
    return ""


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    end = int(sys.argv[2]) if len(sys.argv) > 2 else 9999
    items = json.load(open(TARGETS, encoding="utf-8"))
    batches = [items[i:i + BATCH] for i in range(0, len(items), BATCH)]
    key = load_key()
    print(f"대상 {len(items)}건, {len(batches)}배치, 배치 크기 {BATCH}, 모델 {MODEL}")
    for bi, batch in enumerate(batches, 1):
        if bi < start or bi > end:
            continue
        lines = []
        for r in batch:
            lines.append(f"[{r['lang']}/{r['key']}]")
            lines.append(f"영문: {r['en']}")
            lines.append(f"번역: {r['tr']}")
        print(f"배치 {bi}/{len(batches)} 요청 중...")
        body = ask(CONTEXT + "\n".join(lines), key)
        with open(RESULT, "a", encoding="utf-8") as fh:
            fh.write(f"\n===== 배치 {bi} =====\n{body.strip()}\n")
        print(f"  저장 완료 ({len(body)}자)")


if __name__ == "__main__":
    main()
