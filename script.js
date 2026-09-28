const SUPABASE_URL = "https://bltecnjxyiqpdeqrkdlw.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_mYdJq0amHmhARR2ZydimZQ_kwQHUdE5";

const sb = supabase.createClient(SUPABASE_URL, PUBLISHABLE_KEY);

const $ = (id) => document.getElementById(id);
const LETTERS = ["A", "B", "C", "D", "E", "F"];

/* ============ 0. XÁC ĐỊNH ĐỀ NÀO TỪ URL ============
 * Link dạng .../gwenclassroom/apmacro/947393/  -> lấy "947393" (đoạn cuối cùng)
 * Test local dễ hơn bằng query string: index.html?code=947393
 */
function getAccessCodeFromUrl() {
  const qs = new URLSearchParams(location.search).get("code");
  if (qs) return qs;
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts.length && parts[parts.length - 1].toLowerCase() === "index.html") parts.pop();
  return parts[parts.length - 1] || "";
}
const ACCESS_CODE = getAccessCodeFromUrl();

/* ============ 1. TRẠNG THÁI ============ */
const state = {
  attemptId: null,
  examId: null,
  totalSeconds: 70 * 60,
  QUESTIONS: [],           // nạp từ Supabase sau khi qua cổng vào
  idx: 0,
  answers: [],
  marked: [],
  crossed: [],
  elimMode: false,
  secondsLeft: 0,
  finished: false,
  correctIndex: [],        // đáp án đúng từng câu — chỉ có SAU khi nộp bài (get_attempt_review)
  finalScore: null,
  finalTotal: null,
  secondsUsed: null         // MỚI: lưu lại thời gian đã làm bài để hiện ở trang thống kê
};

/* ============ 2. CỔNG VÀO ============ */
(async function initGate() {
  if (!ACCESS_CODE) {
    $("gate-exam-title").textContent = "Link không hợp lệ";
    $("gate-error").textContent = "Không tìm thấy mã đề trong link này.";
    $("gate-submit").disabled = true;
    return;
  }
  const { data, error } = await sb.rpc("get_exam_by_code", { p_access_code: ACCESS_CODE });
  const exam = Array.isArray(data) ? data[0] : data;
  if (error || !exam) {
    $("gate-exam-title").textContent = "Không tìm thấy đề thi";
    $("gate-error").textContent = "Kiểm tra lại link giáo viên gửi.";
    $("gate-submit").disabled = true;
    return;
  }
  $("gate-exam-title").textContent = exam.title;
})();

$("gate-form").onsubmit = async (e) => {
  e.preventDefault();
  const email = $("gate-email").value.trim();
  const password = $("gate-password").value;
  if (!email || !password) return;

  requestFullscreenMode(); // gọi ngay trong lúc xử lý click (bắt buộc phải đồng bộ, trước mọi await)

  $("gate-submit").disabled = true;
  $("gate-error").textContent = "Đang kiểm tra...";

  const { data, error } = await sb.rpc("start_exam_attempt", {
    p_access_code: ACCESS_CODE,
    p_password: password,
    p_email: email
  });

  if (error) {
    let msg = error.message;
    if (msg.includes("Sai mật khẩu")) msg = "Sai mật khẩu, thử lại.";
    else if (msg.includes("danh sách được phép")) msg = "Email của bạn không có trong danh sách được phép làm đề này. Liên hệ giáo viên nếu có nhầm lẫn.";
    $("gate-error").textContent = msg;
    $("gate-submit").disabled = false;
    return;
  }

  const result = Array.isArray(data) ? data[0] : data;
  state.attemptId = result.attempt_id;
  state.examId = result.exam_id;
  state.totalSeconds = result.total_seconds || 4200;
  state.secondsLeft = state.totalSeconds;

  $("gate-screen").hidden = true;
  $("app-root").hidden = false;
  $("exam-subtitle").textContent = result.title;
  document.querySelector(".footbar .brand").textContent = result.full_name;
  setupWatermark(result.full_name, email);

  // Đảm bảo trang cuộn lên đầu để thấy ngay phần thi, không bị kẹt ở vị trí cuộn cũ của cổng vào
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  await loadQuestions();
  startTimer();
  renderQuestion();

  // Cuộn lại lần nữa sau khi câu hỏi đã render (phòng khi layout thay đổi chiều cao)
  requestAnimationFrame(() => {
    window.scrollTo(0, 0);
    $("app-root").scrollIntoView({ block: "start" });
  });
};

