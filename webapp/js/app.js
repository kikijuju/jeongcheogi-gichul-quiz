const STORAGE_KEY = "itq-progress-v1";

const state = {
  questions: [],
  progress: {},
  selectedRounds: new Set(),
  selectedCategories: new Set(),
  order: "sequential",
  queue: [],
  results: {},
  conceptCategories: new Set(),
  conceptSearch: "",
};

const CONCEPT_CATEGORIES = ["소프트웨어공학", "SQL/DB", "네트워크", "보안", "운영체제", "디자인패턴", "기타"];

const BRAND_STORAGE_KEY = "itq-brand-v1";
const BRAND_TEXT = {
  goguma: { title: "정처기고구마", start: "🍠 퀴즈 시작", retry: "🍠 오답만 다시 풀기", toggle: "📘 심플 테마" },
  plain: { title: "정처기 실기 기출 학습", start: "퀴즈 시작", retry: "오답만 다시 풀기", toggle: "🍠 고구마 테마" },
};

function applyBrand(brand) {
  document.documentElement.setAttribute("data-brand", brand);
  const t = BRAND_TEXT[brand];
  document.title = t.title;
  document.querySelector(".brand-text h1").textContent = t.title;
  document.getElementById("start-btn").textContent = t.start;
  document.getElementById("retry-wrong-btn").textContent = t.retry;
  document.getElementById("brand-toggle").textContent = t.toggle;
  localStorage.setItem(BRAND_STORAGE_KEY, brand);
}

document.getElementById("brand-toggle").addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-brand") || "goguma";
  applyBrand(current === "goguma" ? "plain" : "goguma");
});

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

function allCategories() {
  return Array.from(new Set(state.questions.map((q) => q.category)));
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

  document.getElementById("selected-count").textContent = `${filteredQuestions().length}문제`;
}

