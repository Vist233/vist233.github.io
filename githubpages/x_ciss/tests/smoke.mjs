import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const CISS_ROOT = resolve(REPO_ROOT, "githubpages/x_ciss");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEFAULT_SCREENSHOT_DIR = resolve(REPO_ROOT, "tmp/ciss-cn-consult");

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

function mimeType(path) {
  return ({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webp": "image/webp",
  })[extname(path).toLowerCase()] || "application/octet-stream";
}

function createStaticServer() {
  return createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      const relative = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
      const candidate = resolve(REPO_ROOT, relative);
      if (!candidate.startsWith(`${REPO_ROOT}/`) || !existsSync(candidate)) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const filePath = relative.endsWith("/") ? join(candidate, "index.html") : candidate;
      const body = await readFile(filePath);
      response.writeHead(200, { "content-type": mimeType(filePath), "cache-control": "no-store" });
      response.end(body);
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });
}

async function listen(server, port = 0) {
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolvePromise);
  });
  return server.address().port;
}

async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}

async function waitFor(predicate, timeout = 10000, label = "condition") {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await predicate()) return;
    await sleep(50);
  }
  throw new Error(`等待${label}超时`);
}

class CdpClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.sessionId = null;
    this.nextId = 0;
    this.pending = new Map();
    this.ready = new Promise((resolvePromise, reject) => {
      this.ws.addEventListener("open", resolvePromise, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  async call(method, params = {}) {
    await this.ready;
    const id = ++this.nextId;
    const message = { id, method, params };
    if (this.sessionId) message.sessionId = this.sessionId;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.ws.send(JSON.stringify(message));
    });
  }

  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "页面脚本执行失败");
    return result.result?.value;
  }

  close() {
    this.ws.close();
  }
}

async function launchBrowser(url) {
  assert.equal(existsSync(CHROME), true, `找不到 Chrome：${CHROME}`);
  const debugPort = await freePort();
  const userDataDir = await mkdtemp(join(tmpdir(), "ciss-cn-smoke-chrome-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    url,
  ], { stdio: ["ignore", "ignore", "ignore"] });
  let client;
  try {
    const versionUrl = `http://127.0.0.1:${debugPort}/json/version`;
    await waitFor(async () => {
      try { return (await fetch(versionUrl)).ok; } catch { return false; }
    }, 10000, "Chrome 调试端点");
    const version = await (await fetch(versionUrl)).json();
    client = new CdpClient(version.webSocketDebuggerUrl);
    const requestedUrl = new URL(url);
    let pageTarget;
    await waitFor(async () => {
      const targets = await client.call("Target.getTargets");
      pageTarget = targets.targetInfos.find((target) => {
        if (target.type !== "page" || !target.url) return false;
        try {
          const targetUrl = new URL(target.url);
          return targetUrl.origin === requestedUrl.origin && targetUrl.pathname === requestedUrl.pathname;
        } catch { return false; }
      });
      return Boolean(pageTarget);
    }, 10000, "Chrome 页面目标");
    const attached = await client.call("Target.attachToTarget", { targetId: pageTarget.targetId, flatten: true });
    client.sessionId = attached.sessionId;
    await client.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await waitFor(async () => Boolean(await client.evaluate("window.__CISS_TEST__?.ready && document.querySelector('.consult-status')")), 10000, "CISS 初始页面");
    return { chrome, client };
  } catch (error) {
    client?.close();
    chrome.kill("SIGTERM");
    throw error;
  }
}

async function reloadPage(client, label = "页面刷新") {
  await client.evaluate("location.reload()");
  await waitFor(async () => Boolean(await client.evaluate("window.__CISS_TEST__?.ready && document.querySelector('.patient-context')")), 10000, label);
}

async function goTo(client, hash, selector, label) {
  await client.evaluate(`window.location.hash = ${JSON.stringify(hash)}`);
  await waitFor(async () => Boolean(await client.evaluate(`window.location.hash === ${JSON.stringify(hash)} && document.querySelector(${JSON.stringify(selector)})`)), 5000, label);
}

async function snapshot(client) {
  return client.evaluate("window.__CISS_TEST__.snapshot()");
}

function assertChineseNavigation(current) {
  assert.deepEqual(current.navLabels, ["问诊", "开检查", "查结果", "写病历"]);
  assert.equal(current.patientName, "张三");
  assert.doesNotMatch(current.visibleText, /Live workflow|Live case|workflow|flow|read-only|READ ONLY|DETERMINISTIC LOOP|CAPTURE BUFFER/i);
}