/* ============ 3. TẢI CÂU HỎI TỪ SUPABASE ============ */
async function loadQuestions() {
  console.log("DEBUG state.examId =", state.examId); // MỚI: kiểm tra đúng exam_id đang dùng để lọc câu hỏi
  const { data: questions, error: qErr } = await sb
    .from("questions_public")
    .select("*")
    .eq("exam_id", state.examId)
    .order("question_number");
  if (qErr) {
    console.error("Lỗi tải câu hỏi:", qErr); // MỚI: in lỗi thật ra Console để biết chính xác nguyên nhân
    $("stage").innerHTML = `<div class="loading">Lỗi tải câu hỏi: ${qErr.message}</div>`;
    return;
  }
  if (!questions.length) {
    $("stage").innerHTML = `<div class="loading">Đề này chưa có câu hỏi nào.</div>`;
    return;
  }

  const { data: choices, error: cErr } = await sb
    .from("choices_public")
    .select("*")
    .in("question_id", questions.map((q) => q.id))
    .order("choice_index");
  if (cErr) {
    $("stage").innerHTML = `<div class="loading">Lỗi tải đáp án: ${cErr.message}</div>`;
    return;
  }

  state.QUESTIONS = questions.map((q) => ({
    id: q.id,
    text: q.text,
    unit: q.unit || q.topic || null, // dùng cho trang thống kê (top unit đúng/sai nhiều nhất)
    image: q.image_url ? { src: q.image_url, alt: q.image_alt, caption: q.image_caption } : null,
    choices: choices.filter((c) => c.question_id === q.id).map((c) => c.text)
  }));
  state.answers = state.QUESTIONS.map(() => null);
  state.marked = state.QUESTIONS.map(() => false);
  state.crossed = state.QUESTIONS.map(() => new Set());
  state.correctIndex = state.QUESTIONS.map(() => null);
}

/* ============ 4. ĐỒNG BỘ CÂU TRẢ LỜI LÊN SERVER (không chặn UI) ============ */
function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
function setupWatermark(name, email) {
  const label = escapeHtml(`${name} • ${email}`);
  $("watermark").innerHTML = Array(120).fill(`<span>${label}</span>`).join("");
}

function syncAnswer(i) {
  const q = state.QUESTIONS[i];
  sb.rpc("submit_answer", {
    p_attempt_id: state.attemptId,
    p_question_id: q.id,
    p_choice_index: state.answers[i],
    p_marked: state.marked[i]
  }).then(({ error }) => { if (error) console.warn("Lỗi lưu câu trả lời:", error.message); });
}