function filteredQuestions() {
  return state.questions.filter((q) => {
    const roundOk = state.selectedRounds.size === 0 || state.selectedRounds.has(roundKey(q));
    const catOk = state.selectedCategories.size === 0 || state.selectedCategories.has(q.category);
    return roundOk && catOk;
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

function startQuiz(list) {
  if (state.order === "random") state.queue = shuffle(list.slice());
  else if (state.order === "frequency") state.queue = list.slice().sort(byFrequency);
  else state.queue = list.slice();
  state.results = {}; // queue index -> "correct" | "wrong", for this run only
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

// ---------- quiz view ----------

const quizList = document.getElementById("quiz-list");
const quizJump = document.getElementById("quiz-jump");
const progressFill = document.getElementById("quiz-progress-fill");

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

// ---------- quiz cards ----------

function renderQuiz() {
  quizList.innerHTML = "";
  quizJump.innerHTML = "";
  state.queue.forEach((q, idx) => {
    quizList.appendChild(buildQuizCard(q, idx));
    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "jump-btn";
    jump.textContent = idx + 1;
    jump.title = `${roundLabel(q)} ${q.number}번`;
    jump.addEventListener("click", () => scrollToCard(idx));
    quizJump.appendChild(jump);
  });
  updateScore();
}

function scrollToCard(idx) {
  const card = document.getElementById(`qcard-${idx}`);
  if (!card) return;
  const offset = document.querySelector(".topbar").offsetHeight + document.querySelector(".scorebar").offsetHeight + 12;
  window.scrollTo({ top: card.getBoundingClientRect().top + window.scrollY - offset, behavior: "smooth" });
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

  card.innerHTML = `
    <div class="qcard-top">
      <span class="q-tag">기출</span>
      ${difficultyBadge(q)}
      ${q.topic ? `<span class="q-topic">${escapeText(q.topic)} · ${q.topicRounds}회 출제</span>` : ""}
      <span class="q-status"></span>
      <span class="q-num">${idx + 1} / ${state.queue.length}</span>
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
    </div>
    ${q.explanation ? `<div class="qcard-explanation hidden"><div class="answer-text">${escapeText(q.explanation)}</div></div>` : ""}
  `;
  card.querySelector(".answer-reveal .answer-text").textContent = q.answer;

  const fields = Array.from(card.querySelectorAll(".blank-input"));
  fields.forEach((field, i) => {
    field.addEventListener("input", () => autoGrow(field));
    field.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      // Enter walks through the blanks, and submits from the last one
      if (i < fields.length - 1) fields[i + 1].focus();
      else submitCard(card, q, idx);
    });
  });
  card.querySelector(".reveal-btn").addEventListener("click", () => revealCard(card, q, idx));
  card.querySelector(".correct-btn").addEventListener("click", () => recordCard(card, q, idx, "correct"));
  card.querySelector(".wrong-btn").addEventListener("click", () => recordCard(card, q, idx, "wrong"));
  card.querySelector(".override-btn").addEventListener("click", () => {
    recordCard(card, q, idx, "correct", { override: true });
    card.querySelector(".override-btn").classList.add("hidden");
  });
  const explainBtn = card.querySelector(".explain-btn");
  if (explainBtn) explainBtn.addEventListener("click", () => toggleExplanation(card));
  return card;
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
  field.style.height = `${field.scrollHeight}px`;
}

function submitCard(card, q, idx) {
  if (state.results[idx]) return; // already graded; use the buttons to change it
  const grading = gradingOf(q);
  if (grading.mode !== "auto") {
    revealCard(card, q, idx);
    return;
  }
  const fields = Array.from(card.querySelectorAll(".blank-input"));
  const perBlank = gradeBlanks(grading, fields.map((f) => f.value));
  const allRight = perBlank.every(Boolean);

  fields.forEach((f, i) => f.classList.add(perBlank[i] ? "is-correct" : "is-wrong"));
  const rightCount = perBlank.filter(Boolean).length;
  const verdict = card.querySelector(".verdict");
  verdict.className = `verdict ${allRight ? "is-correct" : "is-wrong"}`;
  verdict.textContent = allRight
    ? "⭕ 정답!"
    : `❌ 오답${grading.blanks.length > 1 ? ` (${rightCount} / ${grading.blanks.length}칸 맞음)` : ""}`;

  showReveal(card);
  card.querySelector(".override-btn").classList.toggle("hidden", allRight);
  recordCard(card, q, idx, allRight ? "correct" : "wrong");
  if (!allRight) toggleExplanation(card, true);
}

function revealCard(card, q, idx) {
  showReveal(card);
  // without an auto grade, the reader decides
  if (!state.results[idx]) card.querySelector(".self-mark").classList.remove("hidden");
}

function showReveal(card) {
  card.querySelector(".answer-reveal").classList.remove("hidden");
  card.querySelector(".reveal-btn").classList.add("hidden");
  card.querySelector(".qcard-actions").classList.remove("hidden");
}

function recordCard(card, q, idx, result, { override = false } = {}) {
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

  state.results[idx] = result;
  card.classList.remove("is-correct", "is-wrong");
  card.classList.add(result === "correct" ? "is-correct" : "is-wrong");
  card.querySelector(".q-status").textContent = result === "correct" ? "⭕ 정답" : "❌ 오답";
  card.querySelector(".self-mark").classList.add("hidden");
  if (override) {
    const verdict = card.querySelector(".verdict");
    verdict.className = "verdict is-correct";
    verdict.textContent = "⭕ 정답 처리됨";
  }
  updateScore();
}

function updateScore() {
  const results = Object.values(state.results);
  const correct = results.filter((r) => r === "correct").length;
  const wrong = results.length - correct;
  document.getElementById("score-correct").textContent = correct;
  document.getElementById("score-wrong").textContent = wrong;
  document.getElementById("score-left").textContent = state.queue.length - results.length;
  document.getElementById("score-rate").textContent =
    results.length > 0 ? `${Math.round((correct / results.length) * 100)}%` : "-";
  progressFill.style.width = `${state.queue.length ? (results.length / state.queue.length) * 100 : 0}%`;
  Array.from(quizJump.children).forEach((btn, idx) => {
    btn.classList.toggle("is-correct", state.results[idx] === "correct");
    btn.classList.toggle("is-wrong", state.results[idx] === "wrong");
  });
}

// ---------- wrong notebook ----------

function wrongQuestions() {
  return state.questions.filter((q) => {
    const entry = state.progress[q.id];
    return entry && entry.lastResult === "wrong";
  });
}

function renderWrongList() {
  const list = wrongQuestions();
  const wrap = document.getElementById("wrong-list");
  const empty = document.getElementById("wrong-empty");
  const retryBtn = document.getElementById("retry-wrong-btn");
  wrap.innerHTML = "";

  if (list.length === 0) {
    empty.classList.remove("hidden");
    retryBtn.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  retryBtn.classList.remove("hidden");

  list.forEach((q) => {
    const item = document.createElement("div");
    item.className = "wrong-item";
    item.innerHTML = `
      <div class="wrong-meta">${roundLabel(q)} · ${q.category} · 문제 ${q.number}${q.difficulty ? ` · 난이도 ${q.difficulty}` : ""}</div>
      <div class="wrong-prompt">${q.prompt_html}</div>
      <details>
        <summary>정답 보기</summary>
        <div class="wrong-answer">${escapeText(q.answer)}</div>
        ${q.explanation ? `<div class="wrong-answer explanation">${escapeText(q.explanation)}</div>` : ""}
      </details>
    `;
    wrap.appendChild(item);
  });
}

function escapeText(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

document.getElementById("retry-wrong-btn").addEventListener("click", () => {
  const list = wrongQuestions();
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
      if (!map.has(key)) {
        map.set(key, {
          category: q.category,
          prompt_html: q.prompt_html,
          answer: q.answer,
          explanation: q.explanation,
          rounds: [],
        });
      }
      map.get(key).rounds.push({ year: q.year, round: q.round });
    });

  return Array.from(map.values()).map((entry) => {
    entry.rounds.sort((a, b) => (a.year !== b.year ? a.year - b.year : a.round - b.round));
    return entry;
  });
}

function renderConcepts() {
  const catWrap = document.getElementById("concept-category-filter");
  catWrap.innerHTML = "";
  CONCEPT_CATEGORIES.forEach((cat) => {
    const label = document.createElement("label");
    label.className = "chip" + (state.conceptCategories.has(cat) ? " active" : "");
    label.innerHTML = `<input type="checkbox" ${state.conceptCategories.has(cat) ? "checked" : ""} /> ${cat}`;
    label.addEventListener("click", (e) => {
      e.preventDefault();
      if (state.conceptCategories.has(cat)) state.conceptCategories.delete(cat);
      else state.conceptCategories.add(cat);
      renderConcepts();
    });
    catWrap.appendChild(label);
  });

  const groups = conceptGroups()
    .filter((g) => state.conceptCategories.has(g.category))
    .filter((g) => {
      if (!state.conceptSearch) return true;
      const haystack = (g.prompt_html + " " + g.answer).toLowerCase();
      return haystack.includes(state.conceptSearch.toLowerCase());
    });

  document.getElementById("concept-count").textContent = `${groups.length}개 개념`;

  const listWrap = document.getElementById("concept-list");
  listWrap.innerHTML = "";

  CONCEPT_CATEGORIES.forEach((cat) => {
    const items = groups.filter((g) => g.category === cat).sort((a, b) => b.rounds.length - a.rounds.length);
    if (items.length === 0) return;

    const section = document.createElement("div");
    section.className = "concept-section";
    const heading = document.createElement("h3");
    heading.textContent = `${cat} (${items.length})`;
    section.appendChild(heading);

    items.forEach((g) => {
      const roundsText = g.rounds.map((r) => `${r.year}년 ${r.round}회`).join(", ");
      const item = document.createElement("div");
      item.className = "concept-item";
      item.innerHTML = `
        <div class="concept-meta">
          <span>${roundsText}</span>
          <span class="concept-freq">${g.rounds.length}회 출제</span>
        </div>
        <div class="concept-prompt">${g.prompt_html}</div>
        <details>
          <summary>정답 보기</summary>
          <div class="concept-answer">${escapeText(g.answer)}</div>
          ${g.explanation ? `<div class="concept-answer explanation">${escapeText(g.explanation)}</div>` : ""}
        </details>
      `;
      section.appendChild(item);
    });

    listWrap.appendChild(section);
  });
}

document.getElementById("concept-search").addEventListener("input", (e) => {
  state.conceptSearch = e.target.value;
  renderConcepts();
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
  applyBrand(localStorage.getItem(BRAND_STORAGE_KEY) || "goguma");
  await loadQuestions();
  state.progress = loadProgress();
  renderHome();
})();
