const STORAGE_KEY = "itq-progress-v1";

const state = {
  questions: [],
  progress: {},
  selectedRounds: new Set(),
  selectedCategories: new Set(),
  order: "sequential",
  queue: [],
  results: {},
  cardState: {},
  bookmarks: new Set(),
  bookmarkOnly: false,
  mock: null,
  conceptMode: "list",
  conceptCategories: new Set(),
  conceptSearch: "",
};

const CONCEPT_CATEGORIES = ["소프트웨어공학", "SQL/DB", "네트워크", "보안", "운영체제", "디자인패턴", "기타"];

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
}

function roundKey(q) {
  return `${q.year}-${q.round}`;
}

function roundLabel(q) {
  return `${q.year}년 ${q.round}회`;
}

async function loadQuestions() {
  const res = await fetch("data/questions.json");
  state.questions = await res.json();

  // topic / difficulty / explanation live in a separate hand-written file so
  // re-running the scraper never clobbers them; the site still works without it
  let annotations = {};
  try {
    annotations = await (await fetch("data/annotations.json")).json();
  } catch (e) {
    annotations = {};
  }
  state.questions.forEach((q) => Object.assign(q, annotations[q.id] || {}));
  computeTopicFrequency();
}

// ---------- topic frequency ("빈출순") ----------

// recent rounds say more about the next exam than 2020's essay-style ones
function recencyWeight(year) {
  if (year >= 2025) return 3;
  if (year >= 2023) return 2;
  return 1;
}

function topicKey(q) {
  return `${q.category}::${q.topic}`;
}

function computeTopicFrequency() {
  const rounds = new Map(); // topicKey -> Set of roundKey
  state.questions.forEach((q) => {
    if (!q.topic) return;
    const key = topicKey(q);
    if (!rounds.has(key)) rounds.set(key, new Set());
    rounds.get(key).add(roundKey(q));
  });
  state.questions.forEach((q) => {
    if (!q.topic) {
      q.topicRounds = 0;
      q.topicScore = 0;
      return;
    }
    const seen = rounds.get(topicKey(q));
    q.topicRounds = seen.size;
    q.topicScore = Array.from(seen).reduce((sum, k) => sum + recencyWeight(Number(k.split("-")[0])), 0);
  });
}

function byFrequency(a, b) {
  if (a.topicScore !== b.topicScore) return b.topicScore - a.topicScore;
  if (a.topic !== b.topic) return (a.topic || "").localeCompare(b.topic || "");
  if (a.year !== b.year) return b.year - a.year;
  if (a.round !== b.round) return b.round - a.round;
  return a.number - b.number;
}

// ---------- view switching ----------

function switchView(view) {
  document.querySelectorAll(".view").forEach((el) => el.classList.remove("active"));
  document.getElementById(`view-${view}`).classList.add("active");
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  if (view === "wrong") renderWrongList();
  if (view === "stats") renderStats();
  if (view === "home") renderHome();
  if (view === "concepts") renderConcepts();
  document.body.classList.toggle("quiz-active", view === "quiz");
  if (view === "quiz") document.querySelectorAll("#quiz-list .blank-input").forEach((f) => f.value && autoGrow(f));
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

// ---------- home view ----------

function allRoundKeys() {
  const seen = new Map();
  state.questions.forEach((q) => {
    const key = roundKey(q);
    if (!seen.has(key)) seen.set(key, q);
  });
  return Array.from(seen.entries()).sort((a, b) => {
    if (a[1].year !== b[1].year) return b[1].year - a[1].year;
    return b[1].round - a[1].round;
  });
}

// code first (biggest share of recent exams), then the memorisation areas
const CATEGORY_ORDER = ["C", "Java", "Python", "SQL/DB", "소프트웨어공학", "네트워크", "보안", "운영체제", "디자인패턴", "기타"];

function allCategories() {
  const rank = (c) => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : CATEGORY_ORDER.length);
  return Array.from(new Set(state.questions.map((q) => q.category))).sort((a, b) => rank(a) - rank(b));
}

function roundStats(key) {
  const qs = state.questions.filter((q) => roundKey(q) === key);
  const done = qs.filter((q) => state.progress[q.id] && state.progress[q.id].attempts > 0).length;
  return { total: qs.length, done };
}

function renderHome() {
  const grid = document.getElementById("round-grid");
  grid.innerHTML = "";
  allRoundKeys().forEach(([key, q]) => {
    const btn = document.createElement("button");
    btn.className = "round-btn" + (state.selectedRounds.has(key) ? " selected" : "");
    const stats = roundStats(key);
    btn.innerHTML = `${roundLabel(q)}<span class="round-progress">${stats.done}/${stats.total}</span>`;
    btn.addEventListener("click", () => {
      if (state.selectedRounds.has(key)) state.selectedRounds.delete(key);
      else state.selectedRounds.add(key);
      renderHome();
    });
    grid.appendChild(btn);
  });

  const catWrap = document.getElementById("category-filter");
  catWrap.innerHTML = "";
  allCategories().forEach((cat) => {
    const label = document.createElement("label");
    label.className = "chip" + (state.selectedCategories.has(cat) ? " active" : "");
    label.innerHTML = `<input type="checkbox" ${state.selectedCategories.has(cat) ? "checked" : ""} /> ${cat}`;
    label.addEventListener("click", (e) => {
      e.preventDefault();
      if (state.selectedCategories.has(cat)) state.selectedCategories.delete(cat);
      else state.selectedCategories.add(cat);
      renderHome();
    });
    catWrap.appendChild(label);
  });

  const star = document.getElementById("bookmark-filter");
  star.classList.toggle("active", state.bookmarkOnly);
  star.querySelector(".bookmark-count").textContent = state.bookmarks.size;

  document.getElementById("selected-count").textContent = `${filteredQuestions().length}문제`;

  // offer to pick up an unfinished run
  const resume = document.getElementById("resume-btn");
  const answered = Object.keys(state.results).length;
  const unfinished = state.queue.length > 0 && answered < state.queue.length;
  resume.classList.toggle("hidden", !unfinished);
  if (unfinished) resume.textContent = mockLocked()
    ? `▶ 모의고사 이어서 풀기 (남은 시간 ${formatClock(mockRemainingMs())})`
    : `▶ 이어서 풀기 (${answered} / ${state.queue.length})`;
  document.getElementById("mock-mix").textContent = mockQuotas()
    .map((x) => `${x.cat} ${x.n}`)
    .join(" · ");
}

document.getElementById("mock-btn").addEventListener("click", () => {
  if (mockLocked() && !confirm("진행 중인 모의고사가 있어요. 새로 시작할까요?")) return;
  startMock();
});

document.getElementById("bookmark-filter").addEventListener("click", () => {
  state.bookmarkOnly = !state.bookmarkOnly;
  renderHome();
});

document.getElementById("resume-btn").addEventListener("click", () => {
  switchView("quiz");
  const next = nextOpenCard(-1);
  if (next >= 0) setTimeout(() => scrollToCard(next, { focus: true }), 50);
});

function filteredQuestions() {
  return state.questions.filter((q) => {
    const roundOk = state.selectedRounds.size === 0 || state.selectedRounds.has(roundKey(q));
    const catOk = state.selectedCategories.size === 0 || state.selectedCategories.has(q.category);
    const starOk = !state.bookmarkOnly || state.bookmarks.has(q.id);
    return roundOk && catOk && starOk;
  });
}

document.querySelectorAll('input[name="order"]').forEach((el) => {
  el.addEventListener("change", (e) => {
    state.order = e.target.value;
    document.querySelectorAll("#order-filter .chip").forEach((chip) => {
      chip.classList.toggle("active", chip.querySelector("input").checked);
    });
    document.getElementById("order-hint").classList.toggle("hidden", state.order !== "frequency");
  });
});