/* ============ 5. RENDER CÂU HỎI ============ */
function renderQuestion() {
  const QUESTIONS = state.QUESTIONS;
  const q = QUESTIONS[state.idx];
  const i = state.idx;
  const hasImage = Boolean(q.image);

  const questionHtml = `
    <div class="qhead">
      <div class="qnum">${i + 1}</div>
      <div class="qbar">
        <button class="mark ${state.marked[i] ? "on" : ""}" id="mark-btn">
          <svg width="16" height="18" viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>
          Mark for Review
        </button>
        <button class="elim ${state.elimMode ? "on" : ""}" id="elim-btn" title="Eliminate answers">ABC</button>
      </div>
    </div>
    <div class="qtext">${q.text}</div>
    <div id="choices">
      ${q.choices.map((c, k) => `
        <button class="choice ${state.answers[i] === k ? "picked" : ""} ${state.crossed[i].has(k) ? "gone" : ""}" data-k="${k}">
          <span class="letter">${LETTERS[k]}</span>
          <span class="ctext">${c}</span>
        </button>`).join("")}
    </div>`;

  if (hasImage) {
    $("stage").className = "stage split";
    $("stage").innerHTML = `
      <div class="pane left"><figure class="pane-inner stimulus">
        <img src="${q.image.src}" alt="${q.image.alt || ""}">
        ${q.image.caption ? `<figcaption>${q.image.caption}</figcaption>` : ""}
      </figure></div>
      <div class="pane right"><div class="pane-inner">${questionHtml}</div></div>`;
  } else {
    $("stage").className = "stage single";
    $("stage").innerHTML = `<div class="pane"><div class="pane-inner">${questionHtml}</div></div>`;
  }

  $("mark-btn").onclick = () => { state.marked[i] = !state.marked[i]; syncAnswer(i); renderQuestion(); };
  $("elim-btn").onclick = () => { state.elimMode = !state.elimMode; renderQuestion(); };
  document.querySelectorAll(".choice").forEach((el) => {
    el.onclick = () => {
      const k = Number(el.dataset.k);
      if (state.elimMode) {
        const set = state.crossed[i];
        set.has(k) ? set.delete(k) : set.add(k);
        if (state.answers[i] === k) { state.answers[i] = null; syncAnswer(i); }
      } else {
        state.answers[i] = k;
        state.crossed[i].delete(k);
        syncAnswer(i);
      }
      renderQuestion();
    };
  });

  $("nav-btn").textContent = `Question ${i + 1} of ${QUESTIONS.length}`;
  $("nav-btn").style.display = "";
  $("back-btn").style.display = "";
  $("next-btn").style.display = "";
  $("back-btn").disabled = i === 0;
  $("next-btn").textContent = i === QUESTIONS.length - 1 ? "Finish" : "Next";
}

function go(n) {
  if (n < 0 || n >= state.QUESTIONS.length) return;
  state.idx = n;
  $("nav-popup").hidden = true;
  renderQuestion();
}

$("back-btn").onclick = () => go(state.idx - 1);
$("next-btn").onclick = () => {
  if (state.idx === state.QUESTIONS.length - 1) {
    renderBigReview();
  } else go(state.idx + 1);
};

/* ============ 6. NAVIGATOR ============ */
const FLAG_SVG = `<svg class="navflag" width="12" height="13" viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>`;
function renderNav() {
  const unanswered = state.answers.filter((a) => a === null).length;

  $("nav-grid").innerHTML = state.QUESTIONS.map((_, k) => `
    <button class="${state.answers[k] !== null ? "done" : ""} ${k === state.idx ? "current" : ""} ${state.marked[k] ? "flag" : ""}" data-k="${k}">${k + 1}${state.marked[k] ? FLAG_SVG : ""}</button>`).join("");
  $("nav-grid").querySelectorAll("button").forEach((b) => (b.onclick = () => go(Number(b.dataset.k))));

  const statusEl = $("nav-status");
  if (unanswered > 0) {
    statusEl.textContent = `Còn ${unanswered} câu chưa hoàn thành.`;
    statusEl.classList.add("warn");
  } else {
    statusEl.textContent = "Bạn đã hoàn thành tất cả câu hỏi.";
    statusEl.classList.remove("warn");
  }
}
$("nav-btn").onclick = () => { renderNav(); $("nav-popup").hidden = !$("nav-popup").hidden; };
$("nav-close").onclick = () => ($("nav-popup").hidden = true);
$("review-btn").onclick = () => {
  $("nav-popup").hidden = true;
  renderBigReview();
};

/* Trang review lớn — cùng logic/dữ liệu với popup overview nhỏ (đã trả lời/đánh dấu/đang ở câu nào),
   nhưng hiển thị full trang, dùng khi bấm Next ở câu cuối hoặc mở "Review overall" giữa bài.
   Click vào một ô câu hỏi sẽ quay lại đúng câu đó. Nút Nộp bài chỉ bật khi đã trả lời hết. */
