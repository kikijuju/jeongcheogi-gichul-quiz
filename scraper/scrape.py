import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup, NavigableString, Tag

HEADERS = {"User-Agent": "Mozilla/5.0 (personal study scraper)"}

# (year, round, post_id) — collected from the site's own navigation table
POSTS = [
    (2026, 1, 561),
    (2025, 1, 540),
    (2025, 2, 554),
    (2025, 3, 558),
    (2024, 1, 476),
    (2024, 2, 483),
    (2024, 3, 495),
    (2023, 1, 372),
    (2023, 2, 420),
    (2023, 3, 453),
    (2022, 1, 271),
    (2022, 2, 423),
    (2022, 3, 424),
    (2021, 1, 191),
    (2021, 2, 210),
    (2021, 3, 217),
    (2020, 1, 196),
    (2020, 2, 195),
    (2020, 3, 194),
    (2020, 4, 192),
]

QNUM_RE = re.compile(r"^\s*(\d{1,2})\s*[.)]\s*\S")

# Actual code (as opposed to a question that merely *talks about* a language)
# is the most reliable signal, and doesn't depend on the blog remembering to
# say "이것은 자바 코드입니다." Checked before the keyword rules below.
CODE_SIGNAL_RULES = [
    ("C", re.compile(r"#include")),
    ("Java", re.compile(r"System\s*\.\s*out\s*\.\s*(print|err)|public\s+class|public\s+static\s+void\s+main")),
]

# Korean particles (은/는/이/가/을/를/에/의 ...) attach directly to an English
# acronym with no space, and Python's \b treats Hangul as a word character —
# so \bSQL\b never matches "SQL문". Use an ASCII-only lookaround instead.
def _term(word: str) -> str:
    return rf"(?<![A-Za-z]){word}(?![A-Za-z])"

CATEGORY_RULES = [
    ("Python", re.compile(r"파이썬|" + _term("[Pp]y[th]?hon"), re.I)),
    ("C", re.compile(r"C\s*언어", re.I)),
    ("Java", re.compile(r"자바|" + _term("[Jj]ava"))),
    (
        "SQL/DB",
        re.compile(
            _term("SQL")
            + r"|데이터베이스|DB\s*설계|테이블|트랜잭션|롤백|Rollback|정규화|정규형|이상\s*현상"
            + r"|관계\s*대수|스키마|외래\s*키|기본\s*키|(?:개체|참조|도메인)\s*무결성|무결성\s*제약|함수\s*종속|병행\s*제어|Cardinality|Degree"
            + r"|" + _term("ER") + r"\s*다이어그램|튜플|릴레이션|GRANT",
            re.I,
        ),
    ),
    ("디자인패턴", re.compile(r"디자인\s*패턴|옵저버|싱글턴|" + _term("Factory") + r"|어댑터|프록시\s*패턴")),
    (
        "네트워크",
        re.compile(
            r"IP\s*주소|서브넷|네트워크|프로토콜|HDLC|OSI|패킷\s*교환|" + _term("IPv[46]")
            + r"|라우팅|" + _term("RIP") + r"|오류\s*검출|" + _term("CRC")
        ),
    ),
    ("보안", re.compile(r"보안|공격|해킹|취약점|악성코드|암호화|스니핑|접근\s*통제|SSO|암호\s*알고리즘|정보보호\s*관리체계")),
    (
        "운영체제",
        re.compile(
            r"스케줄링|프로세스\s*상태|" + _term("RAID") + r"|페이지\s*교체|페이지\s*부재"
            + r"|" + _term("LRU") + r"|" + _term("LFU") + r"|세마포어|공유\s*메모리|프로세스\s*간\s*통신"
            + r"|파일\s*구조|chmod|권한을?\s*부여"
        ),
    ),
    (
        "소프트웨어공학",
        re.compile(
            r"응집도|결합도|테스트|모듈|요구사항|리팩토링|형상\s*관리|형상\s*통제|릴리스\s*노트"
            + r"|" + _term("LoC") + r"|UML|SOLID|EAI|UI\s*설계|헝가리안|블랙박스|화이트박스|커버리지"
            + r"|애자일|스크럼|" + _term("XP") + r"|정적\s*분석|개발\s*방법론|GUI|CLI|" + _term("NUI")
        ),
    ),
]


