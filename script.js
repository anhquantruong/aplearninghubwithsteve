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
  crossed: [],             // các đáp án bị gạch, mỗi câu 1 Set
  elimMode: false,         // bật/tắt hiện nút tròn gạch đáp án (nút ABC)
  secondsLeft: 0,
  finished: false,
  correctIndex: [],        // đáp án đúng từng câu — chỉ có SAU khi nộp bài (get_attempt_review)
  finalScore: null,
  finalTotal: null,
  secondsUsed: null,       // thời gian đã làm bài, dùng ở trang thống kê

  view: "gate",            // màn hình hiện tại: gate | question | review | done
  highlights: [],          // MỚI: mỗi câu 1 mảng [{id, target, start, end, color, note}]
  hlMode: false,           // MỚI: đang bật Highlights & Notes
  activeHlId: null,        // MỚI: highlight vừa tạo note, để tự focus vào ô note
  lastColor: "yellow"
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
  console.log("DEBUG state.examId =", state.examId);
  const { data: questions, error: qErr } = await sb
    .from("questions_public")
    .select("*")
    .eq("exam_id", state.examId)
    .order("question_number");
  if (qErr) {
    console.error("Lỗi tải câu hỏi:", qErr);
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
  state.highlights = state.QUESTIONS.map(() => []);
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

/* ============ 5A. BỐ CỤC CHIA ĐÔI (ảnh | câu hỏi) CÓ THANH KÉO ============ */
let splitPct = 50; // % chiều rộng cột ảnh, nhớ lại khi chuyển câu

function mountSplit(leftHtml, rightHtml) {
  $("stage").className = "stage split";
  $("stage").innerHTML = `
    <div class="pane left" style="width:${splitPct}%">${leftHtml}</div>
    <div class="divider" id="split-divider" title="Kéo để đổi kích thước"></div>
    <div class="pane right">${rightHtml}</div>`;

  const stage = $("stage");
  const left = stage.querySelector(".pane.left");
  const divider = $("split-divider");

  divider.onpointerdown = (e) => {
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const r = stage.getBoundingClientRect();
      splitPct = Math.min(75, Math.max(25, ((ev.clientX - r.left) / r.width) * 100));
      left.style.width = splitPct + "%";
    };
    const up = () => {
      divider.removeEventListener("pointermove", move);
      divider.removeEventListener("pointerup", up);
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
  };
}

let popCtx = null; 

function newHlId() {
  return "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function findHl(i, id) {
  return (state.highlights[i] || []).find((h) => h.id === id);
}
function removeHighlight(i, id) {
  state.highlights[i] = (state.highlights[i] || []).filter((h) => h.id !== id);
}

// Thêm highlight mới; phần nào đè lên highlight cũ thì cắt highlight cũ lại
function addHighlight(i, h) {
  const out = [];
  (state.highlights[i] || []).forEach((e) => {
    if (e.target !== h.target || e.end <= h.start || e.start >= h.end) { out.push(e); return; }
    const hasLeft = e.start < h.start;
    const hasRight = e.end > h.end;
    if (hasLeft) out.push({ ...e, end: h.start });
    if (hasRight) out.push({ ...e, id: newHlId(), start: h.end, note: hasLeft ? null : e.note });
  });
  const id = newHlId();
  out.push({ ...h, id });
  state.highlights[i] = out;
  state.lastColor = h.color;
  return id;
}

// Đếm số ký tự từ đầu khối chữ tới một điểm trong DOM
function offsetIn(container, node, off) {
  const r = document.createRange();
  r.selectNodeContents(container);
  r.setEnd(node, off);
  return r.toString().length;
}

// Bọc đoạn chữ [start, end) trong khối bằng thẻ <mark> (xử lý được cả khi chữ nằm trong nhiều thẻ con)
function wrapRange(container, start, end, h) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let pos = 0;
  nodes.forEach((node) => {
    const nStart = pos;
    const nEnd = pos + node.nodeValue.length;
    pos = nEnd;
    const s = Math.max(start, nStart);
    const e = Math.min(end, nEnd);
    if (s >= e) return;
    let target = node;
    if (s > nStart) target = target.splitText(s - nStart);
    if (e < nEnd) target.splitText(e - s);
    const mark = document.createElement("mark");
    mark.className = `hl hl-${h.color}${h.note != null ? " has-note" : ""}`;
    mark.dataset.id = h.id;
    target.parentNode.replaceChild(mark, target);
    mark.appendChild(target);
  });
}