function renderBigReview() {
  const unanswered = state.answers.filter((a) => a === null).length;

  $("nav-btn").style.display = "none";
  $("back-btn").style.display = "none";
  $("next-btn").style.display = "none";

  $("stage").className = "stage single";
  $("stage").innerHTML = `
    <div class="pane"><div class="pane-inner" style="max-width:56rem">
      <h2 class="bigreview-title">Review overall</h2>
      <p id="bigreview-status" class="nav-status"></p>
      <div id="bigreview-grid" class="nav-grid big"></div>
      <div class="bigreview-actions">
        <button id="bigreview-back" class="btn secondary wide">Quay lại làm bài</button>
        <button id="bigreview-submit" class="btn wide" disabled>Nộp bài</button>
      </div>
    </div></div>`;

  $("bigreview-grid").innerHTML = state.QUESTIONS.map((_, k) => `
    <button class="${state.answers[k] !== null ? "done" : ""} ${state.marked[k] ? "flag" : ""}" data-k="${k}">${k + 1}${state.marked[k] ? FLAG_SVG : ""}</button>`).join("");
  $("bigreview-grid").querySelectorAll("button").forEach((b) => (b.onclick = () => go(Number(b.dataset.k))));

  const statusEl = $("bigreview-status");
  const submitBtn = $("bigreview-submit");
  if (unanswered > 0) {
    statusEl.textContent = `Còn ${unanswered} câu chưa hoàn thành — làm hết tất cả câu hỏi để nộp bài.`;
    statusEl.classList.add("warn");
    submitBtn.disabled = true;
  } else {
    statusEl.textContent = "Bạn đã hoàn thành tất cả câu hỏi, sẵn sàng nộp bài.";
    statusEl.classList.remove("warn");
    submitBtn.disabled = false;
  }
  submitBtn.onclick = () => {
    if (state.answers.some((a) => a === null)) return;
    finish();
  };
  $("bigreview-back").onclick = () => go(state.idx);
}

/* ============ 7. TIMER ============ */
function fmt(s) {
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
let tick;
function startTimer() {
  $("timer").textContent = fmt(state.secondsLeft);
  tick = setInterval(() => {
    if (state.finished) return clearInterval(tick);
    state.secondsLeft--;
    $("timer").textContent = fmt(Math.max(0, state.secondsLeft));
    $("timer").classList.toggle("low", state.secondsLeft <= 300);
    if (state.secondsLeft <= 0) finish();
  }, 1000);
}
$("timer-toggle").onclick = () => {
  const hidden = $("timer").style.visibility === "hidden";
  $("timer").style.visibility = hidden ? "visible" : "hidden";
  $("timer-toggle").textContent = hidden ? "Hide" : "Show";
};

/* ============ 8. SAU KHI NỘP BÀI: chấm điểm → chúc mừng → trang thống kê → xem lại từng câu ============ */

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return div.textContent || div.innerText || "";
}

async function finish() {
  if (state.finished) return; // tránh gọi finish() nhiều lần (vd. hết giờ + bấm Finish cùng lúc)
  state.finished = true;
  clearInterval(tick); // dừng đếm ngay lập tức khi nộp bài, không chờ tick kế tiếp
  exitFullscreenMode(); // nộp bài xong thì không cần theo dõi thoát toàn màn hình nữa

  $("nav-popup").hidden = true;
  $("calc").hidden = true;
  document.querySelector(".topbar").style.display = "none";
  document.querySelector(".footbar").style.display = "none";

  $("stage").className = "stage single";
  $("stage").innerHTML = `<div class="loading">Đang chấm điểm...</div>`;

  const secondsUsed = state.totalSeconds - Math.max(0, state.secondsLeft);
  state.secondsUsed = secondsUsed; // MỚI: lưu lại vào state để trang thống kê dùng được sau này
  const { data, error } = await sb.rpc("finish_attempt", {
    p_attempt_id: state.attemptId,
    p_seconds_used: secondsUsed
  });
  const result = Array.isArray(data) ? data[0] : data;

  if (error) {
    $("stage").innerHTML = `<div class="loading">Không chấm được điểm: ${error.message}</div>`;
    return;
  }

  state.finalScore = result.score;
  state.finalTotal = result.total;

  // Đáp án đúng từng câu chỉ được lấy về SAU KHI đã nộp bài (không lộ trước lúc làm bài)
  const { data: reviewRows, error: reviewErr } = await sb.rpc("get_attempt_review", {
    p_attempt_id: state.attemptId
  });
  if (!reviewErr && Array.isArray(reviewRows)) {
    state.QUESTIONS.forEach((q, i) => {
      const row = reviewRows.find((r) => r.question_id === q.id);
      state.correctIndex[i] = row ? row.correct_choice_index : null;
    });
  } else if (reviewErr) {
    console.warn("Không lấy được đáp án để xem lại:", reviewErr.message);
  }

  showCongrats(secondsUsed);
}

