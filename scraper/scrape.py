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

CATEGORY_RULES = [
    ("Python", re.compile(r"파이썬|python", re.I)),
    ("C", re.compile(r"C\s*언어|C\s*코드")),
    ("Java", re.compile(r"자바|java", re.I)),
    ("SQL/DB", re.compile(r"\bSQL\b|데이터베이스|DB\s*설계|테이블")),
    ("디자인패턴", re.compile(r"디자인\s*패턴")),
    ("네트워크", re.compile(r"IP\s*주소|서브넷|네트워크|프로토콜|HDLC|OSI")),
    ("보안", re.compile(r"보안|공격|해킹|취약점|악성코드")),
    ("소프트웨어공학", re.compile(r"응집도|결합도|테스트|모듈|요구사항")),
]


def classify(text: str) -> str:
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


def render_prompt_html(nodes) -> str:
    parts = []
    for node in nodes:
        if isinstance(node, NavigableString):
            continue
        if not isinstance(node, Tag):
            continue
        if node.name == "div" and "colorscripter-code" in (node.get("class") or []):
            code = clean_code_block(node)
            parts.append(f"<pre><code>{escape_html(code)}</code></pre>")
        elif node.name == "table":
            parts.append(str(node))
        else:
            text = node.get_text(" ", strip=True)
            if text:
                parts.append(f"<p>{escape_html(text)}</p>")
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
                questions.append(
                    {
                        "id": f"{year}-{round_no}-{current_num}",
                        "year": year,
                        "round": round_no,
                        "number": current_num,
                        "category": classify(plain),
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