document.getElementById("start-btn").addEventListener("click", () => {
  const list = filteredQuestions();
  if (list.length === 0) {
    alert("선택된 문제가 없습니다. 필터를 확인해주세요.");
    return;
  }
  startQuiz(list);
});

function startQuiz(list, { mock = false } = {}) {
  if (mock) state.queue = list.slice();
  else if (state.order === "random") state.queue = shuffle(list.slice());
  else if (state.order === "frequency") state.queue = list.slice().sort(byFrequency);
  else state.queue = list.slice();
  state.mock = mock ? { startedAt: Date.now(), minutes: MOCK_MINUTES, submitted: false } : null;
  state.results = {}; // queue index -> "correct" | "wrong", for this run only
  state.cardState = {}; // queue index -> { values, result, override, revealed }
  saveSession();
  switchView("quiz");
  renderQuiz();
  window.scrollTo(0, 0);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- 실전 모의고사 ----------

const MOCK_SIZE = 20;
const MOCK_MINUTES = 150; // 실기 시험 시간

// true while a mock exam is running and not yet handed in: no answers shown,
// Enter only moves on, everything is graded at once on 제출
function mockLocked() {
  return Boolean(state.mock && !state.mock.submitted);
}

// How many questions of each category a real paper has had lately
// (2024+ rounds), scaled to MOCK_SIZE with largest-remainder rounding.
function mockQuotas() {
  const recent = state.questions.filter((q) => q.year >= 2024);
  const rounds = new Set(recent.map(roundKey)).size || 1;
  const per = new Map();
  recent.forEach((q) => per.set(q.category, (per.get(q.category) || 0) + 1 / rounds));
  const total = Array.from(per.values()).reduce((a, b) => a + b, 0);
  const raw = Array.from(per.entries()).map(([cat, n]) => ({ cat, exact: (n / total) * MOCK_SIZE }));
  raw.forEach((r) => (r.n = Math.floor(r.exact)));
  let left = MOCK_SIZE - raw.reduce((a, r) => a + r.n, 0);
  raw.sort((a, b) => (b.exact - b.n) - (a.exact - a.n));
  for (const r of raw) {
    if (left <= 0) break;
    r.n += 1;
    left -= 1;
  }
  return raw.filter((r) => r.n > 0).sort((a, b) => CATEGORY_ORDER.indexOf(a.cat) - CATEGORY_ORDER.indexOf(b.cat));
}

function buildMockPaper() {
  const paper = [];
  mockQuotas().forEach(({ cat, n }) => {
    const pool = state.questions.filter((q) => q.category === cat);
    // questions not yet answered right come first, newest rounds slightly favoured
    const ranked = shuffle(pool.slice()).sort((a, b) => {
      const sa = (state.progress[a.id]?.lastResult === "correct" ? 1 : 0) - a.year / 10000;
      const sb = (state.progress[b.id]?.lastResult === "correct" ? 1 : 0) - b.year / 10000;
      return sa - sb;
    });
    paper.push(...ranked.slice(0, n));
  });
  return shuffle(paper);
}

function startMock() {
  startQuiz(buildMockPaper(), { mock: true });
}

function mockRemainingMs() {
  if (!state.mock) return 0;
  return state.mock.startedAt + state.mock.minutes * 60000 - Date.now();
}

function formatClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function tickMock() {
  const on = mockLocked();
  document.body.classList.toggle("mock-running", on);
  document.querySelectorAll(".mock-timer").forEach((el) => {
    el.classList.toggle("hidden", !on);
    if (!on) return;
    const ms = mockRemainingMs();
    el.textContent = `⏱ ${formatClock(ms)}`;
    el.classList.toggle("urgent", ms < 10 * 60000);
  });
  if (on && mockRemainingMs() <= 0) submitMock();
}
setInterval(tickMock, 1000);

// Hand in: grade every auto question at once; 서술형 wait for self-marking
function submitMock() {
  if (!mockLocked()) return;
  state.mock.submitted = true;
  saveSession();
  renderQuiz();
  state.queue.forEach((q, idx) => {
    if (state.results[idx]) return;
    const card = document.getElementById(`qcard-${idx}`);
    const grading = gradingOf(q);
    if (grading.mode === "auto") {
      const values = Array.from(card.querySelectorAll(".blank-input")).map((f) => f.value);
      const allRight = showAutoGrade(card, grading, values);
      recordCard(card, q, idx, allRight ? "correct" : "wrong", { via: "auto" });
    } else {
      revealCard(card, q, idx);
    }
  });
  tickMock();
  document.getElementById("quiz-summary").scrollIntoView({ behavior: "smooth", block: "start" });
}

function filledCount() {
  return state.queue.filter((q, idx) => (state.cardState[idx]?.values || []).some((v) => v && v.trim())).length;
}

function renderMockPending(card) {
  const total = state.queue.length;
  const filled = filledCount();
  card.innerHTML = `
    <div class="summary-head">📝 실전 모의고사 진행 중</div>
    <div class="summary-score">
      <span class="summary-big mock-timer"></span>
      <span>답 작성 ${filled} / ${total}${filled < total ? ` · 빈 답안 ${total - filled}개` : ""}</span>
    </div>
    <p class="empty-msg">실제 시험처럼 풀이 중에는 정답이 보이지 않아요. 다 풀었으면 제출해서 한 번에 채점하세요. 시간이 끝나면 자동으로 제출돼요.</p>
    <div class="summary-actions">
      <button type="button" class="primary-btn mock-submit">제출하고 채점하기</button>
    </div>`;
  card.querySelector(".mock-submit").addEventListener("click", submitMock);
  tickMock();
}

// ---------- quiz session (이어풀기) ----------

// The current run — which questions, what was typed, what was graded — so a
// refresh or closing the tab doesn't throw away a half-done set.
const SESSION_KEY = "itq-session-v1";

function saveSession() {
  try {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ ids: state.queue.map((q) => q.id), cards: state.cardState, mock: state.mock, savedAt: Date.now() })
    );
  } catch (e) {
    /* storage full or blocked: the run just won't survive a reload */
  }
}

function loadSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (!saved || !Array.isArray(saved.ids)) return false;
    const byId = new Map(state.questions.map((q) => [q.id, q]));
    const queue = saved.ids.map((id) => byId.get(id)).filter(Boolean);
    if (queue.length === 0) return false;
    state.queue = queue;
    state.cardState = saved.cards || {};
    state.mock = saved.mock || null;
    state.results = {};
    Object.entries(state.cardState).forEach(([idx, cs]) => {
      if (cs.result) state.results[idx] = cs.result;
    });
    return true;
  } catch (e) {
    return false;
  }
}

function cardStateOf(idx) {
  if (!state.cardState[idx]) state.cardState[idx] = {};
  return state.cardState[idx];
}

// ---------- bookmarks ----------

const BOOKMARK_KEY = "itq-bookmarks-v1";

function loadBookmarks() {
  try {
    return new Set(JSON.parse(localStorage.getItem(BOOKMARK_KEY)) || []);
  } catch (e) {
    return new Set();
  }
}

function toggleBookmark(id) {
  if (state.bookmarks.has(id)) state.bookmarks.delete(id);
  else state.bookmarks.add(id);
  try {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(Array.from(state.bookmarks)));
  } catch (e) {
    /* ignore */
  }
}

// ---------- sidebar open / closed ----------

const SIDE_KEY = "itq-side-collapsed-v1";

function readSideCollapsed() {
  try {
    return localStorage.getItem(SIDE_KEY) === "1";
  } catch (e) {
    return false;
  }
}

