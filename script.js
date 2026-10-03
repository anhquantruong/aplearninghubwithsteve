const SUPABASE_URL = "https://bltecnjxyiqpdeqrkdlw.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_mYdJq0amHmhARR2ZydimZQ_kwQHUdE5";

const sb = supabase.createClient(SUPABASE_URL, PUBLISHABLE_KEY);

const $ = (id) => document.getElementById(id);
const LETTERS = ["A", "B", "C", "D", "E", "F"];

/* Tên hiển thị của từng loại máy tính (cấu hình ở module trong trang admin) */
const CALC_LABEL = {
  none: "No calculator",
  four: "Four-function calculator",
  scientific: "Scientific calculator",
  graphing: "Graphing calculator"
};

/* CSS nhỏ cho phần module (không cần sửa file css) */
(function injectModuleStyles() {
  const s = document.createElement("style");
  s.textContent = `
    .module-tag{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#3b4a8f;background:#eef1fc;border:1px solid #d6dcf7;border-radius:999px;padding:3px 10px;margin:0 0 12px}
    .module-tag.nocalc{background:#fdf2f2;border-color:#f3cccc;color:#8a1f1f}
    .nav-mod-title{grid-column:1/-1;flex:0 0 100%;width:100%;font-size:12px;font-weight:700;color:#555;margin:8px 0 2px;text-align:left}
    .mod-breakdown{margin:16px 0}
    .mod-breakdown table{width:100%;border-collapse:collapse;font-size:14px;background:#fff;border:1px solid #d1d5db;border-radius:8px;overflow:hidden}
    .mod-breakdown th,.mod-breakdown td{padding:8px 12px;text-align:left;border-bottom:1px solid #eee}
    .mod-breakdown th{background:#f4f5f7;font-size:12px;text-transform:uppercase;color:#666}
  `;
  document.head.appendChild(s);
})();

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

/* ============ 0B. CHẶN ĐIỆN THOẠI: chỉ cho iPad / laptop / desktop ============ */
function isPhoneDevice() {
  const ua = navigator.userAgent || "";
  const isIpad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (isIpad) return false;

  const isAndroidPhone = /Android/.test(ua) && /Mobile/.test(ua);
  const isOtherMobile = /iPhone|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile/.test(ua);
  if (isAndroidPhone || isOtherMobile) return true;

  const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 500;
  return smallScreen && /Android/.test(ua);
}

function blockPhone() {
  $("gate-screen").hidden = true;
  $("device-block").hidden = false;
}
if (isPhoneDevice()) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", blockPhone);
  } else {
    blockPhone();
  }
}

/* ============ 1. TRẠNG THÁI ============ */
const state = {
  attemptId: null,
  examId: null,
  totalSeconds: 70 * 60,
  modules: [],             // [{id, title, calculator}] — chỉ gồm module có câu hỏi trắc nghiệm
  QUESTIONS: [],           // đã xếp theo module; mỗi câu có q.mod = chỉ số module trong state.modules
  idx: 0,
  answers: [],
  marked: [],
  crossed: [],
  elimMode: false,
  secondsLeft: 0,
  timerHidden: false,
  finished: false,
  correctIndex: [],
  finalScore: null,
  finalTotal: null,
  secondsUsed: null,

  view: "gate",            // gate | question | review | done
  highlights: [],
  hlMode: false,
  activeHlId: null,
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

  if (isPhoneDevice()) {
    blockPhone();
    return;
  }
  const email = $("gate-email").value.trim();
  const password = $("gate-password").value;
  if (!email || !password) return;

  requestFullscreenMode(); // phải gọi đồng bộ, trước mọi await

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
  if (result.already_finished) {
    await showSavedResult(result, email);
    return;
  }
  state.totalSeconds = result.total_seconds || 4200;
  state.secondsLeft = state.totalSeconds;

  $("gate-screen").hidden = true;
  $("app-root").hidden = false;
  $("exam-subtitle").textContent = result.title;
  document.querySelector(".footbar .brand").textContent = result.full_name;
  setupWatermark(result.full_name, email);

  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  const ok = await loadQuestions();
  if (!ok) return;

  startTimer();
  renderQuestion();

  requestAnimationFrame(() => {
    window.scrollTo(0, 0);
    $("app-root").scrollIntoView({ block: "start" });
  });
};