MANUAL_CATEGORY_OVERRIDES = {
    # (year, round, id-suffix) -> category, for questions no keyword/code
    # signal can reliably catch (definitions with no announced language,
    # or two questions the source blog numbered identically).
    (2020, 1, "2020-1-1"): "소프트웨어공학",  # 살충제 패러독스
    (2020, 1, "2020-1-19"): "소프트웨어공학",  # 성능 지표(처리량/응답시간) - "트랜잭션"과 충돌
    (2020, 1, "2020-1-10"): "보안",  # RFC1321/MD5 (무결성이 SQL/DB 규칙과 충돌)
    (2020, 2, "2020-2-1"): "기타",  # RTO 정의, 신기술 용어
    (2020, 2, "2020-2-9"): "소프트웨어공학",  # 정적분석 도구
    (2020, 2, "2020-2-10"): "디자인패턴",  # 옵저버 패턴
    (2020, 2, "2020-2-20"): "소프트웨어공학",  # 형상관리 도구
    (2020, 3, "2020-3-5"): "네트워크",  # 프로토콜 개념
    (2020, 3, "2020-3-6"): "네트워크",  # ICMP
    (2020, 4, "2020-4-3"): "소프트웨어공학",  # UML 다이어그램
    (2021, 1, "2021-1-13"): "소프트웨어공학",  # EAI 구축유형
    (2021, 1, "2021-1-18"): "보안",  # 접근통제(DAC 등)
    (2021, 2, "2021-2-15"): "소프트웨어공학",  # 럼바우 데이터모델링
    (2021, 3, "2021-3-3"): "보안",  # 사용자 자원 사용정보 수집
    (2021, 3, "2021-3-3a"): "SQL/DB",  # GRANT 기능
    (2021, 3, "2021-3-7"): "소프트웨어공학",  # UML 관계(집합/일반화)
    (2021, 3, "2021-3-10"): "보안",  # DES
    (2021, 3, "2021-3-15"): "소프트웨어공학",  # 다이어그램
    (2021, 3, "2021-3-19"): "소프트웨어공학",  # GUI
    (2022, 1, "2022-1-7"): "Python",  # list.extend/pop/reverse 개념 문제
    (2022, 1, "2022-1-10"): "소프트웨어공학",  # 분석도구
    (2022, 3, "2022-3-4"): "C",  # 코드(void main, 배열)
    (2022, 3, "2022-3-6"): "소프트웨어공학",  # 테스트 기법
    (2022, 3, "2022-3-13"): "C",  # 코드
    (2022, 3, "2022-3-15"): "보안",  # SSO
    (2022, 3, "2022-3-18"): "SQL/DB",  # E-R 다이어그램
    (2023, 3, "2023-3-9"): "네트워크",  # ATM(비동기 전송 모드) 정의
    (2023, 3, "2023-3-15"): "소프트웨어공학",  # 판매 다이어그램
    (2024, 1, "2024-1-20"): "디자인패턴",  # Abstract Factory
    (2024, 2, "2024-2-7"): "보안",  # SEED
    (2025, 1, "2025-1-2"): "SQL/DB",  # 제약조건(개체/참조/도메인)
    (2025, 3, "2025-3-4"): "운영체제",  # cp 명령어
    (2025, 3, "2025-3-4a"): "네트워크",  # CRC/패리티 오류검출
}


def classify(text: str, override_key=None) -> str:
    if override_key in MANUAL_CATEGORY_OVERRIDES:
        return MANUAL_CATEGORY_OVERRIDES[override_key]
    for name, pattern in CODE_SIGNAL_RULES:
        if pattern.search(text):
            return name
    for name, pattern in CATEGORY_RULES:
        if pattern.search(text):
            return name
    return "기타"


def clean_code_block(div: Tag) -> str:
    tds = div.select("table td")
    if len(tds) < 2:
        return div.get_text("\n", strip=True)
    code_td = tds[1]
    lines = code_td.find_all("div", recursive=False)
    if lines:
        # the code lines live in the first div; any further sibling div is
        # a "Colored by Color Scripter" caption, not part of the code
        text = lines[0].get_text()
    else:
        text = code_td.get_text("\n")
    return text.replace("\xa0", " ").strip("\n")


# SQL is often typed as its own plain paragraph (no colorscripter widget,
# no embedded newline either — each clause is its own separate <p>). Detect
# it by the statement keyword actually starting the paragraph, and merge
# consecutive clause paragraphs (FROM/WHERE/GROUP BY/...) into the same
# code block instead of scattering one-line <pre> tags down the page.
SQL_START_RE = re.compile(
    # some questions list several statements as "1) SELECT ...", "2) SELECT ..."
    r"^(?:[①-⑩]|\d+[.)]\s*)?(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+(TABLE|VIEW|INDEX)|ALTER\s+TABLE|DROP\s+TABLE)\b",
    re.I,
)
SQL_CONTINUE_RE = re.compile(
    r"^(FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|AND|OR|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|JOIN|ON|VALUES|SET)\b",
    re.I,
)


