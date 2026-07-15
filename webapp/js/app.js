const STORAGE_KEY = "itq-progress-v1";

const state = {
  questions: [],
  progress: {},
  selectedRounds: new Set(),
  selectedCategories: new Set(),
  order: "sequential",
  queue: [],
  index: 0,
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
  state.queue = state.order === "random" ? shuffle(list.slice()) : list.slice();
  state.index = 0;
  switchView("quiz");
  renderQuiz();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- quiz view ----------

const quizPrompt = document.getElementById("quiz-prompt");
const quizMeta = document.getElementById("quiz-meta");
const answerInput = document.getElementById("quiz-answer-input");
const answerReveal = document.getElementById("quiz-answer-reveal");
const answerText = document.getElementById("quiz-answer-text");
const revealBtn = document.getElementById("reveal-btn");
const correctBtn = document.getElementById("mark-correct-btn");
const wrongBtn = document.getElementById("mark-wrong-btn");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");
const progressText = document.getElementById("quiz-progress-text");
const progressFill = document.getElementById("quiz-progress-fill");

function currentQuestion() {
  return state.queue[state.index];
}

function renderQuiz() {
  const q = currentQuestion();
  if (!q) return;
  quizMeta.innerHTML = `<span class="badge">${roundLabel(q)}</span><span class="badge">${q.category}</span><span class="badge">문제 ${q.number}</span>`;
  quizPrompt.innerHTML = q.prompt_html;
  answerInput.value = "";
  answerReveal.classList.add("hidden");
  answerText.textContent = q.answer;
  revealBtn.classList.remove("hidden");
  correctBtn.classList.add("hidden");
  wrongBtn.classList.add("hidden");

  progressText.textContent = `${state.index + 1} / ${state.queue.length}`;
  progressFill.style.width = `${((state.index + 1) / state.queue.length) * 100}%`;
}

revealBtn.addEventListener("click", () => {
  answerReveal.classList.remove("hidden");
  revealBtn.classList.add("hidden");
  correctBtn.classList.remove("hidden");
  wrongBtn.classList.remove("hidden");
});

function markResult(result) {
  const q = currentQuestion();
  const entry = state.progress[q.id] || { attempts: 0, correct: 0 };
  entry.attempts += 1;
  if (result === "correct") entry.correct += 1;
  entry.lastResult = result;
  entry.lastAt = Date.now();
  state.progress[q.id] = entry;
  saveProgress();

  if (state.index < state.queue.length - 1) {
    state.index += 1;
    renderQuiz();
  } else {
    alert("이번 세트를 모두 풀었습니다!");
    switchView("stats");
  }
}

correctBtn.addEventListener("click", () => markResult("correct"));
wrongBtn.addEventListener("click", () => markResult("wrong"));

prevBtn.addEventListener("click", () => {
  if (state.index > 0) {
    state.index -= 1;
    renderQuiz();
  }
});

nextBtn.addEventListener("click", () => {
  if (state.index < state.queue.length - 1) {
    state.index += 1;
    renderQuiz();
  }
});

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
      <div class="wrong-meta">${roundLabel(q)} · ${q.category} · 문제 ${q.number}</div>
      <div class="wrong-prompt">${q.prompt_html}</div>
      <details>
        <summary>정답 보기</summary>
        <div class="wrong-answer">${escapeText(q.answer)}</div>
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

(async function init() {
  applyBrand(localStorage.getItem(BRAND_STORAGE_KEY) || "goguma");
  await loadQuestions();
  state.progress = loadProgress();
  renderHome();
})();