/* ============ 3. TẢI CÂU HỎI + MODULE TỪ SUPABASE ============ */
async function showSavedResult(result, email) {
  state.finished = true;
  state.view = "done";
  state.secondsUsed = result.seconds_used;
  exitFullscreenMode();
  setTimeout(exitFullscreenMode, 300);

  $("gate-screen").hidden = true;
  $("app-root").hidden = false;
  $("exam-subtitle").textContent = result.title;
  document.querySelector(".footbar .brand").textContent = result.full_name;
  setupWatermark(result.full_name, email);
  document.querySelector(".topbar").style.display = "none";
  document.querySelector(".footbar").style.display = "none";
  $("calc").hidden = true;

  if (!(await loadQuestions())) return;

  const [ans, rev] = await Promise.all([
    sb.rpc("get_attempt_answers", { p_attempt_id: state.attemptId }),
    sb.rpc("get_attempt_review", { p_attempt_id: state.attemptId })
  ]);
  (ans.data || []).forEach((r) => {
    const i = state.QUESTIONS.findIndex((q) => q.id === r.question_id);
    if (i >= 0) state.answers[i] = r.choice_index;
  });
  (rev.data || []).forEach((r) => {
    const i = state.QUESTIONS.findIndex((q) => q.id === r.question_id);
    if (i >= 0) state.correctIndex[i] = r.correct_choice_index;
  });
  state.finalScore = result.score;
  state.finalTotal = result.total;
  renderStats();
}

async function loadQuestions() {
  const { data: questions, error: qErr } = await sb
    .from("questions_public")
    .select("*")
    .eq("exam_id", state.examId)
    .order("question_number");
  if (qErr) {
    console.error("Lỗi tải câu hỏi:", qErr);
    $("stage").innerHTML = `<div class="loading">Lỗi tải câu hỏi: ${escapeHtml(qErr.message)}</div>`;
    return false;
  }
  if (!questions || !questions.length) {
    $("stage").innerHTML = `<div class="loading">Đề này chưa có câu hỏi nào.</div>`;
    return false;
  }

  const { data: choices, error: cErr } = await sb
    .from("choices_public")
    .select("*")
    .in("question_id", questions.map((q) => q.id))
    .order("choice_index");
  if (cErr) {
    $("stage").innerHTML = `<div class="loading">Lỗi tải đáp án: ${escapeHtml(cErr.message)}</div>`;
    return false;
  }

  // Cấu trúc module (nếu chưa chạy migration thì dùng 1 module mặc định như bản cũ)
  let mods = [];
  const { data: mdata, error: mErr } = await sb.rpc("get_exam_modules", { p_exam_id: state.examId });
  if (mErr) console.warn("Không lấy được module, dùng cấu trúc mặc định:", mErr.message);
  else if (Array.isArray(mdata)) mods = mdata;

  const byId = new Map(questions.map((q) => [q.id, q]));
  const used = new Set();
  const ordered = [];
  state.modules = [];

  mods.forEach((m) => {
    const qs = (m.question_ids || []).map((id) => byId.get(id)).filter(Boolean);
    if (!qs.length) return; // module FRQ (giáo viên chấm tay) không có câu trên web
    const mi = state.modules.push({
      id: m.id,
      title: m.title || "",
      calculator: m.calculator || "none",
      directions_html: m.directions_html || ""   // THÊM dòng này
    }) - 1;
    qs.forEach((q) => { used.add(q.id); ordered.push({ q, mi }); });
  });
  const rest = questions.filter((q) => !used.has(q.id));
  if (rest.length) {
    const mi = state.modules.push({ id: null, title: "", calculator: "four" }) - 1;
    rest.forEach((q) => ordered.push({ q, mi }));
  }

  state.QUESTIONS = ordered.map(({ q, mi }) => ({
    id: q.id,
    mod: mi,
    text: q.text,
    unit: q.unit || q.topic || null,
    image: q.image_url ? { src: q.image_url, alt: q.image_alt, caption: q.image_caption } : null,
    choices: choices.filter((c) => c.question_id === q.id).map((c) => c.text)
  }));
  state.answers = state.QUESTIONS.map(() => null);
  state.marked = state.QUESTIONS.map(() => false);
  state.crossed = state.QUESTIONS.map(() => new Set());
  state.correctIndex = state.QUESTIONS.map(() => null);
  state.highlights = state.QUESTIONS.map(() => []);
  return true;
}