async function runSmoke() {
  const server = createStaticServer();
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}/githubpages/x_ciss/`;
  let chrome;
  let client;
  try {
    const pageResponse = await fetch(baseUrl);
    assert.equal(pageResponse.status, 200, "CISS 首页必须返回 HTTP 200");
    const [indexSource, appSource, stylesSource, ...jsonSources] = await Promise.all([
      readFile(resolve(CISS_ROOT, "index.html"), "utf8"),
      readFile(resolve(CISS_ROOT, "app.js"), "utf8"),
      readFile(resolve(CISS_ROOT, "styles.css"), "utf8"),
      ...["abnormal_summary", "order_check_rules", "orders_ranked", "patient", "sidebar_support", "similar_cases", "transcript"].map((name) => readFile(resolve(CISS_ROOT, `data/${name}.json`), "utf8")),
    ]);
    for (const source of jsonSources) JSON.parse(source);
    for (const label of ["问诊", "开检查", "查结果", "写病历", "张三"]) assert.match(indexSource, new RegExp(label));
    assert.doesNotMatch(indexSource, /Live workflow|Live case|workflow|flow|read-only|READ ONLY|DETERMINISTIC LOOP|CAPTURE BUFFER/i);
    for (const forbidden of ["navigator.mediaDevices", "getUserMedia", "localStorage", "sessionStorage", "XMLHttpRequest"]) {
      assert.doesNotMatch(appSource, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `不应存在 ${forbidden}`);
    }
    assert.doesNotMatch(appSource, /fetch\s*\(\s*["'`]https?:/i, "不应请求外部地址");
    assert.doesNotMatch(`${indexSource}\n${appSource}\n${stylesSource}`, /[\u{1F000}-\u{1FAFF}]/u, "产品界面源代码不应含 emoji");
    const recordingGradient = stylesSource.match(/\.recording-cell\s*\{[^}]*gradient[^}]*\}/s);
    assert.ok(recordingGradient, "录音方格应包含唯一允许的渐变");
    assert.doesNotMatch(stylesSource.replace(recordingGradient[0], ""), /gradient/i, "渐变只能存在于录音方格");
    assert.doesNotMatch(stylesSource, /box-shadow/i, "不应存在装饰性阴影");

    ({ chrome, client } = await launchBrowser(baseUrl));
    const initial = await snapshot(client);
    assert.equal(initial.hash, "#consult");
    assert.equal(initial.consultConsole, true);
    assertChineseNavigation(initial);
    assert.equal(initial.recordingCells, 12);
    assert.match(initial.visibleText, /录音输入中 · 模拟演示/);
    assert.equal(initial.orderSearch, false);
    assert.equal(initial.recordTextarea, false);
    assert.equal(initial.horizontalOverflow, false);
    const frameAtStart = initial.recordingFrame;
    await sleep(750);
    const frameLater = await snapshot(client);
    assert.notEqual(frameLater.recordingFrame, frameAtStart, "正常模式下录音方格应发生变化");

    await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await reloadPage(client, "reduced-motion 页面");
    const reducedBefore = await snapshot(client);
    await sleep(350);
    const reducedAfter = await snapshot(client);
    assert.equal(reducedBefore.reducedMotion, true);
    assert.equal(reducedBefore.recordingTimerRunning, false);
    assert.equal(reducedAfter.recordingFrame, reducedBefore.recordingFrame);
    assert.deepEqual(reducedAfter.recordingLevels, reducedBefore.recordingLevels);

    await client.call("Emulation.setEmulatedMedia", { features: [] });
    await reloadPage(client, "正常模式页面");

    await goTo(client, "#order", "#order-search", "开检查页面");
    const filtered = await client.evaluate(`(() => { const input = document.querySelector("#order-search"); input.value = "CRP"; input.dispatchEvent(new Event("input", { bubbles: true })); return document.querySelectorAll(".order-item").length; })()`);
    assert.equal(filtered, 1, "搜索应筛出一个检查项目");
    await client.evaluate(`(() => { const input = document.querySelector("#order-search"); input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    for (const name of ["C反应蛋白 (CRP)", "降钙素原 (PCT)"]) {
      const selected = await client.evaluate(`(() => { const label = [...document.querySelectorAll(".order-item")].find((item) => item.textContent.includes(${JSON.stringify(name)})); if (!label) return false; label.querySelector("input").click(); return true; })()`);
      assert.equal(selected, true, `应能选择 ${name}`);
    }
    const selectedOrders = await snapshot(client);
    assert.equal(selectedOrders.selectedText, "已选 2 项");
    await client.evaluate("document.querySelector('#check-orders').click()");
    const review = await snapshot(client);
    assert.equal(review.modalVisible, true);
    assert.match(review.modalText, /模拟规则提示/);
    assert.match(review.modalText, /冲突/);
    await client.evaluate("document.querySelector('#m-back').click()");
    await waitFor(async () => !(await snapshot(client)).modalVisible, 2000, "关闭模拟规则提示");
    await client.evaluate(`(() => { const label = [...document.querySelectorAll(".order-item")].find((item) => item.textContent.includes("降钙素原 (PCT)")); label.querySelector("input").click(); })()`);
    assert.equal((await snapshot(client)).selectedText, "已选 1 项");

    await goTo(client, "#result", ".finding-row", "查结果页面");
    await waitFor(async () => {
      const current = await snapshot(client);
      return current.reportImages.length >= 1 && current.reportImages.every((image) => image.complete && image.width > 0);
    }, 5000, "模拟报告图片");
    const results = await snapshot(client);
    assert.ok(results.resultRows >= 2);
    assert.equal(results.reportImages.length >= 1, true);
    assert.equal(results.reportImages.every((image) => image.complete && image.width > 0), true);

    await goTo(client, "#record", ".record-textarea", "写病历页面");
    const record = await snapshot(client);
    assert.equal(record.recordTextarea, true);
    assert.deepEqual(record.recordActions, ["复制病历", "打印病历", "导出病历"]);
    const edited = await client.evaluate(`(() => { const textarea = document.querySelector(".record-textarea"); textarea.value += "\\n补充：本地测试修改。"; textarea.dispatchEvent(new Event("input", { bubbles: true })); return textarea.value.includes("本地测试修改"); })()`);
    assert.equal(edited, true);
    await client.evaluate("document.querySelector('[data-record-action=copy]').click()");
    await waitFor(async () => /病历已复制/.test((await snapshot(client)).visibleText), 2000, "复制反馈");
    await client.evaluate(`(() => { window.__cissPrinted = false; window.open = () => ({ document: { write() {}, close() {} }, print() { window.__cissPrinted = true; } }); document.querySelector('[data-record-action=print]').click(); })()`);
    assert.equal(await client.evaluate("window.__cissPrinted"), true, "打印动作必须使用 stub");
    await client.evaluate("document.querySelector('[data-record-action=export]').click()");
    await waitFor(async () => /病历已导出/.test((await snapshot(client)).visibleText), 2000, "导出反馈");
    const networkAndStorage = await client.evaluate(`(() => ({
      external: performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => { try { return new URL(name).origin !== location.origin; } catch { return false; } }),
      localStorageLength: localStorage.length,
      sessionStorageLength: sessionStorage.length,
    }))()`);
    assert.deepEqual(networkAndStorage.external, []);
    assert.equal(networkAndStorage.localStorageLength, 0);
    assert.equal(networkAndStorage.sessionStorageLength, 0);

    await client.evaluate("window.location.hash = '#consult'");
    await waitFor(async () => Boolean(await client.evaluate("window.location.hash === '#consult' && document.querySelector('[data-recording-grid]')")), 5000, "返回问诊页面");
    await client.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await reloadPage(client, "桌面截图页面");
    const desktop = await snapshot(client);
    assert.equal(desktop.horizontalOverflow, false);
    const screenshotDir = process.env.CISS_SCREENSHOT_DIR || DEFAULT_SCREENSHOT_DIR;
    const desktopPath = join(screenshotDir, "ciss-cn-consult-1440x900.png");
    if (process.argv.includes("--screenshots")) {
      await mkdir(dirname(desktopPath), { recursive: true });
      const image = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
      await writeFile(desktopPath, Buffer.from(image.data, "base64"));
    }

    await client.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await reloadPage(client, "手机截图页面");
    const mobile = await snapshot(client);
    assert.equal(mobile.horizontalOverflow, false);
    const mobilePath = join(screenshotDir, "ciss-cn-consult-390x844.png");
    if (process.argv.includes("--screenshots")) {
      await mkdir(dirname(mobilePath), { recursive: true });
      const image = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
      await writeFile(mobilePath, Buffer.from(image.data, "base64"));
    }

    console.log(JSON.stringify({
      route: baseUrl,
      defaultHash: initial.hash,
      gates: { "0": "passed", "1": "passed", "2": "passed", "3": "passed", "4": "passed", "5": "passed" },
      desktop: { viewport: "1440x900", horizontalOverflow: desktop.horizontalOverflow },
      mobile: { viewport: "390x844", horizontalOverflow: mobile.horizontalOverflow },
      screenshots: process.argv.includes("--screenshots") ? [desktopPath, mobilePath] : [],
    }, null, 2));
  } finally {
    client?.close();
    chrome?.kill("SIGTERM");
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

runSmoke().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
