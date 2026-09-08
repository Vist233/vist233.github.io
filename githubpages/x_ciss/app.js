"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) => String(value == null ? "" : value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");
const enc = (path) => path.split("/").map(encodeURIComponent).join("/");

const DB = Object.create(null);
const state = { selected: [] };
const recording = {
  timerId: null,
  frame: 0,
  reducedMotion: false,
};

async function loadJSON(name) {
  const response = await fetch(`data/${name}?v=20260907e`, { cache: "no-store" });
  if (!response.ok) throw new Error(`无法加载 ${name}（${response.status}）`);
  return response.json();
}

function toast(message) {
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  $("#toasts").appendChild(item);
  window.setTimeout(() => item.remove(), 2600);
}

function openModal(html) {
  $("#modal").innerHTML = html;
  $("#modal-mask").classList.add("show");
  $("#modal-mask").setAttribute("aria-hidden", "false");
}

function closeModal() {
  $("#modal-mask").classList.remove("show");
  $("#modal-mask").setAttribute("aria-hidden", "true");
}

$("#modal-mask").addEventListener("click", (event) => {
  if (event.target === $("#modal-mask")) closeModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});

function pageHeading(step, title, description) {
  return `
    <header class="page-heading">
      <div class="page-kicker">${step} / ${title}</div>
      <h1>${title}</h1>
      <p>${description}</p>
    </header>`;
}

function renderPatientBanner() {
  const p = DB.patient;
  const facts = [
    ["门诊号", p.patient_id],
    ["科室", p.department],
    ["就诊类型", p.visit_type],
    ["日期", p.visit_date],
  ];
  $("#patient-banner").innerHTML = `
    <section class="patient-context" aria-label="模拟患者上下文">
      <div class="context-strip"><span class="simulation-boundary">模拟演示数据</span></div>
      <div class="patient-context-body">
        <div class="patient-primary">
          <span class="eyebrow">患者上下文</span>
          <h2><span class="patient-name">${esc(p.name)}</span> <span>${esc(p.gender)} · ${esc(p.age)}</span></h2>
          <p>${esc(p.department)} · ${esc(p.visit_type)} · 本地模拟记录</p>
        </div>
        <dl class="patient-facts">
          ${facts.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}
        </dl>
      </div>
    </section>`;
}

function stopRecordingSignal() {
  if (recording.timerId !== null) window.clearInterval(recording.timerId);
  recording.timerId = null;
}

function updateRecordingSignal(frame) {
  const grid = $("[data-recording-grid]");
  if (!grid) return;
  const cells = [...grid.querySelectorAll(".recording-cell")];
  recording.frame = frame % cells.length;
  grid.dataset.frame = String(recording.frame);
  cells.forEach((cell, index) => {
    const distance = (recording.frame - index + cells.length) % cells.length;
    cell.dataset.level = distance < 3 ? "high" : distance < 6 ? "mid" : "low";
  });
}

function startRecordingSignal() {
  stopRecordingSignal();
  recording.reducedMotion = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  updateRecordingSignal(0);
  if (recording.reducedMotion) return;
  recording.timerId = window.setInterval(() => updateRecordingSignal(recording.frame + 1), 260);
}

function recordingMarkup() {
  const cells = Array.from({ length: 12 }, (_, index) => `<span class="recording-cell" style="--cell-index:${index}" data-level="${index < 3 ? "high" : index < 6 ? "mid" : "low"}"></span>`).join("");
  return `
    <div class="recording-console">
      <div class="recording-label"><span>录音输入</span><span class="recording-indicator"><i></i>模拟演示</span></div>
      <div class="recording-grid" data-recording-grid data-frame="0" aria-label="模拟录音信号">${cells}</div>
      <p>方格信号仅表示本地模拟输入，不代表真实录音。</p>
    </div>`;
}