function applySideCollapsed(collapsed) {
  document.body.classList.toggle("side-collapsed", collapsed);
  try {
    localStorage.setItem(SIDE_KEY, collapsed ? "1" : "0");
  } catch (e) {
    /* ignore */
  }
}

document.getElementById("side-close").addEventListener("click", () => applySideCollapsed(true));
document.getElementById("side-open").addEventListener("click", () => applySideCollapsed(false));

// ---------- quiz view ----------

const quizList = document.getElementById("quiz-list");
const quizJump = document.getElementById("quiz-jump");
const sideList = document.getElementById("side-list");

// ---------- grading ----------

// Lenient on purpose: case, all whitespace/line breaks, quote styles and a
// trailing period never decide right vs wrong. The accept lists in
// annotations.json carry the real variants (Korean / English / abbreviation).
function normalizeAnswer(text) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, "->")
    .replace(/\s+/g, "")
    .replace(/[.。]+$/, "");
}

function answerVariants(text) {
  const variants = new Set([text]);
  // "동치분할(Equivalence Partitioning)" -> also try "동치분할" and the part in parens
  const withoutParens = text.replace(/\([^)]*\)/g, "");
  if (withoutParens.trim()) variants.add(withoutParens);
  for (const m of text.matchAll(/\(([^)]*)\)/g)) if (m[1].trim()) variants.add(m[1]);
  // a typed blank label such as "ㄱ. ", "① ", "(1) " in front of the answer
  const unlabeled = text.replace(/^\s*(?:\(?[ㄱ-ㅎA-Za-z0-9]{1,2}\)|[ㄱ-ㅎA-Za-z0-9]{1,2}[.:]|[①-⑳])\s*/, "");
  if (unlabeled !== text && unlabeled.trim()) variants.add(unlabeled);
  return Array.from(variants).map(normalizeAnswer).filter(Boolean);
}

function blankIsCorrect(input, blank) {
  const typed = answerVariants(input);
  if (typed.length === 0) return false;
  const expected = new Set(blank.accept.flatMap(answerVariants));
  if (typed.some((t) => expected.has(t))) return true;
  // "list any order" blanks: compare the comma-separated items as a set
  if (blank.unordered) {
    const items = (s) => s.split(/[,，、/]/).map(normalizeAnswer).filter(Boolean).sort().join("|");
    const mine = items(input);
    return blank.accept.some((a) => items(a) === mine);
  }
  return false;
}

// Per-blank verdicts. With grading.unordered, each typed answer may fill any
// blank (e.g. "프로토콜 3요소" in any order), each blank used at most once.
function gradeBlanks(grading, values) {
  if (!grading.unordered) return grading.blanks.map((b, i) => blankIsCorrect(values[i], b));
  const used = new Set();
  return values.map((v) => {
    const hit = grading.blanks.findIndex((b, j) => !used.has(j) && blankIsCorrect(v, b));
    if (hit < 0) return false;
    used.add(hit);
    return true;
  });
}

function gradingOf(q) {
  const g = q.grading;
  if (g && g.mode === "auto" && Array.isArray(g.blanks) && g.blanks.length > 0) return g;
  return { mode: "self" };
}

// ---------- code highlighting ----------

const CODE_LANGUAGE = { C: "c", Java: "java", Python: "python", "SQL/DB": "sql" };
const LANGUAGE_LABEL = { c: "C", java: "Java", python: "Python", sql: "SQL" };

// Colour code blocks with highlight.js (loaded from a CDN; the page still
// works unstyled if it can't load) and give each a language label, line
// numbers and a copy button.
function enhanceCode(container, q) {
  container.querySelectorAll("pre > code").forEach((code) => {
    const pre = code.parentElement;
    if (pre.dataset.enhanced) return;
    pre.dataset.enhanced = "1";
    const text = code.textContent.replace(/\n+$/, "");
    let lang = CODE_LANGUAGE[q.category];
    if (window.hljs) {
      try {
        if (lang) code.innerHTML = window.hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
        else {
          const auto = window.hljs.highlightAuto(text, ["c", "java", "python", "sql"]);
          if (auto.relevance >= 5) {
            code.innerHTML = auto.value;
            lang = auto.language;
          }
        }
      } catch (e) {
        /* leave it plain */
      }
    }
    const lines = text.split("\n").length;
    const wrap = document.createElement("div");
    wrap.className = "code-block";
    wrap.innerHTML = `
      <div class="code-head"><span>${LANGUAGE_LABEL[lang] || "코드"}</span><button type="button" class="copy-btn">복사</button></div>
      <div class="code-body"><div class="code-lines" aria-hidden="true">${Array.from({ length: lines }, (_, i) => i + 1).join("\n")}</div></div>`;
    pre.replaceWith(wrap);
    wrap.querySelector(".code-body").appendChild(pre);
    wrap.querySelector(".copy-btn").addEventListener("click", (e) => {
      navigator.clipboard?.writeText(text).then(() => {
        e.target.textContent = "복사됨";
        setTimeout(() => (e.target.textContent = "복사"), 1200);
      });
    });
  });
}

// ---------- explanation renderer ----------

// Explanations use a tiny line-based markup (see annotations.json):
//   #개념 a, b               related-concept chips (first line)
//   ## 제목                  sub-heading
//   1. … / - …              numbered / bullet list
//   > …                     state box (variable values, intermediate results)
//   |a|b|                   table, first row is the header
//   !함정 / !팁 / !암기 …     callouts
//   !용어 이름: 설명          glossary, collected at the end
//   `code` and **bold** inline. Text is escaped first, so no raw HTML gets in.
const CALLOUT_LABEL = { 함정: "⚠️ 함정", 팁: "💡 팁", 암기: "🧠 암기" };

function inlineMarkup(text) {
  // odd segments are `code` spans; **bold** only applies outside them (C's **p)
  return escapeText(text)
    .split("`")
    .map((part, i) =>
      i % 2 === 1 ? `<code class="ic">${part}</code>` : part.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    )
    .join("");
}