function showCongrats(secondsUsed) {
  $("stage").className = "stage single";
  $("stage").innerHTML = `
    <div class="congrats">
      <div class="congrats-icon">🎉</div>
      <h2>Chúc mừng bạn đã hoàn thành bài thi!</h2>
      <p>Thời gian sử dụng: ${fmt(secondsUsed)}</p>
      <button id="see-result-btn" class="btn wide">Xem kết quả</button>
    </div>`;
  $("see-result-btn").onclick = () => renderStats();
}

function computeStats() {
  const total = state.QUESTIONS.length;
  let correct = 0;
  const byUnit = {};
  state.QUESTIONS.forEach((q, i) => {
    const unit = q.unit || "Chưa phân loại";
    if (!byUnit[unit]) byUnit[unit] = { unit, correct: 0, wrong: 0 };
    const isCorrect = state.correctIndex[i] != null && state.answers[i] === state.correctIndex[i];
    if (isCorrect) { byUnit[unit].correct++; correct++; }
    else byUnit[unit].wrong++;
  });
  const units = Object.values(byUnit);
  const topCorrect = [...units].filter((u) => u.correct > 0).sort((a, b) => b.correct - a.correct).slice(0, 3);
  const topWrong = [...units].filter((u) => u.wrong > 0).sort((a, b) => b.wrong - a.wrong).slice(0, 3);
  // Nếu đã lấy được đáp án đúng về (get_attempt_review) thì dùng số đếm này cho khớp với danh sách bên dưới;
  // chỉ dùng điểm từ server khi chưa có đáp án nào để đối chiếu.
  const haveKey = state.correctIndex.some((c) => c != null);
  const correctCount = haveKey ? correct : (state.finalScore ?? 0);
  // MỚI: thời gian đã làm bài, lấy từ state (đã lưu lại trong finish()), format mm:ss + số phút làm tròn
  const secondsUsed = state.secondsUsed;
  const minutesUsed = secondsUsed != null ? Math.round(secondsUsed / 60) : null;
  return {
    total,
    correct: correctCount,
    percent: total ? Math.round((correctCount / total) * 100) : 0,
    topCorrect,
    topWrong,
    secondsUsed,
    minutesUsed
  };
}

function renderStats() {
  const s = computeStats();

  $("stage").className = "stage single";
  $("stage").innerHTML = `
    <div class="stats-page">
      <div class="stats-card">
        <div class="stats-summary">
          <div class="stat-box">
            <div class="stat-value">${s.correct} / ${s.total}</div>
            <div class="stat-label">Số câu đúng</div>
          </div>
          <div class="stat-box">
            <div class="stat-value">${s.percent}%</div>
            <div class="stat-label">Tỉ lệ đúng</div>
          </div>
          <div class="stat-box">
            <div class="stat-value">${s.secondsUsed != null ? fmt(s.secondsUsed) : "—"}</div>
            <div class="stat-label">${s.minutesUsed != null ? `Thời gian làm bài (${s.minutesUsed} phút)` : "Thời gian làm bài"}</div>
          </div>
        </div>
        <div class="stats-units">
          <div class="stats-unit-col">
            <h4>Top 3 unit làm đúng nhiều nhất</h4>
            <ul>${s.topCorrect.length ? s.topCorrect.map((u) => `<li><span class="dot ok"></span>${u.unit} <b>${u.correct}</b> câu đúng</li>`).join("") : "<li>Chưa có dữ liệu</li>"}</ul>
          </div>
          <div class="stats-unit-col">
            <h4>Top 3 unit làm sai nhiều nhất</h4>
            <ul>${s.topWrong.length ? s.topWrong.map((u) => `<li><span class="dot bad"></span>${u.unit} <b>${u.wrong}</b> câu sai</li>`).join("") : "<li>Chưa có dữ liệu</li>"}</ul>
          </div>
        </div>
      </div>

      <div class="stats-list">
        ${state.QUESTIONS.map((q, i) => {
          const chosen = state.answers[i];
          const correctIdx = state.correctIndex[i];
          const isCorrect = correctIdx != null && chosen === correctIdx;
          const rawText = stripHtml(q.text);
          const snippet = rawText.slice(0, 20) + (rawText.length > 20 ? "…" : "");
          return `
          <div class="stats-row ${isCorrect ? "ok" : "bad"}">
            <span class="srow-num">${i + 1}</span>
            <span class="srow-text">${snippet}</span>
            <span class="srow-correct">Đúng: ${correctIdx != null ? LETTERS[correctIdx] : "?"}</span>
            <span class="srow-chosen">Đã chọn: ${chosen != null ? LETTERS[chosen] : "—"}</span>
            <button class="srow-review" data-k="${i}">Xem lại</button>
          </div>`;
        }).join("")}
      </div>
    </div>`;

  document.querySelectorAll(".srow-review").forEach((b) => {
    b.onclick = () => renderReview(Number(b.dataset.k));
  });
}