function renderConsult() {
  const v = $("#view");
  const context = DB.order_check_rules.patient_context || {};
  v.innerHTML = pageHeading("01", "问诊", "查看模拟问诊转写、录音输入和问诊摘要，然后进入开检查。");

  const status = document.createElement("div");
  status.className = "consult-status";
  status.innerHTML = `<span class="status-dot" aria-hidden="true"></span><span>录音输入中 · 模拟演示</span><span class="status-note">不会调用麦克风</span>`;
  v.appendChild(status);

  const grid = document.createElement("div");
  grid.className = "consult-grid";

  const transcriptPanel = document.createElement("section");
  transcriptPanel.className = "panel transcript-panel";
  transcriptPanel.innerHTML = `<div class="panel-head"><div><span class="panel-kicker">问诊记录</span><h2>转写内容</h2></div><span class="panel-meta">${DB.transcript.length} 行</span></div>${recordingMarkup()}`;
  const transcript = document.createElement("div");
  transcript.className = "transcript";
  DB.transcript.forEach((line) => {
    const row = document.createElement("div");
    row.className = "transcript-line";
    row.innerHTML = `<time>${esc(line.ts)}</time><span class="speaker ${line.role === "医生" ? "speaker-doctor" : "speaker-patient"}">${esc(line.role)}</span><p>${esc(line.text)}</p>`;
    transcript.appendChild(row);
  });
  transcriptPanel.appendChild(transcript);
  grid.appendChild(transcriptPanel);

  const summaryPanel = document.createElement("section");
  summaryPanel.className = "panel summary-panel";
  summaryPanel.innerHTML = `
    <div class="panel-head"><div><span class="panel-kicker">问诊摘要</span><h2>当前上下文</h2></div><span class="panel-meta">本地生成</span></div>
    <dl class="summary-facts"><div><dt>主诉</dt><dd>${esc(context.chief_complaint || DB.patient.chief_complaint)}</dd></div><div><dt>持续时间</dt><dd>${esc(context.duration || "未说明")}</dd></div><div><dt>诱因</dt><dd>${esc((context.triggers || []).join(" · ") || "未说明")}</dd></div><div><dt>既往史</dt><dd>${esc(context.history || "未说明")}</dd></div></dl>
    <section class="related-cases"><div class="subsection-head"><span>相似病例</span><small>最多两条</small></div>${DB.similar_cases.slice(0, 2).map((item) => `<article class="case-mini"><strong>${esc(item.patient_name)}</strong><span>${esc(item.similar_points)}</span></article>`).join("")}</section>`;
  grid.appendChild(summaryPanel);
  v.appendChild(grid);
  startRecordingSignal();
}

function severityLabel(priority) {
  return ({ 高: "高", 中: "中", 低: "低" })[priority] || "未设定";
}

function renderOrders() {
  const v = $("#view");
  v.innerHTML = pageHeading("02", "开检查", "搜索并选择模拟检查项目，再运行开单一致性检查。");

  const note = document.createElement("div");
  note.className = "review-note";
  note.innerHTML = `<span class="note-mark">模拟规则提示</span><p>规则结果只用于演示选择、检查和反馈的交互，不提交真实医嘱。</p>`;
  v.appendChild(note);

  const controls = document.createElement("div");
  controls.className = "order-controls";
  controls.innerHTML = `<label class="field-label" for="order-search">搜索检查项目<input id="order-search" class="search" type="search" placeholder="输入项目名称" autocomplete="off"></label><span class="selection-count" id="selection-count">已选 0 项</span>`;
  v.appendChild(controls);

  const listWrap = document.createElement("div");
  listWrap.className = "order-list-wrap";
  v.appendChild(listWrap);

  const renderList = () => {
    const query = $("#order-search").value.trim().toLowerCase();
    const orders = [...DB.orders_ranked]
      .sort((a, b) => (a.order || 999) - (b.order || 999))
      .filter((item) => !query || String(item.order_name || "").toLowerCase().includes(query));
    listWrap.innerHTML = `<div class="list-heading"><span>${orders.length} 个检查项目</span><span>已选：<strong>${state.selected.length}</strong></span></div>`;
    const list = document.createElement("div");
    list.className = "order-list";
    orders.forEach((item) => {
      const label = document.createElement("label");
      label.className = "order-item";
      const name = item.order_name || "";
      const tags = (item.tags || []).join(" · ");
      label.innerHTML = `<input type="checkbox" ${state.selected.includes(name) ? "checked" : ""}><span class="order-copy"><strong>${esc(name)}</strong><small>模拟项目 · ${esc(tags || "本地规则输入")}</small></span><span class="severity severity-${esc(item.priority)}">${severityLabel(item.priority)}</span>`;
      $("input", label).addEventListener("change", (event) => {
        if (event.target.checked && !state.selected.includes(name)) state.selected.push(name);
        if (!event.target.checked) state.selected = state.selected.filter((value) => value !== name);
        renderList();
      });
      list.appendChild(label);
    });
    if (!orders.length) list.innerHTML = `<div class="empty-state">没有匹配的模拟检查项目。</div>`;
    listWrap.appendChild(list);
    $("#selection-count").textContent = `已选 ${state.selected.length} 项`;
  };
  $("#order-search").addEventListener("input", renderList);
  renderList();

  const actions = document.createElement("div");
  actions.className = "page-actions";
  actions.innerHTML = `<button class="btn btn-primary" type="button" id="check-orders">检查开单一致性</button><span>选择只保留在当前浏览器页面中。</span>`;
  $("#check-orders", actions).addEventListener("click", () => {
    if (!state.selected.length) {
      toast("请先选择至少一个模拟检查项目。");
      return;
    }
    showOrderWarnings();
  });
  v.appendChild(actions);
}