/* ============ 4. TIỆN ÍCH + ĐỒNG BỘ CÂU TRẢ LỜI ============ */
function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
function parseChoiceTable(text) {
  if (!text || !text.includes("/") || !text.includes(":")) return null;
  const parts = text.split("/").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const pairs = [];
  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx === -1) return null;
    const label = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!label || !value) return null;
    pairs.push({ label, value });
  }
  return pairs;
}

function renderChoiceBody(text) {
  const pairs = parseChoiceTable(text);
  if (!pairs) return `<span class="ctext">${text}</span>`;
  return `<table class="ctext-table">
    <thead><tr>${pairs.map((p) => `<th>${escapeHtml(p.label)}</th>`).join("")}</tr></thead>
    <tbody><tr>${pairs.map((p) => `<td>${escapeHtml(p.value)}</td>`).join("")}</tr></tbody>
  </table>`;
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

function moduleTagHtml(mod) {
  if (!mod || !mod.title) return "";
  const none = mod.calculator === "none";
  return `<div class="module-tag ${none ? "nocalc" : ""}">${escapeHtml(mod.title)} · ${CALC_LABEL[mod.calculator] || ""}</div>`;
}

/* ============ 5A. BỐ CỤC CHIA ĐÔI (ảnh | câu hỏi) CÓ THANH KÉO ============ */
let splitPct = 50;

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

/* ============ HIGHLIGHTS & NOTES ============ */
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

function offsetIn(container, node, off) {
  const r = document.createRange();
  r.selectNodeContents(container);
  r.setEnd(node, off);
  return r.toString().length;
}

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
  pop.onmousedown = (e) => e.preventDefault();
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

// Chặn copy chữ đề (chống chép đề), trừ khi đang gõ trong ô note
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

  if (!cards) return;
  const panel = document.createElement("aside");
  panel.className = "notes-panel";
  panel.innerHTML = `<div class="notes-head">Notes</div>${cards}`;
  stage.appendChild(panel);

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

/* ============ MÁY TÍNH THEO MODULE (Desmos) ============ */
let desmosCalc = null;
let desmosKind = null;

// Loại máy tính cho câu hỏi đang xem; ngoài màn hình làm bài thì không có máy tính
function currentCalcKind() {
  if (state.view !== "question" || state.finished) return "none";
  const q = state.QUESTIONS[state.idx];
  const mod = q && state.modules[q.mod];
  return (mod && mod.calculator) || "none";
}

function ensureDesmosCalculator(kind) {
  if (desmosCalc && desmosKind === kind) return;
  if (desmosCalc) { try { desmosCalc.destroy(); } catch (_) {} desmosCalc = null; desmosKind = null; }
  const elt = $("calc-desmos");
  if (!elt || !window.Desmos) return;
  if (kind === "graphing") desmosCalc = Desmos.GraphingCalculator(elt);
  else if (kind === "scientific") desmosCalc = Desmos.ScientificCalculator(elt);
  else desmosCalc = Desmos.FourFunctionCalculator(elt);
  desmosKind = kind;

  // Graphing cần khung to hơn máy tính bỏ túi
  if (kind === "graphing") {
    const box = $("calc");
    if (box.getBoundingClientRect().width < 420) box.style.width = "480px";
    if (box.getBoundingClientRect().height < 480) box.style.height = "520px";
  }
  setTimeout(() => { if (desmosCalc) desmosCalc.resize(); }, 0);
}

// Gọi mỗi lần đổi câu / đổi màn hình: ẩn hiện nút máy tính và đổi loại máy tính cho đúng module
function syncCalculatorUi() {
  const kind = currentCalcKind();
  const btn = $("calc-btn");
  if (btn) {
    btn.style.display = kind === "none" ? "none" : "";
    btn.title = CALC_LABEL[kind] || "";
  }
  if (kind === "none") { $("calc").hidden = true; return; }
  if (!$("calc").hidden) ensureDesmosCalculator(kind);
}

$("calc-btn").onclick = () => {
  const kind = currentCalcKind();
  if (kind === "none") return;
  $("calc").hidden = !$("calc").hidden;
  if (!$("calc").hidden) ensureDesmosCalculator(kind);
};
$("calc-close").onclick = () => ($("calc").hidden = true);

if (window.ResizeObserver) {
  const calcResizeObserver = new ResizeObserver(() => {
    if (desmosCalc) desmosCalc.resize();
  });
  calcResizeObserver.observe($("calc"));
}

/* ============ 5. RENDER CÂU HỎI ============ */
function renderQuestion() {
  state.view = "question";
  hideHlPopover();
  const QUESTIONS = state.QUESTIONS;
  const q = QUESTIONS[state.idx];
  const i = state.idx;
  const hasImage = Boolean(q.image);
  const mod = state.modules[q.mod];
    // Vào module mới lần đầu & module có directions -> chặn hiện câu hỏi, show màn Directions trước
  if (mod && mod.directions_html && !seenDirections.has(q.mod)) {
    seenDirections.add(q.mod);
    showDirectionsScreen(mod, state.idx === 0);
    return;
  }

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
    ${moduleTagHtml(mod)}
    ${directionsToggleHtml(mod)}
    <div class="qtext" data-hl="q">${q.text}</div>
    <div id="choices">
      ${q.choices.map((c, k) => {
        const crossed = state.crossed[i].has(k);
        return `
        <div class="choice-row">
          <button class="choice ${state.answers[i] === k ? "picked" : ""} ${crossed ? "gone" : ""}" data-k="${k}">
            <span class="letter">${LETTERS[k]}</span>
            ${renderChoiceBody(c)}
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
      `<div class="pane-inner stimulus">${imgFrameHtml(q.image)}</div>`,
      `<div class="pane-inner">${questionHtml}</div>`
    );
    wireImgFrame();
  } else {
    $("stage").className = "stage single";
    $("stage").innerHTML = `<div class="pane"><div class="pane-inner">${questionHtml}</div></div>`;
  }

  $("mark-btn").onclick = () => { state.marked[i] = !state.marked[i]; syncAnswer(i); renderQuestion(); };
  $("elim-btn").onclick = () => { state.elimMode = !state.elimMode; renderQuestion(); };

  document.querySelectorAll(".choice").forEach((el) => {
    el.onclick = () => {
      const k = Number(el.dataset.k);
      state.crossed[i].delete(k);
      state.answers[i] = k;
      syncAnswer(i);
      renderQuestion();
    };
  });
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

  syncCalculatorUi();
  const dBtn = $("directions-toggle-btn");
  if (dBtn) {
    dBtn.onclick = () => {
      directionsOpenInline = !directionsOpenInline;
      $("directions-inline").hidden = !directionsOpenInline;
      dBtn.classList.toggle("open", directionsOpenInline);
    };
  }
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

const FLAG_SVG = `<svg class="navflag" width="16" height="17" viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>`;

// Lưới số câu, có tiêu đề cho từng module (chỉ hiện khi đề có tên module)
function moduleGridHtml(classOf) {
  let html = "";
  let last = -1;
  state.QUESTIONS.forEach((q, k) => {
    if (q.mod !== last) {
      last = q.mod;
      const m = state.modules[q.mod];
      if (m && m.title) html += `<div class="nav-mod-title">${escapeHtml(m.title)} · ${CALC_LABEL[m.calculator] || ""}</div>`;
    }
    html += `<button class="${classOf(k)}" data-k="${k}">${k + 1}${state.marked[k] ? FLAG_SVG : ""}</button>`;
  });
  return html;
}

let navActiveTab = "current";

function renderNav() {
  const unanswered = state.answers.filter((a) => a === null).length;

  $("nav-grid").innerHTML = moduleGridHtml((k) =>
    `${state.answers[k] !== null ? "done" : ""} ${k === state.idx ? "current" : ""} ${state.marked[k] ? "flag" : ""}`);
  $("nav-grid").querySelectorAll("button").forEach((b) => (b.onclick = () => go(Number(b.dataset.k))));

  const curBtn = $("nav-grid").querySelector("button.current");
  if (curBtn && !curBtn.querySelector(".nav-pin")) {
    curBtn.style.position = "relative";
    curBtn.insertAdjacentHTML("afterbegin", `<span class="nav-pin"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="9" r="2.5"/><path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z" fill="none" stroke="currentColor" stroke-width="2"/></svg></span>`);
  }

  const statusEl = $("nav-status");
  if (unanswered > 0) {
    statusEl.textContent = `There are ${unanswered} unfinished questions`;
    statusEl.classList.add("warn");
  } else {
    statusEl.textContent = "Congratulations! You have finished your exam!";
    statusEl.classList.remove("warn");
  }
}

document.querySelectorAll(".popup-tab").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".popup-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    navActiveTab = btn.dataset.tab;
    let targetK = null;
    if (navActiveTab === "current") targetK = state.idx;
    else if (navActiveTab === "unanswered") targetK = state.answers.findIndex((a) => a === null);
    else if (navActiveTab === "review") targetK = state.marked.findIndex((m) => m);
    if (targetK != null && targetK >= 0) {
      const el = $("nav-grid").querySelector(`button[data-k="${targetK}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.classList.add("current-pulse");
        setTimeout(() => el.classList.remove("current-pulse"), 1200);
      }
    }
  };
});
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
      <h2 class="bigreview-title">Check Your Work</h2>
      <p class="bigreview-sub">On test day, you won't be able to move on to the next module until time expires.</p>
      <p class="bigreview-sub"><b>For these practice questions, you can click Next when you're ready to move on.</b></p>

      <div class="bigreview-card">
        <div class="bigreview-card-head">
          <h3>${state.modules[state.QUESTIONS[0]?.mod]?.title || "Section"} Questions</h3>
          <div class="bigreview-legend">
            <span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 2"/></svg> Unanswered</span>
            <span><svg width="11" height="13" viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg> For Review</span>
          </div>
        </div>
        <p id="bigreview-status" class="nav-status"></p>
        <div id="bigreview-grid" class="nav-grid big"></div>
      </div>

      <div class="bigreview-actions">
        <button id="bigreview-back" class="btn secondary wide">Back</button>
        <button id="bigreview-submit" class="btn wide" disabled>Next</button>
      </div>
    </div></div>`;

  $("bigreview-grid").innerHTML = moduleGridHtml((k) =>
    `${state.answers[k] !== null ? "done" : ""} ${state.marked[k] ? "flag" : ""}`);
  $("bigreview-grid").querySelectorAll("button").forEach((b) => (b.onclick = () => go(Number(b.dataset.k))));

  const statusEl = $("bigreview-status");
  const submitBtn = $("bigreview-submit");
  if (unanswered > 0) {
    statusEl.textContent = `There are ${unanswered} questions left — finish them to submit!`;
    statusEl.classList.add("warn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Next";
  } else {
    statusEl.textContent = "You have finished all of the questions, ready to submit!";
    statusEl.classList.remove("warn");
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit";
  }
  submitBtn.onclick = () => {
    if (state.answers.some((a) => a === null)) return;
    finish();
  };
  $("bigreview-back").onclick = () => go(state.idx);

  syncCalculatorUi();
}

function fmt(s) {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
let tick;
function updateTimerDisplay() {
  $("timer").textContent = state.timerHidden ? "--:--" : fmt(state.secondsLeft);
  $("timer").classList.toggle("low", !state.timerHidden && state.secondsLeft <= 300);
}
function startTimer() {
  updateTimerDisplay();
  tick = setInterval(() => {
    if (state.finished) return clearInterval(tick);
    state.secondsLeft--;
    updateTimerDisplay();
    if (state.secondsLeft <= 0) finish();
  }, 1000);
}
$("timer-toggle").onclick = () => {
  state.timerHidden = !state.timerHidden;
  updateTimerDisplay();
  $("timer-toggle").textContent = state.timerHidden ? "Show" : "Hide";
};

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return div.textContent || div.innerText || "";
}

async function finish() {
  if (state.finished) return;
  state.finished = true;
  state.view = "done";
  hideHlPopover();
  clearInterval(tick);
  exitFullscreenMode();
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

  if (error || !result) {
    const msg = error ? error.message : "Không có dữ liệu trả về";
    $("stage").innerHTML = `<div class="loading">Không chấm được điểm: ${escapeHtml(msg)}</div>`;
    return;
  }

  state.finalScore = result.score;
  state.finalTotal = result.total;

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
      <h2>Congratulations! You have finished the test</h2>
      <p>Time used: ${fmt(secondsUsed)}</p>
      <button id="see-result-btn" class="btn wide">See your results</button>
    </div>`;
  $("see-result-btn").onclick = () => renderStats();
}

function computeStats() {
  const total = state.QUESTIONS.length;
  let correct = 0;
  const byUnit = {};
  const byModule = state.modules.map((m) => ({ title: m.title, calculator: m.calculator, correct: 0, total: 0 }));
  state.QUESTIONS.forEach((q, i) => {
    const unit = q.unit || "";
    if (!byUnit[unit]) byUnit[unit] = { unit, correct: 0, wrong: 0 };
    const isCorrect = state.correctIndex[i] != null && state.answers[i] === state.correctIndex[i];
    byModule[q.mod].total++;
    if (isCorrect) { byUnit[unit].correct++; byModule[q.mod].correct++; correct++; }
    else byUnit[unit].wrong++;
  });
  const units = Object.values(byUnit);
  const topCorrect = [...units].filter((u) => u.correct > 0).sort((a, b) => b.correct - a.correct).slice(0, 3);
  const topWrong = [...units].filter((u) => u.wrong > 0).sort((a, b) => b.wrong - a.wrong).slice(0, 3);
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
    byModule,
    secondsUsed,
    minutesUsed
  };
}
async function fetchScoreEstimate() {
  const { data, error } = await sb.rpc("get_score_estimate", { p_attempt_id: state.attemptId });
  if (error) { console.warn("Lỗi lấy điểm ước tính:", error.message); return null; }
  return Array.isArray(data) ? data[0] : data;
}

function fmtNum(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function estimateHeroHtml(est) {
  if (!est || !est.scoring_configured) return "";
  const pending = est.frq_required && !est.frq_graded;

  const frqItem = est.frq_required ? `
    <div class="est-item">
      <span class="est-k">FRQ raw score</span>
      <span class="est-v">${pending ? "Not graded yet"
        : `${fmtNum(est.frq_raw_total)}${est.frq_max_total != null ? ` / ${fmtNum(est.frq_max_total)}` : ""}`}</span>
    </div>` : "";

  const weightedItem = `
    <div class="est-item">
      <span class="est-k">Weighted score / Weighted total</span>
      <span class="est-v">${pending ? "—"
        : `${fmtNum(est.weighted_score)} / ${fmtNum(est.weighted_total)}`}</span>
    </div>`;

  return `
    <div class="est-hero">
      <div class="est-main">
        <div class="est-label">Estimated AP Score</div>
        <div class="est-score ${pending ? "pending" : ""}">${pending ? "—" : (est.ap_score ?? "—")}</div>
      </div>
      <div class="est-details">
        ${frqItem}
        ${weightedItem}
      </div>
    </div>
    ${pending ? `<p class="est-note">Your FRQ has not been graded yet. Your estimated AP score will appear once your teacher enters it.</p>` : ""}`;
}

// Bảng kết quả theo từng module (có điểm của từng module nếu giáo viên đã cấu hình cách tính điểm)
function moduleBreakdownHtml(s, est) {
  let rows = [];
  if (est && est.scoring_configured && Array.isArray(est.modules) && est.modules.length) {
    rows = est.modules.map((m) => {
      const isFrq = m.kind === "frq";
      const frqPending = isFrq && Number(m.n_frq_graded) < Number(m.n_frq);
      return {
        title: m.title,
        type: isFrq ? "FRQ" : (CALC_LABEL[m.calculator] || ""),
        result: isFrq
          ? (frqPending ? "Not graded yet" : `${fmtNum(m.frq_raw)} / ${fmtNum(m.frq_max)} raw`)
          : `${fmtNum(m.correct)} / ${fmtNum(m.total)} correct`,
        pts: frqPending ? "—" : `${fmtNum(m.points)} / ${fmtNum(m.max_points)}`
      };
    });
  } else if (state.modules.length > 1 || (state.modules[0] && state.modules[0].title)) {
    rows = s.byModule.map((m) => ({
      title: m.title,
      type: CALC_LABEL[m.calculator] || "",
      result: `${m.correct} / ${m.total} correct`,
      pts: "—"
    }));
  }
  if (!rows.length) return "";
  return `
    <div class="mod-breakdown">
      <table>
        <thead><tr><th>Module</th><th>Calculator</th><th>Result</th><th>Points</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.type)}</td><td>${escapeHtml(r.result)}</td><td>${escapeHtml(r.pts)}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

async function renderStats() {
  const s = computeStats();
  const estimate = await fetchScoreEstimate();

  $("stage").className = "stage single";
  $("stage").innerHTML = `
    <div class="stats-page">
      ${estimateHeroHtml(estimate)}
      <div class="stats-card">
        <div class="stats-summary">
          <div class="stat-box">
            <div class="stat-value">${s.correct} / ${s.total}</div>
            <div class="stat-label">No. of Correct Questions</div>
          </div>
          <div class="stat-box">
            <div class="stat-value">${s.percent}%</div>
            <div class="stat-label">Correct Percentage</div>
          </div>
          <div class="stat-box">
            <div class="stat-value">${s.secondsUsed != null ? fmt(s.secondsUsed) : "—"}</div>
            <div class="stat-label">${s.minutesUsed != null ? `Time (${s.minutesUsed} minutes)` : "Thời gian làm bài"}</div>
          </div>
        </div>
        <div class="stats-units">
          <div class="stats-unit-col">
            <h4></h4>
            <ul>${s.topCorrect.length ? s.topCorrect.map((u) => `<li><span class="dot ok"></span>${escapeHtml(u.unit)} <b>${u.correct}</b> câu đúng</li>`).join("") : "<li>Chưa có dữ liệu</li>"}</ul>
          </div>
          <div class="stats-unit-col">
            <h4></h4>
            <ul>${s.topWrong.length ? s.topWrong.map((u) => `<li><span class="dot bad"></span>${escapeHtml(u.unit)} <b>${u.wrong}</b> câu sai</li>`).join("") : "<li>Chưa có dữ liệu</li>"}</ul>
          </div>
        </div>
      </div>

      ${moduleBreakdownHtml(s, estimate)}

      <div class="stats-list">
        ${state.QUESTIONS.map((q, i) => {
          const chosen = state.answers[i];
          const correctIdx = state.correctIndex[i];
          const isCorrect = correctIdx != null && chosen === correctIdx;
          const rawText = stripHtml(q.text);
          const snippet = escapeHtml(rawText.slice(0, 20) + (rawText.length > 20 ? "…" : ""));
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
    ${moduleTagHtml(state.modules[q.mod])}
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
            ${renderChoiceBody(c)}
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

/* ============ KÉO / ĐỔI KÍCH THƯỚC KHUNG MÁY TÍNH ============ */
(function () {
  const box = $("calc"), head = $("calc-head");
  let dx = 0, dy = 0, drag = false, minTop = 90;
  head.onmousedown = (e) => {
    if (e.target.closest("button")) return;
    drag = true;
    const r = box.getBoundingClientRect();
    dx = e.clientX - r.left; dy = e.clientY - r.top;
    head.style.cursor = "grabbing";
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

(function () {
  const box = $("calc"), handle = $("calc-resize-handle");
  let resizing = false, startX = 0, startY = 0, startW = 0, startH = 0;

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
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

/* ============ TOÀN MÀN HÌNH ============ */
const MAX_FS_EXITS = 3;
let fsExitCount = 0;
let fsOverlayShowing = false;

function requestFullscreenMode() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (!req) return;
  try {
    const p = req.call(el);
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (_) { /* trình duyệt không cho phép */ }
}
function exitFullscreenMode() {
  const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  if (!isFullscreenActive() || !exit) return;
  try {
    const p = exit.call(document);
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (_) { /* bỏ qua */ }
}
function isFullscreenActive() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
}
function handleFullscreenChange() {
  if (!state.attemptId || state.finished) return;
  if (isFullscreenActive() || fsOverlayShowing) return;

  fsExitCount++;
  fsOverlayShowing = true;

  if (fsExitCount >= MAX_FS_EXITS) {
    $("fs-lockout").hidden = false;
  } else {
    $("fs-warning-text").textContent =
      `You have exited the test screen for ${fsExitCount}/${MAX_FS_EXITS}. If you exit the test screen more than ${MAX_FS_EXITS} times, your test will be invalidated and you will have to work again.`;
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
/* ============ DIRECTIONS THEO MODULE ============ */
const seenDirections = new Set();
let directionsOpenInline = false;

function paragraphsHtml(text) {
  // Admin đã tự gõ HTML (vd: <b>, <br>) trong ô Directions ở trang quản trị,
  // nên hiển thị nguyên văn, không escape — khác với nội dung câu hỏi lấy từ học sinh.
  return text || "";
}

function showDirectionsScreen(mod, isFirstEver) {
  $("directions-title").textContent = `${mod.title || "Section"} Directions`;
  $("directions-body").innerHTML = paragraphsHtml(mod.directions_html);
  $("directions-resume-btn").textContent = isFirstEver ? "Begin Section" : "Resume Testing";
  $("directions-screen").hidden = false;
}

$("directions-resume-btn").onclick = () => {
  $("directions-screen").hidden = true;
  renderQuestion();
};

function directionsToggleHtml(mod) {
  if (!mod || !mod.directions_html) return "";
  return `
    <button class="directions-toggle" id="directions-toggle-btn">
      Directions
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    <div class="directions-inline" id="directions-inline" hidden>${paragraphsHtml(mod.directions_html)}</div>`;
}
let imgZoom = { pct: 100 };

function imgFrameHtml(img) {
  return `
    <div class="img-frame" id="img-frame">
      <div class="img-frame-bar">
        <button id="if-zoom-in" title="Zoom in">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/></svg>
        </button>
        <button id="if-zoom-out" title="Zoom out">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/></svg>
        </button>
        <span class="if-pct">${imgZoom.pct}%</span>
        <span class="if-reset" id="if-reset">Reset</span>
        <span class="if-sep"></span>
        <button class="if-expand" id="if-expand" title="Full screen">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
        </button>
      </div>
      <div class="img-frame-viewport" id="img-frame-viewport">
        <img src="${img.src}" alt="${img.alt || ""}" id="img-frame-img" style="width:${imgZoom.pct}%">
      </div>
      ${img.caption ? `<figcaption data-hl="cap" style="padding:0 16px 14px">${img.caption}</figcaption>` : ""}
    </div>`;
}

function wireImgFrame() {
  const frame = $("img-frame");
  if (!frame) return;
  const img = $("img-frame-img");
  const pctEl = frame.querySelector(".if-pct");
  const apply = () => {
    img.style.width = imgZoom.pct + "%";
    pctEl.textContent = imgZoom.pct + "%";
  };
  $("if-zoom-in").onclick = () => { imgZoom.pct = Math.min(300, imgZoom.pct + 25); apply(); };
  $("if-zoom-out").onclick = () => { imgZoom.pct = Math.max(25, imgZoom.pct - 25); apply(); };
  $("if-reset").onclick = () => { imgZoom.pct = 100; apply(); };
  $("if-expand").onclick = () => frame.classList.toggle("expanded");
}