/* Xem lại 1 câu — dùng lại đúng bố cục màn hình làm bài (during-exam), nhưng
   khoá tương tác và tô XANH đáp án đúng / ĐỎ đáp án học sinh đã chọn (nếu sai) */
function renderReview(i) {
  const q = state.QUESTIONS[i];
  const chosen = state.answers[i];
  const correctIdx = state.correctIndex[i];
  const hasImage = Boolean(q.image);

  const questionHtml = `
    <div class="qhead">
      <div class="qnum">${i + 1}</div>
      <div class="qbar">
        <button class="mark" id="review-back-btn">← Quay lại tổng kết</button>
      </div>
    </div>
    <div class="qtext">${q.text}</div>
    <div id="choices">
      ${q.choices.map((c, k) => {
        let cls = "review";
        if (k === correctIdx) cls += " review-correct";
        else if (k === chosen) cls += " review-wrong";
        return `
        <button class="choice ${cls}" disabled>
          <span class="letter">${LETTERS[k]}</span>
          <span class="ctext">${c}</span>
        </button>`;
      }).join("")}
    </div>`;

  if (hasImage) {
    $("stage").className = "stage split";
    $("stage").innerHTML = `
      <div class="pane left"><figure class="pane-inner stimulus">
        <img src="${q.image.src}" alt="${q.image.alt || ""}">
        ${q.image.caption ? `<figcaption>${q.image.caption}</figcaption>` : ""}
      </figure></div>
      <div class="pane right"><div class="pane-inner">${questionHtml}</div></div>`;
  } else {
    $("stage").className = "stage single";
    $("stage").innerHTML = `<div class="pane"><div class="pane-inner">${questionHtml}</div></div>`;
  }

  $("review-back-btn").onclick = () => renderStats();
}

/* ============ 9. MÁY TÍNH DESMOS (FOUR-FUNCTION) — phóng to/thu nhỏ được ============ */
let desmosCalc = null;
function ensureDesmosCalculator() {
  if (desmosCalc) return; // đã khởi tạo rồi thì thôi
  const elt = $("calc-desmos");
  if (elt && window.Desmos) {
    desmosCalc = Desmos.FourFunctionCalculator(elt);
  }
}
$("calc-btn").onclick = () => {
  $("calc").hidden = !$("calc").hidden;
  if (!$("calc").hidden) ensureDesmosCalculator();
};
$("calc-close").onclick = () => ($("calc").hidden = true);

// Theo dõi mọi thay đổi kích thước khung máy tính (kéo góc dưới-phải để resize tự do)
// và báo cho Desmos vẽ lại đúng kích thước mới
if (window.ResizeObserver) {
  const calcResizeObserver = new ResizeObserver(() => {
    if (desmosCalc) desmosCalc.resize();
  });
  calcResizeObserver.observe($("calc"));
}