function showOrderWarnings() {
  const rules = DB.order_check_rules;
  const selected = state.selected;
  const patientText = DB.transcript.filter((item) => item.role === "病人").map((item) => item.text).join(" ");
  const conflicts = (rules.conflicts || [])
    .map((rule) => ({ ...rule, selected: (rule.items || []).filter((item) => selected.includes(item)) }))
    .filter((rule) => rule.selected.length >= 2);
  const priorityOrder = { 高: 1, 中: 2, 低: 3 };
  const missing = (rules.missing_checks || [])
    .filter((rule) => !selected.includes(rule.missing_item) && (rule.symptom_keywords || []).some((keyword) => patientText.includes(keyword)))
    .sort((a, b) => (priorityOrder[a.priority] || 4) - (priorityOrder[b.priority] || 4));

  let html = `<div class="modal-head"><span class="panel-kicker">模拟规则提示</span><h2 id="modal-title">开单一致性检查</h2><p>以下反馈来自静态模拟规则，仅用于演示。请返回页面修改选择，不能据此作出医疗决定。</p></div>`;
  if (conflicts.length || missing.length) {
    html += `<div class="review-results">`;
    conflicts.forEach((rule) => {
      html += `<section class="review-block"><span class="review-label review-danger">冲突</span><h3>${esc(rule.group)}</h3><p>已选项目：${esc(rule.selected.join(" · "))}</p><small>模拟规则命中，请返回开检查页面修改选择。</small></section>`;
    });
    missing.forEach((rule) => {
      html += `<section class="review-block"><span class="review-label">遗漏提醒</span><h3>${esc(rule.missing_item)} <span class="severity severity-${esc(rule.priority)}">${severityLabel(rule.priority)}优先级</span></h3><p>问诊转写触发了这一条静态模拟提示。</p><small>这不是医疗建议，也不会自动添加检查。</small></section>`;
    });
    html += `</div><div class="modal-actions"><button class="btn btn-primary" type="button" id="m-go">保留本地选择</button><button class="btn" type="button" id="m-back">返回修改</button></div>`;
  } else {
    html += `<div class="success-state"><span class="status-dot"></span><p>未发现命中的模拟规则。</p></div><div class="modal-actions"><button class="btn btn-primary" type="button" id="m-go">返回开检查</button></div>`;
  }
  openModal(html);
  $("#m-go").addEventListener("click", () => {
    toast("已保留本地模拟选择。");
    closeModal();
  });
  $("#m-back")?.addEventListener("click", closeModal);
}

function renderResults() {
  const v = $("#view");
  v.innerHTML = pageHeading("03", "查结果", "查看结构化模拟结果和原始报告图片。");

  const summary = document.createElement("div");
  summary.className = "review-note neutral-note";
  summary.innerHTML = `<span class="note-mark">模拟报告</span><p>结果条目只保留报告中的简短信息，不提供诊断结论或医学解释。</p>`;
  v.appendChild(summary);

  const resultGrid = document.createElement("div");
  resultGrid.className = "results-grid";
  const findings = document.createElement("section");
  findings.className = "panel findings-panel";
  findings.innerHTML = `<div class="panel-head"><div><span class="panel-kicker">结构化结果</span><h2>异常条目</h2></div><span class="panel-meta">模拟记录</span></div>`;
  const findingList = document.createElement("div");
  findingList.className = "finding-list";
  (DB.abnormal_summary.abnormal_items || []).forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "finding-row";
    row.innerHTML = `<span class="finding-no">${String(index + 1).padStart(2, "0")}</span><div><strong>${esc(item.name)}</strong><p>${esc(item.value)}</p></div><span class="finding-status">已记录</span>`;
    findingList.appendChild(row);
  });
  findings.appendChild(findingList);
  resultGrid.appendChild(findings);

  const reports = document.createElement("section");
  reports.className = "panel report-panel";
  reports.innerHTML = `<div class="panel-head"><div><span class="panel-kicker">原始报告</span><h2>报告图片</h2></div><span class="panel-meta">模拟图像</span></div>`;
  const figure = document.createElement("figure");
  figure.className = "report-figure";
  figure.innerHTML = `<img src="data/${enc("result-original-report.webp")}" alt="模拟原始报告图片"><figcaption>原始报告 · 模拟演示素材</figcaption>`;
  reports.appendChild(figure);
  const detailFigure = document.createElement("div");
  detailFigure.className = "report-figure-detail";
  detailFigure.innerHTML = `<figure><img src="data/${enc("result-eosinophil-count.webp")}" alt="模拟嗜酸性粒细胞计数"><figcaption>嗜酸性粒细胞计数</figcaption></figure><figure><img src="data/${enc("result-eosinophil-ratio.webp")}" alt="模拟嗜酸性粒细胞比例"><figcaption>嗜酸性粒细胞比例</figcaption></figure>`;
  reports.appendChild(detailFigure);
  resultGrid.appendChild(reports);
  v.appendChild(resultGrid);
}