def render_prompt_html(nodes) -> str:
    items = []  # list of ("html"|"p"|"pre", value)
    for node in nodes:
        if isinstance(node, NavigableString):
            continue
        if not isinstance(node, Tag):
            continue
        if node.name == "div" and "colorscripter-code" in (node.get("class") or []):
            code = clean_code_block(node)
            items.append(("html", f"<pre><code>{escape_html(code)}</code></pre>"))
        elif node.name == "table":
            items.append(("html", str(node)))
        else:
            text = node.get_text(" ", strip=True)
            if not text:
                continue
            # some older posts paste code as plain text (no colorscripter
            # widget); a raw newline is the tell, since normal prose never
            # has one after get_text's whitespace collapsing
            if "\n" in text or SQL_START_RE.match(text):
                items.append(("pre", text))
            elif SQL_CONTINUE_RE.match(text) and items and items[-1][0] == "pre":
                items[-1] = ("pre", items[-1][1] + "\n" + text)
            else:
                items.append(("p", text))

    parts = []
    for kind, val in items:
        if kind == "html":
            parts.append(val)
        elif kind == "pre":
            parts.append(f"<pre><code>{escape_html(val)}</code></pre>")
        else:
            parts.append(f"<p>{escape_html(val)}</p>")
    return "\n".join(parts)


def prompt_plain_text(nodes) -> str:
    chunks = []
    for node in nodes:
        if isinstance(node, Tag):
            chunks.append(node.get_text(" ", strip=True))
    return " ".join(c for c in chunks if c)


def escape_html(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def parse_post(html: str, year: int, round_no: int):
    soup = BeautifulSoup(html, "lxml")
    content = soup.select_one("div.tt_article_useless_p_margin.contents_style")
    if content is None:
        raise RuntimeError("content container not found")

    children = [c for c in content.children if isinstance(c, Tag)]

    questions = []
    collecting = False
    current_num = None
    buffer = []
    number_seen = {}

    def is_moreless(tag: Tag) -> bool:
        return tag.name == "div" and (tag.get("data-ke-type") or "").lower() == "moreless"

    for child in children:
        text = child.get_text(" ", strip=True)
        m = QNUM_RE.match(text) if text else None

        if m and not is_moreless(child):
            num = int(m.group(1))
            # a plausible next question number starts a new block
            if not collecting or num == (current_num or 0) + 1:
                if collecting and buffer:
                    # previous question never hit a moreless block; drop it (no answer captured)
                    pass
                collecting = True
                current_num = num
                buffer = [child]
                continue

        if collecting:
            buffer.append(child)
            if is_moreless(child):
                mc = child.select_one(".moreless-content")
                answer = mc.get_text("\n", strip=True) if mc else ""
                # buffer includes the moreless div itself; strip it from the prompt
                prompt_nodes = buffer[:-1]
                prompt_html = render_prompt_html(prompt_nodes)
                plain = prompt_plain_text(prompt_nodes)

                # the source blog occasionally repeats a question number by
                # mistake; suffix repeats so every id stays unique without
                # renumbering (and without changing ids nothing has moved)
                seen = number_seen.get(current_num, 0)
                suffix = "" if seen == 0 else chr(ord("a") + seen - 1)
                number_seen[current_num] = seen + 1
                qid = f"{year}-{round_no}-{current_num}{suffix}"

                questions.append(
                    {
                        "id": qid,
                        "year": year,
                        "round": round_no,
                        "number": current_num,
                        "category": classify(plain, override_key=(year, round_no, qid)),
                        "prompt_html": prompt_html,
                        "prompt_text": plain,
                        "answer": answer,
                    }
                )
                collecting = False
                current_num = None
                buffer = []

    return questions


def main():
    out_path = Path(__file__).resolve().parent.parent / "webapp" / "data" / "questions.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    all_questions = []
    for year, round_no, post_id in POSTS:
        url = f"https://chobopark.tistory.com/{post_id}"
        print(f"fetching {year}년 {round_no}회 ({url}) ...")
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        qs = parse_post(resp.text, year, round_no)
        print(f"  -> {len(qs)} questions")
        all_questions.extend(qs)
        time.sleep(1)  # be polite to the server

    all_questions.sort(key=lambda q: (q["year"], q["round"], q["number"]))
    out_path.write_text(json.dumps(all_questions, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nsaved {len(all_questions)} questions -> {out_path}")


if __name__ == "__main__":
    main()