function applyHighlightsToStage() {
  const list = (state.highlights[state.idx] || []).slice().sort((a, b) => a.start - b.start);
  document.querySelectorAll("#stage [data-hl]").forEach((container) => {
    list.filter((h) => h.target === container.dataset.hl).forEach((h) => wrapRange(container, h.start, h.end, h));
  });
}

/* ----- Khung nhỏ chọn màu / Note / Remove ----- */
function ensureHlPopover() {
  let pop = $("hl-pop");
  if (pop) return pop;
  pop = document.createElement("div");
  pop.id = "hl-pop";
  pop.className = "hl-pop";
  pop.hidden = true;
  pop.innerHTML = `
    <button class="hl-swatch hl-yellow" data-color="yellow" title="Yellow"></button>
    <button class="hl-swatch hl-green" data-color="green" title="Green"></button>
    <button class="hl-swatch hl-pink" data-color="pink" title="Pink"></button>
    <span class="hl-sep"></span>
    <button class="hl-act" data-act="note">Note</button>
    <button class="hl-act hl-remove" data-act="remove" hidden>Remove</button>`;
  pop.onmousedown = (e) => e.preventDefault(); // giữ nguyên vùng đang bôi
  pop.onclick = onPopClick;
  document.body.appendChild(pop);
  return pop;
}

function showHlPopover(rect, isExisting) {
  const pop = ensureHlPopover();
  pop.querySelector(".hl-remove").hidden = !isExisting;
  pop.hidden = false;
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let top = rect.top - h - 8;
  if (top < 8) top = rect.bottom + 8;
  let left = rect.left + rect.width / 2 - w / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  pop.style.top = top + "px";
  pop.style.left = left + "px";
}

function hideHlPopover() {
  const pop = $("hl-pop");
  if (pop) pop.hidden = true;
  popCtx = null;
}

function onPopClick(e) {
  const ctx = popCtx;
  if (!ctx) return;
  const i = state.idx;
  const colorBtn = e.target.closest("[data-color]");
  const actBtn = e.target.closest("[data-act]");

  if (colorBtn) {
    const color = colorBtn.dataset.color;
    if (ctx.existingId) {
      const h = findHl(i, ctx.existingId);
      if (h) { h.color = color; state.lastColor = color; }
    } else if (ctx.pending) {
      addHighlight(i, { ...ctx.pending, color, note: null });
    }
  } else if (actBtn && actBtn.dataset.act === "note") {
    let id = ctx.existingId;
    if (id) {
      const h = findHl(i, id);
      if (h && h.note == null) h.note = "";
    } else if (ctx.pending) {
      id = addHighlight(i, { ...ctx.pending, color: state.lastColor, note: "" });
    }
    state.activeHlId = id;
  } else if (actBtn && actBtn.dataset.act === "remove") {
    removeHighlight(i, ctx.existingId);
  } else {
    return;
  }

  hideHlPopover();
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();
  renderQuestion();
}

// Sau khi thả chuột: nếu đang bôi chữ trong đề → hiện khung nhỏ; nếu bấm vào chữ đã highlight → hiện khung sửa
function onPointerUp(e) {
  if (!state.hlMode || state.view !== "question" || state.finished) return;
  if (e.target.closest && e.target.closest("#hl-pop, .notes-panel")) return;

  setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      const mark = e.target.closest && e.target.closest("mark.hl");
      if (mark) {
        popCtx = { existingId: mark.dataset.id };
        showHlPopover(mark.getBoundingClientRect(), true);
      }
      return;
    }
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el = node.nodeType === 1 ? node : node.parentElement;
    const container = el && el.closest("[data-hl]");
    if (!container) { hideHlPopover(); return; }

    const start = offsetIn(container, range.startContainer, range.startOffset);
    const end = offsetIn(container, range.endContainer, range.endOffset);
    if (end <= start) return;

    popCtx = { pending: { target: container.dataset.hl, start, end } };
    showHlPopover(range.getBoundingClientRect(), false);
  }, 20);
}
document.addEventListener("pointerup", onPointerUp);
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest || !e.target.closest("#hl-pop")) hideHlPopover();
});

// Vẫn chặn copy chữ đề (chống chép đề), trừ khi đang gõ trong ô note
document.addEventListener("copy", (e) => {
  if (document.activeElement && document.activeElement.tagName === "TEXTAREA") return;
  e.preventDefault();
});