function firstPatient(predicate) {
  for (const line of DB.transcript) if (line.role === "病人" && predicate(line.text)) return line.text;
  return "";
}

function buildRecord() {
  const p = DB.patient;
  const context = DB.order_check_rules.patient_context || {};
  const chief = firstPatient((text) => text.length > 5 && !text.includes("没有"));
  const present = DB.transcript.filter((line) => line.role === "病人").map((line) => line.text).join("\n");
  const orders = state.selected.length ? state.selected.join("、") : "过敏原特异性 IgE 检测、血常规";
  return [
    "CISS / 模拟病历（不可作为真实病历）",
    `患者：${p.name} · ${p.gender} · ${p.age}`,
    `门诊号：${p.patient_id} · ${p.department} · ${p.visit_date}`,
    "",
    `主诉：${chief || p.chief_complaint}`,
    `现病史：${present}`,
    "既往史：本流程未扩展",
    "查体记录：鼻黏膜苍白，双侧下鼻甲肿大。（模拟记录）",
    "生命体征：收缩压 120 mmHg / 舒张压 78 mmHg（模拟记录）",
    `已选检查：${orders}`,
    `诱因标签：${(context.triggers || []).join(" / ")}`,
    "",
    "演示说明：请在实际使用前由专业人员审核和改写。",
  ].join("\n");
}

function printRecord(text) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    toast("打印窗口未打开。");
    return;
  }
  printWindow.document.write(`<pre style="font:14px/1.7 ui-monospace,monospace;white-space:pre-wrap;padding:24px">${esc(text)}</pre>`);
  printWindow.document.close();
  printWindow.print();
  toast("已调用本地打印预览。");
}

function exportRecord(text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "ciss-模拟病历.txt";
  link.click();
  URL.revokeObjectURL(link.href);
  toast("病历已导出到本地下载。");
}

function renderRecord() {
  const v = $("#view");
  v.innerHTML = pageHeading("04", "写病历", "编辑由前序模拟信息生成的病历草稿，复制、打印或导出只在本地浏览器中生效。");
  const recordGrid = document.createElement("div");
  recordGrid.className = "record-grid";
  const editor = document.createElement("section");
  editor.className = "panel record-editor";
  editor.innerHTML = `<div class="panel-head"><div><span class="panel-kicker">病历草稿</span><h2>模拟电子病历</h2></div><span class="panel-meta">本地编辑</span></div>`;
  const textarea = document.createElement("textarea");
  textarea.className = "record-textarea";
  textarea.value = buildRecord();
  textarea.setAttribute("aria-label", "模拟病历草稿");
  editor.appendChild(textarea);
  const actions = document.createElement("div");
  actions.className = "record-actions";
  const buttons = [
    ["复制病历", "copy", async () => {
      try {
        await navigator.clipboard.writeText(textarea.value);
        toast("病历已复制（仅本地）。");
      } catch {
        textarea.select();
        document.execCommand("copy");
        toast("病历已复制（仅本地）。");
      }
    }],
    ["打印病历", "print", () => printRecord(textarea.value)],
    ["导出病历", "export", () => exportRecord(textarea.value)],
  ];
  buttons.forEach(([label, action, handler]) => {
    const button = document.createElement("button");
    button.className = "btn";
    button.type = "button";
    button.dataset.recordAction = action;
    button.textContent = label;
    button.addEventListener("click", handler);
    actions.appendChild(button);
  });
  editor.appendChild(actions);
  const boundary = document.createElement("p");
  boundary.className = "boundary-note-inline";
  boundary.textContent = "病历内容只保留在当前页面，不保存、不发送，也不连接临床系统。";
  editor.appendChild(boundary);
  recordGrid.appendChild(editor);

  const source = document.createElement("section");
  source.className = "panel source-panel";
  source.innerHTML = `<div class="panel-head"><div><span class="panel-kicker">来源转写</span><h2>问诊记录</h2></div><span class="panel-meta">原始内容</span></div>`;
  const sourceText = document.createElement("div");
  sourceText.className = "source-text";
  sourceText.textContent = DB.transcript.map((line) => `${line.ts}  ${line.role}  ${line.text}`).join("\n");
  source.appendChild(sourceText);
  recordGrid.appendChild(source);
  v.appendChild(recordGrid);
}