function renderExplanation(source) {
  const lines = source.replace(/\r/g, "").split("\n");
  const isSpecial = (t) => !t || /^(#개념|## |\d+\.\s|- |>|\||!(함정|팁|암기|용어)\s)/.test(t);
  let tags = [];
  const terms = [];
  let html = "";
  let i = 0;
  const take = (test, strip) => {
    const items = [];
    while (i < lines.length && test(lines[i].trim())) items.push(strip(lines[i++].trim()));
    return items;
  };
  const cells = (row) => row.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
      i++;
    } else if (t.startsWith("#개념")) {
      tags = t.slice(3).split(",").map((x) => x.trim()).filter(Boolean);
      i++;
    } else if (t.startsWith("## ")) {
      html += `<h4>${inlineMarkup(t.slice(3))}</h4>`;
      i++;
    } else if (/^\d+\.\s/.test(t)) {
      const items = take((x) => /^\d+\.\s/.test(x), (x) => x.replace(/^\d+\.\s+/, ""));
      html += `<ol>${items.map((x) => `<li>${inlineMarkup(x)}</li>`).join("")}</ol>`;
    } else if (t.startsWith("- ")) {
      const items = take((x) => x.startsWith("- "), (x) => x.slice(2));
      html += `<ul>${items.map((x) => `<li>${inlineMarkup(x)}</li>`).join("")}</ul>`;
    } else if (t.startsWith(">")) {
      const items = take((x) => x.startsWith(">"), (x) => x.replace(/^>\s?/, ""));
      html += `<div class="ex-state">${items.map(inlineMarkup).join("<br>")}</div>`;
    } else if (t.startsWith("|")) {
      const [head, ...body] = take((x) => x.startsWith("|"), cells);
      html +=
        `<div class="ex-table-wrap"><table class="ex-table"><thead><tr>${head.map((c) => `<th>${inlineMarkup(c)}</th>`).join("")}</tr></thead>` +
        `<tbody>${body.map((row) => `<tr>${row.map((c) => `<td>${inlineMarkup(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    } else if (/^!(함정|팁|암기)\s/.test(t)) {
      const space = t.indexOf(" ");
      const kind = t.slice(1, space);
      html += `<div class="ex-callout ex-${kind}"><b>${CALLOUT_LABEL[kind]}</b> ${inlineMarkup(t.slice(space + 1))}</div>`;
      i++;
    } else if (t.startsWith("!용어 ")) {
      terms.push(t.slice(4));
      i++;
    } else {
      const para = take((x) => !isSpecial(x), (x) => x);
      html += `<p>${para.map(inlineMarkup).join("<br>")}</p>`;
    }
  }

  const tagHtml = tags.length
    ? `<div class="ex-tags"><span class="ex-tags-label">🎓 관련 개념</span>${tags.map((x) => `<span class="ex-tag">${escapeText(x)}</span>`).join("")}</div>`
    : "";
  const termHtml = terms.length
    ? `<div class="ex-terms"><div class="ex-terms-title">📖 용어 풀이</div><dl>${terms
        .map((x) => {
          const k = x.indexOf(":");
          return k > 0 ? `<dt>${inlineMarkup(x.slice(0, k))}</dt><dd>${inlineMarkup(x.slice(k + 1).trim())}</dd>` : `<dd>${inlineMarkup(x)}</dd>`;
        })
        .join("")}</dl></div>`
    : "";
  return tagHtml + html + termHtml;
}

// ---------- quiz cards ----------

function renderQuiz() {
  quizList.innerHTML = "";
  quizJump.innerHTML = "";
  sideList.innerHTML = "";
  const hasQueue = state.queue.length > 0;
  document.getElementById("quiz-empty").classList.toggle("hidden", hasQueue);
  document.querySelector(".quiz-layout").classList.toggle("hidden", !hasQueue);
  if (!hasQueue) return;

  state.queue.forEach((q, idx) => {
    const card = buildQuizCard(q, idx);
    quizList.appendChild(card);
    restoreCard(card, q, idx);

    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "jump-btn";
    jump.textContent = idx + 1;
    jump.title = `${roundLabel(q)} ${q.number}번`;
    jump.addEventListener("click", () => scrollToCard(idx));
    quizJump.appendChild(jump);

    const item = document.createElement("button");
    item.type = "button";
    item.className = "side-item";
    item.innerHTML = `<span class="side-num">${idx + 1}</span><span class="side-text"></span><span class="side-mark"></span>`;
    item.querySelector(".side-text").textContent = q.prompt_text.replace(/^\s*\d+\s*[.)]\s*/, "");
    item.addEventListener("click", () => scrollToCard(idx));
    sideList.appendChild(item);
  });
  quizList.appendChild(buildSummaryCard());
  updateScore();
  watchCurrentCard();
}

function scrollToCard(idx, { focus = false } = {}) {
  const card = document.getElementById(`qcard-${idx}`);
  if (!card) return;
  const scorebar = document.querySelector(".scorebar");
  const topbar = document.querySelector(".topbar");
  const pinnedTop = getComputedStyle(topbar).position === "sticky" ? topbar.offsetHeight : 0;
  const offset = pinnedTop + (scorebar.offsetParent ? scorebar.offsetHeight : 0) + 12;
  window.scrollTo({ top: card.getBoundingClientRect().top + window.scrollY - offset, behavior: "smooth" });
  if (focus) {
    const field = card.querySelector(".blank-input:not([readonly])");
    if (field) field.focus({ preventScroll: true });
  }
}

// Next card that still needs an answer, after idx (wrapping round once)
function nextOpenCard(idx) {
  const n = state.queue.length;
  for (let step = 1; step <= n; step++) {
    const j = (idx + step) % n;
    if (j !== idx && !state.results[j]) return j;
  }
  return -1;
}

function goNext(idx) {
  // a mock exam is walked straight through, then on to the 제출 card
  if (mockLocked()) {
    if (idx + 1 < state.queue.length) scrollToCard(idx + 1, { focus: true });
    else document.getElementById("quiz-summary").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const next = nextOpenCard(idx);
  if (next >= 0) scrollToCard(next, { focus: true });
  else document.getElementById("quiz-summary").scrollIntoView({ behavior: "smooth", block: "center" });
}

// highlight the sidebar row of the card currently on screen
let cardObserver = null;
function watchCurrentCard() {
  if (cardObserver) cardObserver.disconnect();
  if (!("IntersectionObserver" in window)) return;
  cardObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const idx = Number(entry.target.dataset.idx);
        Array.from(sideList.children).forEach((el, i) => el.classList.toggle("current", i === idx));
        Array.from(quizJump.children).forEach((el, i) => el.classList.toggle("current", i === idx));
      });
    },
    { rootMargin: "-40% 0px -55% 0px" }
  );
  quizList.querySelectorAll(".qcard[data-idx]").forEach((card) => cardObserver.observe(card));
}

const DIFFICULTY_LEVEL = { 하: 1, 중: 2, 상: 3 };

function difficultyBadge(q) {
  if (!q.difficulty) return "";
  const level = DIFFICULTY_LEVEL[q.difficulty] || 0;
  const bars = [1, 2, 3].map((n) => `<i class="${n <= level ? "on" : ""}"></i>`).join("");
  return `<span class="q-diff diff-${q.difficulty}" title="난이도 ${q.difficulty}"><span class="q-bars">${bars}</span>${q.difficulty}</span>`;
}

function buildQuizCard(q, idx) {
  const grading = gradingOf(q);
  const card = document.createElement("div");
  card.className = "qcard";
  card.id = `qcard-${idx}`;
  card.dataset.idx = idx;

  const placeholder = "Enter = 제출, Shift+Enter = 줄바꿈";
  const inputs =
    grading.mode === "auto"
      ? grading.blanks
          .map(
            (b, i) => `
        <label class="blank">
          ${b.label ? `<span class="blank-label">${escapeText(b.label)}</span>` : ""}
          <textarea class="blank-input" rows="1" data-blank="${i}" placeholder="${grading.blanks.length > 1 ? "답 입력" : placeholder}"></textarea>
        </label>`
          )
          .join("")
      : `<label class="blank"><textarea class="blank-input" rows="2" data-blank="0" placeholder="서술형 — 적어 본 뒤 정답을 보고 스스로 채점해요"></textarea></label>`;

  const starred = state.bookmarks.has(q.id);
  card.innerHTML = `
    <div class="qcard-top">
      <span class="q-tag">기출</span>
      ${difficultyBadge(q)}
      ${q.topic ? `<span class="q-topic">${escapeText(q.topic)} · ${q.topicRounds}회 출제</span>` : ""}
      <span class="q-status"></span>
      <span class="q-num">${idx + 1} / ${state.queue.length}</span>
      <button type="button" class="star-btn ${starred ? "on" : ""}" title="북마크" aria-pressed="${starred}">${starred ? "★" : "☆"}</button>
    </div>
    <div class="qrow qrow-source">
      <div class="qlabel">기출</div>
      <div class="qbody"><span class="q-source">[실기] ${String(q.year).slice(2)}년 ${q.round}회 · ${q.number}번</span><span class="q-cat">${q.category}</span></div>
    </div>
    <div class="qrow">
      <div class="qlabel">문제</div>
      <div class="qbody quiz-prompt">${q.prompt_html}</div>
    </div>
    <div class="qrow">
      <div class="qlabel">답변</div>
      <div class="qbody">
        <div class="answer-area ${grading.mode === "auto" && grading.blanks.length > 1 ? "multi" : ""}">${inputs}</div>
        ${grading.mode === "auto" && grading.blanks.length > 1 ? `<div class="answer-hint">Enter = 다음 칸 · 마지막 칸에서 Enter = 제출</div>` : ""}
      </div>
    </div>
    <div class="qrow qrow-answer">
      <div class="qlabel">정답</div>
      <div class="qbody">
        <button type="button" class="reveal-btn">${grading.mode === "auto" ? "정답 보기" : "정답 보고 채점하기"}</button>
        <div class="answer-reveal hidden">
          <div class="verdict"></div>
          <div class="answer-text"></div>
          <div class="self-mark hidden">
            <button type="button" class="correct-btn">맞았음</button>
            <button type="button" class="wrong-btn">틀렸음</button>
          </div>
        </div>
      </div>
    </div>
    <div class="qcard-actions hidden">
      ${q.explanation ? `<button type="button" class="explain-btn">💡 해설 보기</button>` : ""}
      <button type="button" class="override-btn hidden">내 답도 맞아요</button>
      <button type="button" class="next-btn">다음 문제 ↓</button>
    </div>
    ${q.explanation ? `<div class="qrow qcard-explanation hidden"><div class="qlabel">풀이</div><div class="qbody explain-body">${renderExplanation(q.explanation)}</div></div>` : ""}
  `;
  card.querySelector(".answer-reveal .answer-text").textContent = q.answer;
  enhanceCode(card.querySelector(".quiz-prompt"), q);
  if (mockLocked()) card.querySelector(".reveal-btn").classList.add("hidden");

  const fields = Array.from(card.querySelectorAll(".blank-input"));
  fields.forEach((field, i) => {
    field.addEventListener("input", () => {
      autoGrow(field);
      cardStateOf(idx).values = fields.map((f) => f.value);
      saveSessionSoon();
      if (mockLocked()) renderSummary(); // live "답 작성 n / 20"
    });
    field.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      // once graded (or during a mock exam), Enter just moves on
      if (state.results[idx] || (mockLocked() && i === fields.length - 1)) return goNext(idx);
      // Enter walks through the blanks, and submits from the last one
      if (i < fields.length - 1) fields[i + 1].focus();
      else submitCard(card, q, idx);
    });
  });
  card.querySelector(".reveal-btn").addEventListener("click", () => revealCard(card, q, idx));
  card.querySelector(".correct-btn").addEventListener("click", () => {
    recordCard(card, q, idx, "correct");
    goNextSoon(idx);
  });
  card.querySelector(".wrong-btn").addEventListener("click", () => {
    recordCard(card, q, idx, "wrong");
    toggleExplanation(card, true);
  });
  card.querySelector(".override-btn").addEventListener("click", () => {
    recordCard(card, q, idx, "correct", { override: true });
    card.querySelector(".override-btn").classList.add("hidden");
  });
  card.querySelector(".next-btn").addEventListener("click", () => goNext(idx));
  const explainBtn = card.querySelector(".explain-btn");
  if (explainBtn) explainBtn.addEventListener("click", () => toggleExplanation(card));
  const star = card.querySelector(".star-btn");
  star.addEventListener("click", () => {
    toggleBookmark(q.id);
    const on = state.bookmarks.has(q.id);
    star.classList.toggle("on", on);
    star.textContent = on ? "★" : "☆";
    star.setAttribute("aria-pressed", on);
  });
  return card;
}

let saveTimer = null;
function saveSessionSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSession, 400);
}

let advanceTimer = null;
function goNextSoon(idx) {
  clearTimeout(advanceTimer);
  advanceTimer = setTimeout(() => goNext(idx), 900);
}

function toggleExplanation(card, open) {
  const box = card.querySelector(".qcard-explanation");
  const btn = card.querySelector(".explain-btn");
  if (!box || !btn) return;
  const show = open === undefined ? box.classList.contains("hidden") : open;
  box.classList.toggle("hidden", !show);
  btn.textContent = show ? "💡 해설 접기" : "💡 해설 보기";
}

function autoGrow(field) {
  field.style.height = "auto";
  // a card restored while the quiz view is hidden has no layout yet; keep the
  // natural height then (switchView re-grows once it is visible)
  if (field.scrollHeight) field.style.height = `${field.scrollHeight}px`;
}

function submitCard(card, q, idx) {
  if (mockLocked()) return goNext(idx); // graded together on 제출
  if (state.results[idx]) return; // already graded; use the buttons to change it
  const grading = gradingOf(q);
  if (grading.mode !== "auto") {
    revealCard(card, q, idx);
    return;
  }
  const values = Array.from(card.querySelectorAll(".blank-input")).map((f) => f.value);
  const allRight = showAutoGrade(card, grading, values);
  recordCard(card, q, idx, allRight ? "correct" : "wrong", { via: "auto" });
  // a right answer moves straight on; a wrong one stays put with the 해설 open
  if (allRight) goNextSoon(idx);
  else toggleExplanation(card, true);
}

// Paint an auto-grade onto the card (also used when restoring a saved run)
function showAutoGrade(card, grading, values) {
  const fields = Array.from(card.querySelectorAll(".blank-input"));
  const perBlank = gradeBlanks(grading, values);
  const allRight = perBlank.every(Boolean);
  fields.forEach((f, i) => {
    f.classList.add(perBlank[i] ? "is-correct" : "is-wrong");
    f.readOnly = true;
  });
  const rightCount = perBlank.filter(Boolean).length;
  const verdict = card.querySelector(".verdict");
  verdict.className = `verdict ${allRight ? "is-correct" : "is-wrong"}`;
  verdict.textContent = allRight
    ? "⭕ 정답!"
    : `❌ 오답${grading.blanks.length > 1 ? ` (${rightCount} / ${grading.blanks.length}칸 맞음)` : ""}`;
  showReveal(card);
  card.querySelector(".override-btn").classList.toggle("hidden", allRight);
  return allRight;
}

function revealCard(card, q, idx) {
  showReveal(card);
  cardStateOf(idx).revealed = true;
  saveSession();
  // without an auto grade, the reader decides
  if (!state.results[idx]) card.querySelector(".self-mark").classList.remove("hidden");
}

function showReveal(card) {
  card.querySelector(".answer-reveal").classList.remove("hidden");
  card.querySelector(".reveal-btn").classList.add("hidden");
  card.querySelector(".qcard-actions").classList.remove("hidden");
}

function recordCard(card, q, idx, result, { override = false, via = "self" } = {}) {
  const entry = state.progress[q.id] || { attempts: 0, correct: 0 };
  if (override) {
    if (entry.lastResult !== "correct") entry.correct += 1;
  } else {
    entry.attempts += 1;
    if (result === "correct") entry.correct += 1;
  }
  entry.lastResult = result;
  entry.lastAt = Date.now();
  state.progress[q.id] = entry;
  saveProgress();

  const cs = cardStateOf(idx);
  cs.values = Array.from(card.querySelectorAll(".blank-input")).map((f) => f.value);
  cs.result = result;
  if (override) cs.override = true;
  else cs.via = via;
  saveSession();

  state.results[idx] = result;
  paintResult(card, result, override);
  updateScore();
}

function paintResult(card, result, override) {
  card.classList.remove("is-correct", "is-wrong");
  card.classList.add(result === "correct" ? "is-correct" : "is-wrong");
  card.querySelector(".q-status").textContent = result === "correct" ? "⭕ 정답" : "❌ 오답";
  card.querySelector(".self-mark").classList.add("hidden");
  card.querySelectorAll(".blank-input").forEach((f) => (f.readOnly = true));
  if (override) {
    const verdict = card.querySelector(".verdict");
    verdict.className = "verdict is-correct";
    verdict.textContent = "⭕ 정답 처리됨";
  }
}

// Re-apply a saved run's typed answers and grades to a freshly built card
function restoreCard(card, q, idx) {
  const cs = state.cardState[idx];
  if (!cs) return;
  const fields = Array.from(card.querySelectorAll(".blank-input"));
  (cs.values || []).forEach((v, i) => {
    if (fields[i]) {
      fields[i].value = v;
      autoGrow(fields[i]);
    }
  });
  const grading = gradingOf(q);
  if (cs.result) {
    // auto-graded cards get their per-blank colours back; self-marked ones
    // (서술형, or "정답 보기" then 맞았음/틀렸음) just show the answer
    if (grading.mode === "auto" && cs.via === "auto") showAutoGrade(card, grading, cs.values || []);
    else showReveal(card);
    paintResult(card, cs.result, cs.override);
    if (cs.override) card.querySelector(".override-btn").classList.add("hidden");
  } else if (cs.revealed) {
    revealCard(card, q, idx);
  }
}

// ---------- score bar, sidebar, summary ----------

const PASS_RATE = 0.6;

function updateScore() {
  const total = state.queue.length;
  const results = Object.values(state.results);
  const correct = results.filter((r) => r === "correct").length;
  const wrong = results.length - correct;
  const rate = results.length > 0 ? `${Math.round((correct / results.length) * 100)}%` : "-";

  ["score-correct", "side-correct"].forEach((id) => (document.getElementById(id).textContent = correct));
  ["score-wrong", "side-wrong"].forEach((id) => (document.getElementById(id).textContent = wrong));
  ["score-left", "side-left"].forEach((id) => (document.getElementById(id).textContent = total - results.length));
  ["score-rate", "side-rate"].forEach((id) => {
    const el = document.getElementById(id);
    el.textContent = rate;
    el.classList.toggle("pass", results.length > 0 && correct / results.length >= PASS_RATE);
    el.classList.toggle("fail", results.length > 0 && correct / results.length < PASS_RATE);
  });

  // stacked bar of the whole set: green = right, red = wrong; the tick marks
  // 60% of the set — get the green past it and the set is a pass
  document.querySelectorAll(".score-track").forEach((track) => {
    track.querySelector(".fill-correct").style.width = `${total ? (correct / total) * 100 : 0}%`;
    track.querySelector(".fill-wrong").style.width = `${total ? (wrong / total) * 100 : 0}%`;
  });

  Array.from(quizJump.children).forEach((btn, idx) => {
    btn.classList.toggle("is-correct", state.results[idx] === "correct");
    btn.classList.toggle("is-wrong", state.results[idx] === "wrong");
  });
  Array.from(sideList.children).forEach((item, idx) => {
    item.classList.toggle("is-correct", state.results[idx] === "correct");
    item.classList.toggle("is-wrong", state.results[idx] === "wrong");
    item.querySelector(".side-mark").textContent =
      state.results[idx] === "correct" ? "⭕" : state.results[idx] === "wrong" ? "❌" : "";
  });
  renderSummary();
}

function buildSummaryCard() {
  const card = document.createElement("div");
  card.className = "qcard summary-card";
  card.id = "quiz-summary";
  return card;
}

function renderSummary() {
  const card = document.getElementById("quiz-summary");
  if (!card) return;
  if (mockLocked()) return renderMockPending(card);
  const total = state.queue.length;
  const answered = Object.keys(state.results).length;
  const correct = Object.values(state.results).filter((r) => r === "correct").length;
  const score = total ? Math.round((correct / total) * 100) : 0;
  const passed = correct / total >= PASS_RATE;
  const done = answered === total;

  const byCat = new Map();
  state.queue.forEach((q, idx) => {
    if (!byCat.has(q.category)) byCat.set(q.category, { total: 0, correct: 0 });
    const c = byCat.get(q.category);
    c.total += 1;
    if (state.results[idx] === "correct") c.correct += 1;
  });
  const wrongCount = Object.values(state.results).filter((r) => r === "wrong").length;

  card.innerHTML = `
    <div class="summary-head">${state.mock ? "📝 모의고사 결과 · " : ""}${done ? "🎉 세트 완료!" : state.mock ? `서술형 ${total - answered}문제는 정답을 보고 직접 채점해 주세요` : `아직 ${total - answered}문제 남았어요`}</div>
    <div class="summary-score ${done ? (passed ? "pass" : "fail") : ""}">
      <span class="summary-big">${score}<small>점</small></span>
      <span>${correct} / ${total} 정답${done ? ` · ${passed ? "합격권 (60점 이상) 🎉" : "합격선 60점까지 " + Math.ceil(total * PASS_RATE - correct) + "문제 더"}` : ""}</span>
    </div>
    <div class="summary-cats">
      ${Array.from(byCat.entries())
        .map(
          ([cat, c]) => `
        <div class="stat-bar-row">
          <span class="bar-label">${cat}</span>
          <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(c.correct / c.total) * 100}%"></div></div>
          <span class="bar-count">${c.correct}/${c.total}</span>
        </div>`
        )
        .join("")}
    </div>
    <div class="summary-actions">
      ${wrongCount > 0 ? `<button type="button" class="primary-btn summary-retry">❌ 틀린 ${wrongCount}문제 다시 풀기</button>` : ""}
      <button type="button" class="secondary-btn summary-home">홈으로</button>
    </div>
  `;
  const retry = card.querySelector(".summary-retry");
  if (retry) retry.addEventListener("click", () => startQuiz(state.queue.filter((q, idx) => state.results[idx] === "wrong")));
  card.querySelector(".summary-home").addEventListener("click", () => switchView("home"));
}

// ---------- shared: clean answer + review card ----------

function escapeText(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// The stored answer of older rounds carries the source blog's notes after the
// actual answer. The grading key holds the clean answer, so show that and
// keep the original text one click away.
function cleanAnswerHtml(q) {
  const g = gradingOf(q);
  if (g.mode !== "auto") return `<div class="clean-answer essay">${escapeText(q.answer)}</div>`;
  if (g.blanks.length === 1 && !g.blanks[0].label)
    return `<div class="clean-answer">${escapeText(g.blanks[0].accept[0])}</div>`;
  return `<div class="clean-answer multi">${g.blanks
    .map(
      (b) =>
        `<div class="clean-row">${b.label ? `<span class="clean-label">${escapeText(b.label)}</span>` : ""}<span>${escapeText(b.accept[0])}</span></div>`
    )
    .join("")}</div>`;
}

function hasExtraMemo(q) {
  const g = gradingOf(q);
  if (g.mode !== "auto") return false;
  const clean = g.blanks.map((b) => b.accept[0]).join("");
  return normalizeAnswer(q.answer).length > normalizeAnswer(clean).length + 12;
}

function reviewAnswerHtml(q) {
  return `
    ${cleanAnswerHtml(q)}
    ${hasExtraMemo(q) ? `<details class="raw-memo"><summary>원문 메모 보기</summary><div>${escapeText(q.answer)}</div></details>` : ""}`;
}

// A read-only question card for 오답노트 / 개념정리: same look as the quiz,
// answer and 풀이 behind one "정답 보기" button.
function buildReviewCard(q, { badge = "", sourceText = "" } = {}) {
  const card = document.createElement("div");
  card.className = "qcard review-card";
  card.innerHTML = `
    <div class="qcard-top">
      <span class="q-tag">기출</span>
      ${difficultyBadge(q)}
      ${q.topic ? `<span class="q-topic">${escapeText(q.topic)} · ${q.topicRounds}회 출제</span>` : ""}
      <span class="q-status">${badge}</span>
    </div>
    <div class="qrow qrow-source">
      <div class="qlabel">기출</div>
      <div class="qbody"><span class="q-source">${sourceText || `[실기] ${String(q.year).slice(2)}년 ${q.round}회 · ${q.number}번`}</span><span class="q-cat">${q.category}</span></div>
    </div>
    <div class="qrow">
      <div class="qlabel">문제</div>
      <div class="qbody quiz-prompt">${q.prompt_html}</div>
    </div>
    <div class="qrow qrow-answer">
      <div class="qlabel">정답</div>
      <div class="qbody">
        <button type="button" class="reveal-btn">정답 보기</button>
        <div class="review-answer hidden">${reviewAnswerHtml(q)}</div>
      </div>
    </div>
    ${q.explanation ? `<div class="qrow qcard-explanation hidden"><div class="qlabel">풀이</div><div class="qbody explain-body">${renderExplanation(q.explanation)}</div></div>` : ""}
  `;
  enhanceCode(card.querySelector(".quiz-prompt"), q);
  card.querySelector(".reveal-btn").addEventListener("click", () => {
    card.querySelector(".reveal-btn").classList.add("hidden");
    card.querySelector(".review-answer").classList.remove("hidden");
    const ex = card.querySelector(".qcard-explanation");
    if (ex) ex.classList.remove("hidden");
  });
  return card;
}

function categoryChips(containerId, selected, cats, onChange) {
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = "";
  cats.forEach((cat) => {
    const label = document.createElement("label");
    label.className = "chip" + (selected.has(cat) ? " active" : "");
    label.innerHTML = `<input type="checkbox" ${selected.has(cat) ? "checked" : ""} /> ${escapeText(cat)}`;
    label.addEventListener("click", (e) => {
      e.preventDefault();
      if (selected.has(cat)) selected.delete(cat);
      else selected.add(cat);
      onChange();
    });
    wrap.appendChild(label);
  });
}

// ---------- wrong notebook ----------

const wrongCategories = new Set();

function wrongQuestions() {
  return state.questions
    .filter((q) => {
      const entry = state.progress[q.id];
      return entry && entry.lastResult === "wrong";
    })
    .sort((a, b) => (state.progress[b.id].lastAt || 0) - (state.progress[a.id].lastAt || 0));
}

function filteredWrongQuestions() {
  return wrongQuestions().filter((q) => wrongCategories.size === 0 || wrongCategories.has(q.category));
}

function renderWrongList() {
  const all = wrongQuestions();
  const list = filteredWrongQuestions();
  const wrap = document.getElementById("wrong-list");
  const empty = document.getElementById("wrong-empty");
  const retryBtn = document.getElementById("retry-wrong-btn");
  wrap.innerHTML = "";

  const present = allCategories().filter((c) => all.some((q) => q.category === c));
  categoryChips("wrong-category-filter", wrongCategories, present, renderWrongList);
  document.getElementById("wrong-filter-row").classList.toggle("hidden", all.length === 0);
  document.getElementById("wrong-count").textContent = all.length ? `${list.length}문제` : "";

  empty.classList.toggle("hidden", all.length > 0);
  retryBtn.classList.toggle("hidden", list.length === 0);
  retryBtn.textContent = `오답 ${list.length}문제 다시 풀기`;

  list.forEach((q) => {
    const entry = state.progress[q.id];
    const misses = entry.attempts - entry.correct;
    wrap.appendChild(buildReviewCard(q, { badge: `❌ ${misses}번 틀림` }));
  });
}

document.getElementById("retry-wrong-btn").addEventListener("click", () => {
  const list = filteredWrongQuestions();
  if (list.length === 0) return;
  startQuiz(list);
});

// ---------- concept summary ----------

function conceptGroups() {
  const map = new Map();
  state.questions
    .filter((q) => CONCEPT_CATEGORIES.includes(q.category))
    .forEach((q) => {
      const key = `${q.category}::${q.prompt_text.trim()}`;
      if (!map.has(key)) map.set(key, { key, category: q.category, q, rounds: [] });
      map.get(key).rounds.push({ year: q.year, round: q.round });
    });

  return Array.from(map.values()).map((entry) => {
    entry.rounds.sort((a, b) => (a.year !== b.year ? a.year - b.year : a.round - b.round));
    return entry;
  });
}

function filteredConceptGroups() {
  const term = state.conceptSearch.toLowerCase();
  return conceptGroups()
    // nothing ticked means every category, like the home filter
    .filter((g) => state.conceptCategories.size === 0 || state.conceptCategories.has(g.category))
    .filter((g) => !term || `${g.q.prompt_text} ${g.q.answer} ${g.q.explanation || ""}`.toLowerCase().includes(term))
    .sort((a, b) => b.rounds.length - a.rounds.length || CONCEPT_CATEGORIES.indexOf(a.category) - CONCEPT_CATEGORIES.indexOf(b.category));
}

function roundsLabel(g) {
  const shown = g.rounds.slice(-3).map((r) => `${String(r.year).slice(2)}년 ${r.round}회`);
  return `[실기] ${shown.join(", ")}${g.rounds.length > 3 ? ` 외 ${g.rounds.length - 3}회` : ""}`;
}

function renderConcepts() {
  categoryChips("concept-category-filter", state.conceptCategories, CONCEPT_CATEGORIES, renderConcepts);
  document.querySelectorAll("#concept-mode .chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.mode === state.conceptMode);
  });

  const groups = filteredConceptGroups();
  document.getElementById("concept-count").textContent = `${groups.length}개 개념`;
  const listWrap = document.getElementById("concept-list");
  listWrap.innerHTML = "";

  if (state.conceptMode === "flash") {
    renderFlashcards(groups);
    return;
  }

  CONCEPT_CATEGORIES.forEach((cat) => {
    const items = groups.filter((g) => g.category === cat);
    if (items.length === 0) return;
    const heading = document.createElement("h3");
    heading.className = "concept-heading";
    heading.textContent = `${cat} (${items.length})`;
    listWrap.appendChild(heading);
    items.forEach((g) => {
      listWrap.appendChild(
        buildReviewCard(g.q, { badge: `<span class="concept-freq">${g.rounds.length}회 출제</span>`, sourceText: roundsLabel(g) })
      );
    });
  });
}

document.getElementById("concept-search").addEventListener("input", (e) => {
  state.conceptSearch = e.target.value;
  flash.deck = null;
  renderConcepts();
});

document.querySelectorAll("#concept-mode .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    state.conceptMode = chip.dataset.mode;
    flash.deck = null;
    renderConcepts();
  });
});

// ---------- flashcards ----------

const FLASH_KEY = "itq-flash-v1";
const flash = { deck: null, pos: 0, flipped: false, onlyUnknown: false, marks: loadFlashMarks() };

function loadFlashMarks() {
  try {
    return JSON.parse(localStorage.getItem(FLASH_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveFlashMarks() {
  try {
    localStorage.setItem(FLASH_KEY, JSON.stringify(flash.marks));
  } catch (e) {
    /* ignore */
  }
}

function renderFlashcards(groups) {
  const listWrap = document.getElementById("concept-list");
  if (!flash.deck) {
    const pool = flash.onlyUnknown ? groups.filter((g) => flash.marks[g.key] !== "know") : groups;
    flash.deck = pool.map((g) => g.key);
    flash.pos = 0;
    flash.flipped = false;
  }
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const deck = flash.deck.filter((k) => byKey.has(k));
  const known = groups.filter((g) => flash.marks[g.key] === "know").length;
  const unknown = groups.filter((g) => flash.marks[g.key] === "dont").length;

  const box = document.createElement("div");
  box.className = "flash";
  const head = `
    <div class="flash-head">
      <span>${Math.min(flash.pos + 1, deck.length)} / ${deck.length}</span>
      <span class="flash-know">알아요 ${known}</span>
      <span class="flash-dont">모르겠어요 ${unknown}</span>
      <label class="flash-only"><input type="checkbox" ${flash.onlyUnknown ? "checked" : ""} /> 아는 카드 빼기</label>
      <button type="button" class="secondary-btn flash-shuffle">섞기</button>
    </div>`;

  if (flash.pos >= deck.length) {
    const left = deck.filter((k) => flash.marks[k] === "dont").length;
    box.innerHTML = `${head}
      <div class="flash-card flash-done">
        <div class="summary-head">🎉 ${deck.length}장을 다 봤어요</div>
        <p>알아요 ${deck.length - left}장 · 모르겠어요 ${left}장</p>
        <div class="summary-actions">
          ${left ? `<button type="button" class="primary-btn flash-again-dont">모르는 ${left}장만 다시 보기</button>` : ""}
          <button type="button" class="secondary-btn flash-restart">처음부터 다시</button>
        </div>
      </div>`;
  } else {
    const g = byKey.get(deck[flash.pos]);
    const mark = flash.marks[g.key];
    box.innerHTML = `${head}
      <div class="flash-card ${flash.flipped ? "flipped" : ""}" tabindex="0">
        <div class="flash-meta">
          ${difficultyBadge(g.q)}<span class="q-cat">${g.category}</span><span class="concept-freq">${g.rounds.length}회 출제</span>
          ${mark ? `<span class="flash-mark ${mark}">${mark === "know" ? "알아요" : "모르겠어요"}</span>` : ""}
        </div>
        <div class="flash-front quiz-prompt">${g.q.prompt_html}</div>
        <div class="flash-back ${flash.flipped ? "" : "hidden"}">
          <div class="flash-back-title">정답</div>
          ${reviewAnswerHtml(g.q)}
          ${g.q.explanation ? `<details class="flash-explain"><summary>💡 풀이 보기</summary><div class="explain-body">${renderExplanation(g.q.explanation)}</div></details>` : ""}
        </div>
        ${flash.flipped ? "" : `<div class="flash-hint">카드를 누르거나 Space로 뒤집기</div>`}
      </div>
      <div class="flash-actions">
        <button type="button" class="wrong-btn flash-dont-btn">← 모르겠어요</button>
        <button type="button" class="secondary-btn flash-flip">${flash.flipped ? "앞면" : "뒤집기"}</button>
        <button type="button" class="correct-btn flash-know-btn">알아요 →</button>
      </div>`;
    enhanceCode(box.querySelector(".flash-front"), g.q);
  }
  listWrap.appendChild(box);

  box.querySelector(".flash-only input").addEventListener("change", (e) => {
    flash.onlyUnknown = e.target.checked;
    flash.deck = null;
    renderConcepts();
  });
  box.querySelector(".flash-shuffle").addEventListener("click", () => {
    flash.deck = shuffle(deck.slice());
    flash.pos = 0;
    flash.flipped = false;
    renderConcepts();
  });
  const on = (sel, fn) => box.querySelector(sel) && box.querySelector(sel).addEventListener("click", fn);
  on(".flash-card:not(.flash-done)", (e) => {
    if (e.target.closest("details, a, button")) return;
    flipFlash();
  });
  on(".flash-flip", flipFlash);
  on(".flash-know-btn", () => markFlash("know"));
  on(".flash-dont-btn", () => markFlash("dont"));
  on(".flash-again-dont", () => {
    flash.deck = deck.filter((k) => flash.marks[k] === "dont");
    flash.pos = 0;
    flash.flipped = false;
    renderConcepts();
  });
  on(".flash-restart", () => {
    flash.pos = 0;
    flash.flipped = false;
    renderConcepts();
  });
}

function flipFlash() {
  flash.flipped = !flash.flipped;
  renderConcepts();
}

function markFlash(kind) {
  const key = flash.deck && flash.deck[flash.pos];
  if (!key) return;
  flash.marks[key] = kind;
  saveFlashMarks();
  flash.pos += 1;
  flash.flipped = false;
  renderConcepts();
}

document.addEventListener("keydown", (e) => {
  if (state.conceptMode !== "flash" || !document.getElementById("view-concepts").classList.contains("active")) return;
  if (e.target.closest && e.target.closest("input, textarea")) return;
  if (e.key === " ") {
    e.preventDefault();
    flipFlash();
  } else if (e.key === "ArrowRight") markFlash("know");
  else if (e.key === "ArrowLeft") markFlash("dont");
});

// ---------- stats ----------

function renderStats() {
  const total = state.questions.length;
  const attemptedIds = Object.keys(state.progress).filter((id) => state.progress[id].attempts > 0);
  const attempted = attemptedIds.length;
  const correctCount = attemptedIds.filter((id) => state.progress[id].lastResult === "correct").length;
  const accuracy = attempted > 0 ? Math.round((correctCount / attempted) * 100) : 0;

  document.getElementById("stats-summary").innerHTML = `
    <div class="stat-box"><div class="stat-value">${total}</div><div class="stat-label">전체 문제</div></div>
    <div class="stat-box"><div class="stat-value">${attempted}</div><div class="stat-label">풀어본 문제</div></div>
    <div class="stat-box"><div class="stat-value">${correctCount}</div><div class="stat-label">정답 처리</div></div>
    <div class="stat-box"><div class="stat-value">${accuracy}%</div><div class="stat-label">정답률</div></div>
  `;

  renderBarGroup(
    "stats-category",
    allCategories().map((cat) => {
      const qs = state.questions.filter((q) => q.category === cat);
      return summarizeGroup(cat, qs);
    })
  );

  renderBarGroup(
    "stats-round",
    allRoundKeys().map(([key, q]) => {
      const qs = state.questions.filter((qq) => roundKey(qq) === key);
      return summarizeGroup(roundLabel(q), qs);
    })
  );
}

function summarizeGroup(label, qs) {
  const ids = qs.map((q) => q.id);
  const attempted = ids.filter((id) => state.progress[id] && state.progress[id].attempts > 0);
  const correct = attempted.filter((id) => state.progress[id].lastResult === "correct");
  const pct = attempted.length > 0 ? Math.round((correct.length / attempted.length) * 100) : 0;
  return { label, total: qs.length, attempted: attempted.length, pct };
}

function renderBarGroup(containerId, rows) {
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = "";
  rows.forEach((row) => {
    const el = document.createElement("div");
    el.className = "stat-bar-row";
    el.innerHTML = `
      <span class="bar-label">${row.label}</span>
      <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${row.pct}%"></div></div>
      <span class="bar-count">${row.attempted}/${row.total} (${row.pct}%)</span>
    `;
    wrap.appendChild(el);
  });
}

document.getElementById("reset-stats-btn").addEventListener("click", () => {
  if (confirm("모든 학습 기록을 초기화할까요? 되돌릴 수 없습니다.")) {
    state.progress = {};
    saveProgress();
    renderStats();
    renderHome();
  }
});

// ---------- init ----------

// the score bar sticks just under the (wrapping, so variable-height) top bar
function syncTopbarHeight() {
  document.documentElement.style.setProperty("--topbar-h", `${document.querySelector(".topbar").offsetHeight}px`);
}
window.addEventListener("resize", syncTopbarHeight);

(async function init() {
  syncTopbarHeight();
  applySideCollapsed(readSideCollapsed());
  await loadQuestions();
  state.progress = loadProgress();
  state.bookmarks = loadBookmarks();
  loadSession();
  renderQuiz();
  renderHome();
})();