function flashMarks(id) {
  document.querySelectorAll(`#stage mark.hl[data-id="${id}"]`).forEach((m) => {
    m.classList.add("hl-flash");
    setTimeout(() => m.classList.remove("hl-flash"), 1200);
  });
}

/* ----- Cột Notes bên phải ----- */
function renderNotesPanel() {
  const stage = $("stage");
  stage.classList.remove("with-notes");
  if (!state.hlMode) return;

  const i = state.idx;
  const list = (state.highlights[i] || [])
    .filter((h) => h.note != null)
    .sort((a, b) => a.target.localeCompare(b.target) || a.start - b.start);

  const cards = list.map((h) => {
    const c = stage.querySelector(`[data-hl="${h.target}"]`);
    let snip = c ? c.textContent.slice(h.start, h.end).trim() : "";
    if (snip.length > 120) snip = snip.slice(0, 120) + "…";
    return `
      <div class="note-card ${state.activeHlId === h.id ? "active" : ""}" data-id="${h.id}">
        <button class="note-del" data-id="${h.id}" title="Delete highlight and note">×</button>
        <div class="note-quote-wrap"><span class="note-quote hl-${h.color}">${escapeHtml(snip)}</span></div>
        <textarea class="note-text" data-id="${h.id}" placeholder="Type your note here...">${escapeHtml(h.note)}</textarea>
      </div>`;
  }).join("");

  const panel = document.createElement("aside");
  panel.className = "notes-panel";
  panel.innerHTML = `
    <div class="notes-head">Notes</div>
    ${cards || `<p class="notes-empty">Select text in the question, then pick a color to highlight it, or choose “Note” to add a note.</p>`}`;
  stage.appendChild(panel);
  stage.classList.add("with-notes");

  panel.querySelectorAll(".note-text").forEach((ta) => {
    ta.oninput = () => { const h = findHl(state.idx, ta.dataset.id); if (h) h.note = ta.value; };
    ta.onfocus = () => flashMarks(ta.dataset.id);
  });
  panel.querySelectorAll(".note-del").forEach((b) => {
    b.onclick = () => { removeHighlight(state.idx, b.dataset.id); renderQuestion(); };
  });

  if (state.activeHlId) {
    const ta = panel.querySelector(`.note-text[data-id="${state.activeHlId}"]`);
    if (ta) ta.focus();
    state.activeHlId = null;
  }
}

/* ----- Nút "Highlights & Notes" trên thanh trên cùng (tự thêm bằng JS, không cần sửa HTML) ----- */
(function injectHlButton() {
  const tools = document.querySelector(".tools");
  if (!tools || $("hl-btn")) return;
  tools.insertAdjacentHTML("afterbegin", `
    <button id="hl-btn" class="tool" title="Highlights &amp; Notes">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
      <span>Highlights &amp; Notes</span>
    </button>`);
  $("hl-btn").onclick = () => {
    state.hlMode = !state.hlMode;
    $("hl-btn").classList.toggle("on", state.hlMode);
    hideHlPopover();
    if (state.view === "question" && !state.finished) renderQuestion();
  };
})();