const PAGES = [
  { id: "consult", label: "问诊", step: "01", render: renderConsult },
  { id: "order", label: "开检查", step: "02", render: renderOrders },
  { id: "result", label: "查结果", step: "03", render: renderResults },
  { id: "record", label: "写病历", step: "04", render: renderRecord },
];

function buildNav() {
  const nav = $("#nav");
  nav.innerHTML = "";
  PAGES.forEach((page) => {
    const item = document.createElement("button");
    item.className = "nav-item";
    item.type = "button";
    item.dataset.id = page.id;
    item.innerHTML = `<span class="nav-step">${page.step}</span><span class="nav-copy"><strong>${page.label}</strong></span>`;
    item.addEventListener("click", () => { window.location.hash = page.id; });
    nav.appendChild(item);
  });
}

function route() {
  stopRecordingSignal();
  if (!window.location.hash) window.history.replaceState(null, "", "#consult");
  const id = (window.location.hash || "#consult").slice(1);
  const page = PAGES.find((item) => item.id === id) || PAGES[0];
  document.querySelectorAll(".nav-item").forEach((item) => {
    const active = item.dataset.id === page.id;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  page.render();
  window.scrollTo(0, 0);
}

function testSnapshot() {
  const grid = $("[data-recording-grid]");
  const visibleText = document.body.innerText;
  return {
    ready: Boolean(DB.patient),
    hash: window.location.hash,
    consultConsole: Boolean($(".consult-status") && grid),
    patientName: $(".patient-name")?.textContent || "",
    navLabels: [...document.querySelectorAll(".nav-item strong")].map((item) => item.textContent),
    visibleText,
    recordingCells: grid ? grid.querySelectorAll(".recording-cell").length : 0,
    recordingFrame: Number(grid?.dataset.frame || 0),
    recordingLevels: grid ? [...grid.querySelectorAll(".recording-cell")].map((cell) => cell.dataset.level) : [],
    recordingTimerRunning: recording.timerId !== null,
    reducedMotion: recording.reducedMotion,
    orderSearch: Boolean($("#order-search")),
    orderCheckboxes: document.querySelectorAll('input[type="checkbox"]').length,
    selectedText: $("#selection-count")?.textContent || "",
    checkButton: $("#check-orders")?.textContent || "",
    modalVisible: $("#modal-mask")?.classList.contains("show") || false,
    modalText: $("#modal")?.innerText || "",
    resultRows: document.querySelectorAll(".finding-row").length,
    reportImages: [...document.querySelectorAll(".report-panel img")].map((img) => ({
      complete: img.complete,
      width: img.naturalWidth,
      renderedWidth: img.getBoundingClientRect().width,
      containerWidth: img.closest("figure")?.getBoundingClientRect().width || 0,
    })),
    recordTextarea: Boolean($(".record-textarea")),
    recordActions: [...document.querySelectorAll("[data-record-action]")].map((item) => item.textContent),
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
  };
}

window.__CISS_TEST__ = {
  get ready() { return Boolean(DB.patient); },
  snapshot: testSnapshot,
};

window.addEventListener("hashchange", route);

(async function boot() {
  try {
    const [patient, transcript, similar_cases, orders_ranked, order_check_rules, sidebar_support, abnormal_summary] = await Promise.all([
      loadJSON("patient.json"),
      loadJSON("transcript.json"),
      loadJSON("similar_cases.json"),
      loadJSON("orders_ranked.json"),
      loadJSON("order_check_rules.json"),
      loadJSON("sidebar_support.json"),
      loadJSON("abnormal_summary.json"),
    ]);
    Object.assign(DB, { patient, transcript, similar_cases, orders_ranked, order_check_rules, sidebar_support, abnormal_summary });
    renderPatientBanner();
    buildNav();
    route();
  } catch (error) {
    $("#view").innerHTML = `<div class="error-state"><strong>模拟数据加载失败。</strong><p>${esc(error.message)}</p></div>`;
  }
})();