(function () {
  const box = $("calc"), head = $("calc-head");
  let dx = 0, dy = 0, drag = false, minTop = 90;
  head.onmousedown = (e) => {
    // Bỏ qua nếu bấm vào nút (đóng / phóng to) trong thanh tiêu đề
    if (e.target.closest("button")) return;
    drag = true;
    const r = box.getBoundingClientRect();
    dx = e.clientX - r.left; dy = e.clientY - r.top;
    head.style.cursor = "grabbing";
    // Giới hạn: mép trên của máy tính không được kéo lên cao hơn mép dưới của bộ đếm thời gian
    const timerBox = document.querySelector(".timer-box");
    minTop = (timerBox ? timerBox.getBoundingClientRect().bottom : 84) + 10;
  };
  document.addEventListener("mousemove", (e) => {
    if (!drag) return;
    let top = e.clientY - dy;
    if (top < minTop) top = minTop;
    box.style.left = e.clientX - dx + "px";
    box.style.top = top + "px";
    box.style.right = "auto";
  });
  document.addEventListener("mouseup", () => { drag = false; head.style.cursor = "grab"; });
})();

// Resize thủ công bằng tay cầm ở góc dưới-phải (không dùng CSS "resize" gốc vì
// widget Desmos bên trong nuốt mất thao tác kéo ở đúng góc đó)
(function () {
  const box = $("calc"), handle = $("calc-resize-handle");
  let resizing = false, startX = 0, startY = 0, startW = 0, startH = 0;

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation(); // đừng để việc này bị hiểu nhầm thành kéo di chuyển khung
    resizing = true;
    const r = box.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    startW = r.width; startH = r.height;
  });

  document.addEventListener("mousemove", (e) => {
    if (!resizing) return;
    const minW = 260, minH = 320;
    const maxW = window.innerWidth * 0.92;
    const maxH = window.innerHeight * 0.85;
    let w = startW + (e.clientX - startX);
    let h = startH + (e.clientY - startY);
    w = Math.min(Math.max(w, minW), maxW);
    h = Math.min(Math.max(h, minH), maxH);
    box.style.width = w + "px";
    box.style.height = h + "px";
  });

  document.addEventListener("mouseup", () => { resizing = false; });
})();

/* ============ 10. BẮT BUỘC TOÀN MÀN HÌNH TRONG LÚC THI ============
 * Vào toàn màn hình ngay khi bắt đầu làm bài. Nếu học sinh thoát ra:
 * - Lần 1, 2: hiện cảnh báo, phải bấm nút để quay lại toàn màn hình mới làm tiếp được.
 * - Lần 3: khoá bài, buộc làm lại từ đầu (reload trang, phải đăng nhập lại từ cổng vào).
 */
const MAX_FS_EXITS = 3;
let fsExitCount = 0;
let fsOverlayShowing = false; // tránh đếm trùng khi overlay đang hiện (do exitFullscreenMode() của chính mình gây ra)

function requestFullscreenMode() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (req) req.call(el).catch(() => {});
}
function exitFullscreenMode() {
  const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  if (isFullscreenActive() && exit) exit.call(document).catch(() => {});
}
function isFullscreenActive() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
}
function handleFullscreenChange() {
  if (!state.attemptId || state.finished) return; // chỉ theo dõi trong lúc đang thi
  if (isFullscreenActive() || fsOverlayShowing) return; // vừa vào lại toàn màn hình, hoặc overlay đang xử lý rồi thì bỏ qua

  fsExitCount++;
  fsOverlayShowing = true;

  if (fsExitCount >= MAX_FS_EXITS) {
    $("fs-lockout").hidden = false;
  } else {
    $("fs-warning-text").textContent =
      `Bạn đã thoát toàn màn hình lần ${fsExitCount}/${MAX_FS_EXITS}. Thoát quá ${MAX_FS_EXITS} lần, bài làm sẽ bị huỷ và phải làm lại từ đầu.`;
    $("fs-warning").hidden = false;
  }
}
document.addEventListener("fullscreenchange", handleFullscreenChange);
document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
document.addEventListener("msfullscreenchange", handleFullscreenChange);

$("fs-resume-btn").onclick = () => {
  $("fs-warning").hidden = true;
  fsOverlayShowing = false;
  requestFullscreenMode();
};
$("fs-restart-btn").onclick = () => location.reload();