/* ============ 5. RENDER CÂU HỎI ============ */
function renderQuestion() {
  state.view = "question";
  hideHlPopover();
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
    <div class="qtext" data-hl="q">${q.text}</div>
    <div id="choices">
      ${q.choices.map((c, k) => {
        const crossed = state.crossed[i].has(k);
        return `
        <div class="choice-row">
          <button class="choice ${state.answers[i] === k ? "picked" : ""} ${crossed ? "gone" : ""}" data-k="${k}">
            <span class="letter">${LETTERS[k]}</span>
            <span class="ctext">${c}</span>
          </button>
          ${state.elimMode
            ? (crossed
                ? `<button class="xbtn undo" data-x="${k}" title="Undo">Undo</button>`
                : `<button class="xbtn" data-x="${k}" title="Cross out choice ${LETTERS[k]}"><span class="xl">${LETTERS[k]}</span></button>`)
            : ""}
        </div>`;
      }).join("")}
    </div>`;

  if (hasImage) {
    mountSplit(
      `<figure class="pane-inner stimulus">
        <img src="${q.image.src}" alt="${q.image.alt || ""}">
        ${q.image.caption ? `<figcaption data-hl="cap">${q.image.caption}</figcaption>` : ""}
      </figure>`,
      `<div class="pane-inner">${questionHtml}</div>`
    );
  } else {
    $("stage").className = "stage single";
    $("stage").innerHTML = `<div class="pane"><div class="pane-inner">${questionHtml}</div></div>`;
  }

  $("mark-btn").onclick = () => { state.marked[i] = !state.marked[i]; syncAnswer(i); renderQuestion(); };
  $("elim-btn").onclick = () => { state.elimMode = !state.elimMode; renderQuestion(); };

  // Bấm vào đáp án = chọn đáp án đó (nếu đang bị gạch thì tự bỏ gạch)
  document.querySelectorAll(".choice").forEach((el) => {
    el.onclick = () => {
      const k = Number(el.dataset.k);
      state.crossed[i].delete(k);
      state.answers[i] = k;
      syncAnswer(i);
      renderQuestion();
    };
  });
  // Bấm nút tròn bên cạnh = gạch / bỏ gạch đáp án
  document.querySelectorAll(".xbtn").forEach((el) => {
    el.onclick = () => {
      const k = Number(el.dataset.x);
      const set = state.crossed[i];
      if (set.has(k)) {
        set.delete(k);
      } else {
        set.add(k);
        if (state.answers[i] === k) { state.answers[i] = null; syncAnswer(i); }
      }
      renderQuestion();
    };
  });

  applyHighlightsToStage();
  renderNotesPanel();
  $("stage").classList.toggle("hl-on", state.hlMode);

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
const FLAG_SVG = `<svg class="navflag" width="20" height="21" viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>`;
function renderNav() {
  const unanswered = state.answers.filter((a) => a === null).length;

  $("nav-grid").innerHTML = state.QUESTIONS.map((_, k) => `
    <button class="${state.answers[k] !== null ? "done" : ""} ${k === state.idx ? "current" : ""} ${state.marked[k] ? "flag" : ""}" data-k="${k}">${k + 1}${state.marked[k] ? FLAG_SVG : ""}</button>`).join("");
  $("nav-grid").querySelectorAll("button").forEach((b) => (b.onclick = () => go(Number(b.dataset.k))));

  const statusEl = $("nav-status");
  if (unanswered > 0) {
    statusEl.textContent = `There are ${unanswered} unfinished questions`;
    statusEl.classList.add("warn");
  } else {
    statusEl.textContent = "Congratulations! You have finished your exam!";
    statusEl.classList.remove("warn");
  }
}
$("nav-btn").onclick = () => { renderNav(); $("nav-popup").hidden = !$("nav-popup").hidden; };
$("nav-close").onclick = () => ($("nav-popup").hidden = true);
$("review-btn").onclick = () => {
  $("nav-popup").hidden = true;
  renderBigReview();
};

function renderBigReview() {
  state.view = "review";
  hideHlPopover();
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
    statusEl.textContent = `There are ${unanswered} questions left — finish them to submit!`;
    statusEl.classList.add("warn");
    submitBtn.disabled = true;
  } else {
    statusEl.textContent = "You have finished all of the questions, ready to submit!";
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
  state.view = "done";
  hideHlPopover();
  clearInterval(tick); // dừng đếm ngay lập tức khi nộp bài, không chờ tick kế tiếp
  exitFullscreenMode(); // nộp bài xong thì không cần theo dõi thoát toàn màn hình nữa

  $("nav-popup").hidden = true;
  $("calc").hidden = true;
  document.querySelector(".topbar").style.display = "none";
  document.querySelector(".footbar").style.display = "none";

  $("stage").className = "stage single";
  $("stage").innerHTML = `<div class="loading">Đang chấm điểm...</div>`;

  const secondsUsed = state.totalSeconds - Math.max(0, state.secondsLeft);
  state.secondsUsed = secondsUsed;
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
        <div class="choice-row">
          <button class="choice ${cls}" disabled>
            <span class="letter">${LETTERS[k]}</span>
            <span class="ctext">${c}</span>
          </button>
        </div>`;
      }).join("")}
    </div>`;

  if (hasImage) {
    mountSplit(
      `<figure class="pane-inner stimulus">
        <img src="${q.image.src}" alt="${q.image.alt || ""}">
        ${q.image.caption ? `<figcaption>${q.image.caption}</figcaption>` : ""}
      </figure>`,
      `<div class="pane-inner">${questionHtml}</div>`
    );
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