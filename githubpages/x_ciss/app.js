"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) => String(value == null ? "" : value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");
const enc = (path) => path.split("/").map(encodeURIComponent).join("/");

async function loadJSON(name) {
  const response = await fetch(`data/${name}?v=20260907`);
  if (!response.ok) throw new Error(`Could not load ${name} (${response.status})`);
  return response.json();
}

const DB = {};
const state = { selected: [] };

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
      <div class="page-kicker">${step} / SYNTHETIC WORKFLOW</div>
      <h1>${title}</h1>
      <p>${description}</p>
    </header>`;
}

function renderPatientBanner() {
  const p = DB.patient;
  const facts = [
    ["Patient ID", p.patient_id],
    ["Department", p.department],
    ["Visit type", p.visit_type],
    ["Date", p.visit_date],
  ];
  $("#patient-banner").innerHTML = `
    <section class="patient-context" aria-label="Synthetic patient context">
      <div class="context-strip">
        <span class="context-code">DEMO</span>
        <span>SYNTHETIC DATA / STATIC PROTOTYPE</span>
        <span class="context-guard">No clinical system connected</span>
      </div>
      <div class="patient-context-body">
        <div class="patient-primary">
          <span class="eyebrow">Patient context</span>
          <h2>${esc(p.name)} <span>${esc(p.gender)} · ${esc(p.age)}</span></h2>
          <p>${esc(p.chief_complaint)}</p>
        </div>
        <dl class="patient-facts">
          ${facts.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}
        </dl>
      </div>
    </section>`;
}

function renderConsult() {
  const v = $("#view");
  const context = DB.order_check_rules.patient_context || {};
  v.innerHTML = pageHeading("01", "Consult / 问诊", "Review the synthetic transcript and a short context summary before moving to order review.");

  const status = document.createElement("div");
  status.className = "demo-status";
  status.innerHTML = `<span class="status-rule"></span><span>Transcript imported · ${esc(DB.transcript.at(-1)?.ts || "static")}</span><span class="status-note">No live capture</span>`;
  v.appendChild(status);

  const grid = document.createElement("div");
  grid.className = "consult-grid";

  const transcriptPanel = document.createElement("section");
  transcriptPanel.className = "panel transcript-panel";
  transcriptPanel.innerHTML = `<div class="panel-head"><div><span class="panel-kicker">INPUT TRACE</span><h2>Transcript</h2></div><span class="panel-meta">${DB.transcript.length} lines</span></div>`;
  const transcript = document.createElement("div");
  transcript.className = "transcript";
  DB.transcript.forEach((line) => {
    const row = document.createElement("div");
    row.className = "transcript-line";
    row.innerHTML = `<time>${esc(line.ts)}</time><span class="speaker speaker-${line.role === "医生" ? "clinician" : "patient"}">${esc(line.role)}</span><p>${esc(line.text)}</p>`;
    transcript.appendChild(row);
  });
  transcriptPanel.appendChild(transcript);
  grid.appendChild(transcriptPanel);

  const summaryPanel = document.createElement("section");
  summaryPanel.className = "panel summary-panel";
  summaryPanel.innerHTML = `
    <div class="panel-head"><div><span class="panel-kicker">CONTEXT SUMMARY</span><h2>Short summary</h2></div><span class="panel-meta">Demo input</span></div>
    <p class="summary-copy">This prototype groups the reported symptoms and context into a compact review block. It does not make a diagnosis or treatment decision.</p>
    <dl class="summary-facts">
      <div><dt>Reported pattern</dt><dd>${esc(context.chief_complaint || DB.patient.chief_complaint)}</dd></div>
      <div><dt>Duration</dt><dd>${esc(context.duration || "Not specified")}</dd></div>
      <div><dt>Triggers</dt><dd>${esc((context.triggers || []).join(" · ") || "Not specified")}</dd></div>
      <div><dt>History</dt><dd>${esc(context.history || "Not specified")}</dd></div>
    </dl>`;
  grid.appendChild(summaryPanel);
  v.appendChild(grid);

  const cases = document.createElement("section");
  cases.className = "panel related-panel";
  cases.innerHTML = `<div class="panel-head"><div><span class="panel-kicker">REFERENCE SET</span><h2>Related cases</h2></div><span class="panel-meta">${Math.min(DB.similar_cases.length, 2)} shown</span></div>`;
  const caseList = document.createElement("div");
  caseList.className = "case-list";
  DB.similar_cases.slice(0, 2).forEach((item, index) => {
    const row = document.createElement("article");
    row.className = "case-row";
    row.innerHTML = `
      <div class="case-number">0${index + 1}</div>
      <div class="case-copy">
        <h3>${esc(item.patient_name)} <span>${esc(item.gender)} · ${esc(item.age)}</span></h3>
        <p>${esc(item.chief_complaint)}</p>
        <dl class="case-facts"><div><dt>Similar</dt><dd>${esc(item.similar_points)}</dd></div><div><dt>Different</dt><dd>${esc(item.different_points)}</dd></div></dl>
      </div>
      <div class="case-match">${Math.round((item.similarity || 0) * 100)}%<small>match</small></div>`;
    caseList.appendChild(row);
  });
  cases.appendChild(caseList);
  v.appendChild(cases);
}

function severityLabel(priority) {
  return ({ 高: "HIGH", 中: "MEDIUM", 低: "LOW" })[priority] || "UNSET";
}

function renderOrders() {
  const v = $("#view");
  v.innerHTML = pageHeading("02", "Orders / 开检查", "Select sample orders, then run the prototype's conflict and omission checks.");

  const note = document.createElement("div");
  note.className = "review-note";
  note.innerHTML = `<span class="note-mark">RULES</span><p>Static rule examples only. Any output requires professional review and is not medical advice.</p>`;
  v.appendChild(note);

  const controls = document.createElement("div");
  controls.className = "order-controls";
  controls.innerHTML = `<label class="field-label" for="order-search">Filter order list<input id="order-search" class="search" type="search" placeholder="Search by order name" autocomplete="off"></label><span class="selection-count" id="selection-count"></span>`;
  v.appendChild(controls);

  const listWrap = document.createElement("div");
  listWrap.className = "order-list-wrap";
  v.appendChild(listWrap);

  const renderList = () => {
    const query = $("#order-search").value.trim().toLowerCase();
    const orders = [...DB.orders_ranked]
      .sort((a, b) => (a.order || 999) - (b.order || 999))
      .filter((item) => !query || String(item.order_name || "").toLowerCase().includes(query));
    listWrap.innerHTML = `<div class="list-heading"><span>${orders.length} order options</span><span>Selected: <strong>${state.selected.length}</strong></span></div>`;
    const list = document.createElement("div");
    list.className = "order-list";
    orders.forEach((item) => {
      const label = document.createElement("label");
      label.className = "order-item";
      const name = item.order_name || "";
      const tags = (item.tags || []).join(" · ");
      label.innerHTML = `<input type="checkbox" ${state.selected.includes(name) ? "checked" : ""}><span class="order-copy"><strong>${esc(name)}</strong><small>Sample order · ${esc(tags || "static rule input")}</small></span><span class="severity severity-${esc(item.priority)}">${severityLabel(item.priority)}</span>`;
      $("input", label).addEventListener("change", (event) => {
        if (event.target.checked && !state.selected.includes(name)) state.selected.push(name);
        if (!event.target.checked) state.selected = state.selected.filter((value) => value !== name);
        renderList();
      });
      list.appendChild(label);
    });
    if (!orders.length) list.innerHTML = `<div class="empty-state">No matching sample order.</div>`;
    listWrap.appendChild(list);
    $("#selection-count").textContent = `${state.selected.length} selected`;
  };
  $("#order-search").addEventListener("input", renderList);
  renderList();

  const actions = document.createElement("div");
  actions.className = "page-actions";
  actions.innerHTML = `<button class="btn btn-primary" type="button" id="check-orders">Run consistency check</button><span>Selected order names are kept in this browser session only.</span>`;
  $("#check-orders", actions).addEventListener("click", () => {
    if (!state.selected.length) {
      toast("Select at least one sample order first.");
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
  const conflicts = (rules.conflicts || []).map((rule) => ({ ...rule, selected: (rule.items || []).filter((item) => selected.includes(item)) })).filter((rule) => rule.selected.length >= 2);
  const order = { 高: 1, 中: 2, 低: 3 };
  const missing = (rules.missing_checks || []).filter((rule) => !selected.includes(rule.missing_item) && (rule.symptom_keywords || []).some((keyword) => patientText.includes(keyword))).sort((a, b) => (order[a.priority] || 4) - (order[b.priority] || 4));

  let html = `<div class="modal-head"><span class="panel-kicker">DEMO RULE REVIEW</span><h2 id="modal-title">Order consistency check</h2><p>Review the static rule output before continuing. This is a workflow prototype, not a clinical recommendation.</p></div>`;
  if (conflicts.length || missing.length) {
    html += `<div class="review-results">`;
    conflicts.forEach((rule) => {
      html += `<section class="review-block"><span class="review-label review-danger">CONFLICT</span><h3>${esc(rule.group)}</h3><p>${esc(rule.selected.join(" · "))}</p><small>Static rule example matched the selected sample orders.</small></section>`;
    });
    missing.forEach((rule) => {
      html += `<section class="review-block"><span class="review-label">OMISSION CHECK</span><h3>${esc(rule.missing_item)} <span class="severity severity-${esc(rule.priority)}">${severityLabel(rule.priority)}</span></h3><p>Static transcript keyword rule matched this sample item.</p><small>Review the source workflow before taking any action.</small></section>`;
    });
    html += `</div><div class="modal-actions"><button class="btn btn-primary" type="button" id="m-go">Continue with selected items</button><button class="btn" type="button" id="m-back">Back to orders</button></div>`;
  } else {
    html += `<div class="success-state"><span class="status-rule"></span><p>No sample rule hit for this selection.</p></div><div class="modal-actions"><button class="btn btn-primary" type="button" id="m-go">Confirm selection</button></div>`;
  }
  openModal(html);
  $("#m-go").addEventListener("click", () => {
    toast("Selection confirmed for this demo session.");
    closeModal();
  });
  $("#m-back")?.addEventListener("click", closeModal);
}

function renderResults() {
  const v = $("#view");
  v.innerHTML = pageHeading("03", "Results / 查结果", "Read a compact synthetic result summary beside the original report images.");

  const summary = document.createElement("section");
  summary.className = "review-note neutral-note";
  summary.innerHTML = `<span class="note-mark">NEUTRAL SUMMARY</span><p>Static prototype: condenses selected report lines into a compact review surface. It does not interpret results or replace clinical judgment.</p>`;
  v.appendChild(summary);

  const resultGrid = document.createElement("div");
  resultGrid.className = "results-grid";
  const findings = document.createElement("section");
  findings.className = "panel findings-panel";
  findings.innerHTML = `<div class="panel-head"><div><span class="panel-kicker">STRUCTURED LINES</span><h2>Abnormal findings</h2></div><span class="panel-meta">Demo record</span></div>`;
  const findingList = document.createElement("div");
  findingList.className = "finding-list";
  (DB.abnormal_summary.abnormal_items || []).forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "finding-row";
    row.innerHTML = `<span class="finding-no">0${index + 1}</span><div><strong>${esc(item.name)}</strong><p>${esc(item.value)}</p></div><span class="finding-status">RECORDED</span>`;
    findingList.appendChild(row);
  });
  findings.appendChild(findingList);
  resultGrid.appendChild(findings);

  const reports = document.createElement("section");
  reports.className = "panel report-panel";
  reports.innerHTML = `<div class="panel-head"><div><span class="panel-kicker">SOURCE MATERIAL</span><h2>Original report</h2></div><span class="panel-meta">Static images</span></div>`;
  const figure = document.createElement("figure");
  figure.className = "report-figure";
  figure.innerHTML = `<img src="data/${enc("result-original-report.webp")}" alt="Synthetic original report image"><figcaption>Original report / synthetic demo asset</figcaption>`;
  reports.appendChild(figure);
  const detailFigure = document.createElement("figure");
  detailFigure.className = "report-figure report-figure-detail";
  detailFigure.innerHTML = `<div><img src="data/${enc("result-eosinophil-count.webp")}" alt="Synthetic eosinophil count result"><figcaption>Eosinophil count</figcaption></div><div><img src="data/${enc("result-eosinophil-ratio.webp")}" alt="Synthetic eosinophil ratio result"><figcaption>Eosinophil ratio</figcaption></div>`;
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
  const past = "示例数据：既往史未在本流程中扩展";
  const physical = "示例数据：鼻黏膜苍白，双侧下鼻甲肿大。";
  const vital = "示例数据：收缩压 120 mmHg / 舒张压 78 mmHg";
  const orders = state.selected.length ? state.selected.join("、") : "过敏原检测、血常规";
  return [
    "CISS / SYNTHETIC RECORD — NOT A CLINICAL RECORD",
    `Patient: ${p.name} · ${p.gender} · ${p.age}`,
    `Patient ID: ${p.patient_id} · ${p.department} · ${p.visit_date}`,
    "",
    `Chief complaint: ${chief || p.chief_complaint}`,
    `Reported history: ${present}`,
    `Past history: ${past}`,
    `Physical exam: ${physical}`,
    `Vitals: ${vital}`,
    `Selected orders: ${orders}`,
    `Context tags: ${(context.triggers || []).join(" / ")}`,
    "",
    "Prototype note: review and rewrite before any real-world use.",
  ].join("\n");
}

function renderRecord() {
  const v = $("#view");
  v.innerHTML = pageHeading("04", "Record / 写病历", "Edit a clean synthetic record draft and test the copy, print, and export actions.");

  const recordGrid = document.createElement("div");
  recordGrid.className = "record-grid";
  const editor = document.createElement("section");
  editor.className = "panel record-editor";
  editor.innerHTML = `<div class="panel-head"><div><span class="panel-kicker">EDITABLE DRAFT</span><h2>Electronic record</h2></div><span class="panel-meta">Synthetic only</span></div>`;
  const textarea = document.createElement("textarea");
  textarea.className = "record-textarea";
  textarea.value = buildRecord();
  textarea.setAttribute("aria-label", "Synthetic electronic record draft");
  editor.appendChild(textarea);
  const actions = document.createElement("div");
  actions.className = "record-actions";
  [
    ["Copy", async () => { try { await navigator.clipboard.writeText(textarea.value); toast("Record copied."); } catch { textarea.select(); document.execCommand("copy"); toast("Record copied."); } }],
    ["Print", () => { const printWindow = window.open("", "_blank"); if (!printWindow) return; printWindow.document.write(`<pre style="font: 14px/1.7 ui-monospace, monospace; white-space: pre-wrap; padding: 24px">${esc(textarea.value)}</pre>`); printWindow.document.close(); printWindow.print(); }],
    ["Export", () => { const blob = new Blob([textarea.value], { type: "text/plain" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "ciss-synthetic-record.txt"; link.click(); URL.revokeObjectURL(link.href); toast("Record exported."); }],
  ].forEach(([label, handler]) => {
    const button = document.createElement("button");
    button.className = "btn";
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", handler);
    actions.appendChild(button);
  });
  editor.appendChild(actions);
  recordGrid.appendChild(editor);

  const source = document.createElement("section");
  source.className = "panel source-panel";
  source.innerHTML = `<div class="panel-head"><div><span class="panel-kicker">SOURCE TRACE</span><h2>Transcript</h2></div><span class="panel-meta">Read only</span></div>`;
  const sourceText = document.createElement("div");
  sourceText.className = "source-text";
  sourceText.textContent = DB.transcript.map((line) => `${line.ts}  ${line.role}  ${line.text}`).join("\n");
  source.appendChild(sourceText);
  const guard = document.createElement("p");
  guard.className = "boundary-note-inline";
  guard.textContent = "The record is a generated interface draft. It is not stored or sent to a clinical system.";
  source.appendChild(guard);
  recordGrid.appendChild(source);
  v.appendChild(recordGrid);
}

const PAGES = [
  { id: "consult", label: "Consult", zh: "问诊", step: "01", render: renderConsult },
  { id: "order", label: "Orders", zh: "开检查", step: "02", render: renderOrders },
  { id: "result", label: "Results", zh: "查结果", step: "03", render: renderResults },
  { id: "record", label: "Record", zh: "写病历", step: "04", render: renderRecord },
];

function buildNav() {
  const nav = $("#nav");
  nav.innerHTML = "";
  PAGES.forEach((page) => {
    const item = document.createElement("button");
    item.className = "nav-item";
    item.type = "button";
    item.dataset.id = page.id;
    item.innerHTML = `<span class="nav-step">${page.step}</span><span class="nav-copy"><strong>${page.label}</strong><small>${page.zh}</small></span>`;
    item.addEventListener("click", () => { window.location.hash = page.id; });
    nav.appendChild(item);
  });
}

function route() {
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
    $("#view").innerHTML = `<div class="error-state"><strong>Demo data could not be loaded.</strong><p>${esc(error.message)}</p></div>`;
  }
})();
