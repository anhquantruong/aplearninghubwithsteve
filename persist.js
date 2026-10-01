/* persist.js — lưu kết quả bài thi của học sinh theo thiết bị.
 * Nạp SAU script.js của trang làm bài:
 *   <script src="script.js"></script>
 *   <script src="persist.js"></script>
 * Reload trang => hiện lại kết quả. Muốn làm lại => giáo viên bấm "Cho làm lại".
 */
(function () {
  if (typeof ACCESS_CODE === "undefined" || !ACCESS_CODE) return;
  const KEY = "apexam_result_" + ACCESS_CODE;

  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) { return null; } };
  const save = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { console.warn("Không lưu được kết quả:", e); } };
  const clear = () => { try { localStorage.removeItem(KEY); } catch (_) {} };

  /* ----- 1. Lưu kết quả ngay khi nộp bài xong ----- */
  const origShowCongrats = showCongrats;
  showCongrats = function (secondsUsed) {
    save({
      attemptId: state.attemptId,
      examId: state.examId,
      totalSeconds: state.totalSeconds,
      title: $("exam-subtitle").textContent,
      name: document.querySelector(".footbar .brand").textContent,
      email: $("gate-email").value.trim(),
      questions: state.QUESTIONS,
      answers: state.answers,
      correctIndex: state.correctIndex,
      finalScore: state.finalScore,
      finalTotal: state.finalTotal,
      secondsUsed: state.secondsUsed
    });
    origShowCongrats(secondsUsed);
  };

  /* ----- 2. Ghi chú "muốn làm lại" ở trang kết quả ----- */
  const origRenderStats = renderStats;
  renderStats = async function () {
    await origRenderStats.apply(this, arguments);
    const page = document.querySelector(".stats-page");
    if (page && !page.querySelector(".retake-note")) {
      page.insertAdjacentHTML("beforeend",
        `<p class="retake-note" style="text-align:center;color:#666;font-size:13px;margin:16px 0">Bài làm đã được lưu trên thiết bị này. Muốn làm lại, hãy liên hệ giáo viên để được cho phép.</p>`);
    }
  };

  /* ----- 3. Khi mở lại trang: nếu đã có kết quả thì hiện luôn ----- */
  (async function restore() {
    const saved = load();
    if (!saved || !saved.attemptId || !Array.isArray(saved.questions)) return;
    if (isPhoneDevice()) return;

    const submitBtn = $("gate-submit");
    if (submitBtn) submitBtn.disabled = true; // chặn bấm vào thi trong lúc kiểm tra

    // Hỏi server: giáo viên đã cho làm lại chưa / lượt làm này còn tồn tại không
    try {
      const { data, error } = await sb.rpc("get_attempt_status", { p_attempt_id: saved.attemptId });
      if (!error) {
        const st = Array.isArray(data) ? data[0] : data;
        if (!st || st.retake_allowed) { // bị xoá hoặc được phép làm lại
          clear();
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
      }
      // nếu lỗi (chưa tạo hàm SQL...) thì vẫn tin dữ liệu lưu trên máy
    } catch (_) {}

    Object.assign(state, {
      attemptId: saved.attemptId,
      examId: saved.examId,
      totalSeconds: saved.totalSeconds,
      QUESTIONS: saved.questions,
      answers: saved.answers,
      marked: saved.questions.map(() => false),
      crossed: saved.questions.map(() => new Set()),
      highlights: saved.questions.map(() => []),
      correctIndex: saved.correctIndex,
      finalScore: saved.finalScore,
      finalTotal: saved.finalTotal,
      secondsUsed: saved.secondsUsed,
      finished: true,
      view: "done"
    });

    $("gate-screen").hidden = true;
    $("app-root").hidden = false;
    $("exam-subtitle").textContent = saved.title || "";
    document.querySelector(".footbar .brand").textContent = saved.name || "";
    setupWatermark(saved.name || "", saved.email || "");
    document.querySelector(".topbar").style.display = "none";
    document.querySelector(".footbar").style.display = "none";
    $("calc").hidden = true;
    renderStats();
  })();
})();