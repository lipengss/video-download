/**
 * VideoDL — Unified single-page logic
 */
const api = window.electronAPI;
const $ = (id) => document.getElementById(id);

// DOM
const urlInput = $("urlInput"),
  clearInputBtn = $("clearInputBtn"),
  pasteBtn = $("pasteBtn");
const downloadBtn = $("downloadBtn"),
  statusBox = $("statusBox");
const cookiesRow = $("cookiesRow"),
  cookiesFileBtn = $("cookiesFileBtn"),
  cookiesFileLabel = $("cookiesFileLabel");
const cookiesHelpBtn = $("cookiesHelpBtn"),
  cookiesHelp = $("cookiesHelp"),
  cookiesHelpClose = $("cookiesHelpClose");
const previewCard = $("previewCard"),
  previewThumb = $("previewThumb");
const piPlatform = $("piPlatform"),
  piTitle = $("piTitle"),
  piMeta = $("piMeta");
const formatBar = $("formatBar"),
  queueCard = $("queueCard"),
  queueList = $("queueList");
const historyList = $("historyList"),
  openFolderBtn = $("openFolderBtn"),
  clearHistoryBtn = $("clearHistoryBtn");
const settingsBtn = $("settingsBtn"),
  settingsOverlay = $("settingsOverlay");
const settingsClose = $("settingsClose"),
  downloadPathInput = $("downloadPathInput"),
  changeDirBtn = $("changeDirBtn");

// State
let parsedMedia = null,
  selectedFormat = null,
  cookiesMode = "none",
  cookiesFile = null,
  queue = [];

// ── Platform ────────────────────────────────────────────
const PLATFORMS = [
  { name: "bilibili", label: "B站", icon: "B", cls: "bili", test: /bilibili\.com|b23\.tv/i },
  { name: "douyin", label: "抖音", icon: "抖", cls: "douyin", test: /douyin\.com|v\.douyin/i },
  { name: "instagram", label: "IG", icon: "I", cls: "ig", test: /instagram\.com/i },
  { name: "youtube", label: "YT", icon: "Y", cls: "yt", test: /youtube\.com|youtu\.be/i },
  { name: "tiktok", label: "TT", icon: "T", cls: "tt", test: /tiktok\.com/i },
  { name: "twitter", label: "X", icon: "X", cls: "tw", test: /twitter\.com|x\.com/i },
];
function detect(u) {
  return PLATFORMS.find((p) => p.test.test(u)) || { name: "other", label: "?", cls: "other" };
}

// ── Utils ───────────────────────────────────────────────
function fmt(b) {
  if (!b) return "?";
  const m = b / 1048576;
  return m >= 1 ? m.toFixed(1) + "MB" : (b / 1024).toFixed(0) + "KB";
}
function clean(u) {
  const m = (u || "").match(/https?:\/\/[^\s]+/i);
  return m ? m[0].split("?")[0].replace(/\/+$/, "") : "";
}
function show(msg, cls) {
  statusBox.textContent = msg;
  statusBox.className = "status-bar status-" + (cls || "loading");
  statusBox.classList.remove("hidden");
}
function hide() {
  statusBox.classList.add("hidden");
}
function isCookieErr(m) {
  return /cookie|login|logged.in|auth|为空/.test(m);
}
function esc(s) {
  return (s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ── Settings ────────────────────────────────────────────
settingsBtn.addEventListener("click", () => settingsOverlay.classList.remove("hidden"));
settingsClose.addEventListener("click", () => settingsOverlay.classList.add("hidden"));
changeDirBtn.addEventListener("click", async () => {
  const r = await api.selectDir();
  if (r.path) {
    downloadPathInput.value = r.path;
    await api.saveSettings({ downloadPath: r.path });
  }
});
async function loadSettings() {
  const s = await api.getSettings();
  downloadPathInput.value = s.downloadPath || "";
}

// ── Cookies ─────────────────────────────────────────────
document.querySelectorAll("input[name='cMode']").forEach((r) => {
  r.addEventListener("change", () => {
    cookiesMode = r.value;
    cookiesFileBtn.disabled = cookiesMode !== "file";
  });
});
cookiesFileBtn.addEventListener("click", async () => {
  const r = await api.selectCookiesFile();
  if (r.path) {
    cookiesFile = r.path;
    cookiesFileLabel.textContent = r.path.split(/[\\/]/).pop();
  }
});
cookiesHelpBtn.addEventListener("click", () => cookiesHelp.classList.toggle("hidden"));
cookiesHelpClose.addEventListener("click", () => cookiesHelp.classList.add("hidden"));

// ── Input Clear ─────────────────────────────────────────
urlInput.addEventListener("input", () => clearInputBtn.classList.toggle("hidden", !urlInput.value));
clearInputBtn.addEventListener("click", () => {
  urlInput.value = "";
  clearInputBtn.classList.add("hidden");
  resetUI();
});
function resetUI() {
  hide();
  previewCard.classList.add("hidden");
  queueCard.classList.add("hidden");
  cookiesRow.classList.add("hidden");
  cookiesHelp.classList.add("hidden");
  parsedMedia = null;
}

// ── Preview ─────────────────────────────────────────────
function renderPreview(m) {
  const p = detect(urlInput.value);
  piPlatform.textContent = p.label;
  piPlatform.className = "pv-platform " + p.cls;
  piTitle.textContent = m.fileName;
  piTitle.title = m.fileName;
  const tags = [];
  if (m.resolution && m.resolution !== "未知") tags.push(m.resolution);
  if (m.aspectRatio && m.aspectRatio !== "未知") tags.push(m.aspectRatio);
  if (m.duration) {
    const mn = Math.floor(m.duration / 60),
      s = String(Math.floor(m.duration % 60)).padStart(2, "0");
    tags.push(mn + ":" + s);
  }
  piMeta.innerHTML = tags.map((t) => `<span>${t}</span>`).join("");
  previewThumb.innerHTML = "";
  if (m.thumbnail) {
    const ratio = m.width && m.height ? m.width / m.height : 16 / 9;
    let tw = 120,
      th = tw / ratio;
    if (th > 80) {
      th = 80;
      tw = th * ratio;
    }
    previewThumb.style.width = Math.round(tw) + "px";
    previewThumb.style.height = Math.round(th) + "px";
    previewThumb.innerHTML = `<img src="${m.thumbnail}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML=''">`;
  }
  previewCard.classList.remove("hidden");
}

function renderFormats(fmts) {
  formatBar.innerHTML = "";
  if (!fmts || fmts.length <= 1) {
    formatBar.classList.add("hidden");
    return;
  }
  formatBar.classList.remove("hidden");
  const labels = ["最高画质", "中等画质", "流畅画质", "画质4", "画质5"];
  fmts.forEach((f, i) => {
    const b = document.createElement("button");
    b.className = "fmt-btn" + (i === 0 ? " active" : "");
    b.textContent =
      (f.quality && !f.quality.startsWith("Quality") ? f.quality : labels[i] || "画质" + (i + 1)) +
      (f.filesizeFormatted ? " · " + f.filesizeFormatted : "");
    b.addEventListener("click", () => {
      formatBar.querySelectorAll(".fmt-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      selectedFormat = f.id;
    });
    formatBar.appendChild(b);
  });
  selectedFormat = fmts[0]?.id || null;
}

// ── Queue ───────────────────────────────────────────────
function addQ(fn) {
  const id = Date.now();
  queue.push({ id, fileName: fn, status: "waiting", pct: 0 });
  renderQ();
  return id;
}
function updQ(id, u) {
  const q = queue.find((x) => x.id === id);
  if (q) Object.assign(q, u);
  renderQ();
}
function renderQ() {
  if (queue.length === 0) {
    queueCard.classList.add("hidden");
    return;
  }
  queueCard.classList.remove("hidden");
  queueList.innerHTML = queue
    .map((q) => {
      const c = q.status === "done" ? "done" : q.status === "fail" ? "fail" : "";
      const bc = q.status === "done" ? "done" : q.status === "fail" ? "fail" : "";
      const act =
        q.status === "done" && q.filePath
          ? `<div class="qi-acts"><button class="btn-inline" data-open="${esc(q.filePath)}">打开</button></div>`
          : "";
      return `<div class="q-item ${c}">
      <div class="qi-top"><span class="qi-name">${q.fileName}</span><span class="qi-status">${q.status === "waiting" ? "等待" : q.status === "downloading" ? "下载中" : q.status === "done" ? "完成" : "失败"}</span></div>
      <div class="qbar-o"><div class="qbar-i ${bc}" style="width:${q.pct}%"></div></div>
      ${act}
    </div>`;
    })
    .join("");
  queueList
    .querySelectorAll("[data-open]")
    .forEach((b) =>
      b.addEventListener("click", () => api.openFile(b.dataset.open.replace(/\\\\/g, "\\").replace(/\\'/g, "'"))),
    );
}

// ── History ─────────────────────────────────────────────
async function loadHistory() {
  const hist = await api.getHistory();
  if (!hist || hist.length === 0) {
    historyList.innerHTML =
      '<div class="empty-state"><div class="empty-mark">↓</div><p>粘贴链接，下载的视频会出现在这里</p></div>';
    return;
  }
  historyList.innerHTML = hist
    .map((r) => {
      const p = detect(r.url || "");
      const sCls = r.status === "downloaded" ? "done" : r.status === "failed" ? "fail" : "waiting";
      const sLabel = r.status === "downloaded" ? "完成" : r.status === "failed" ? "失败" : "待下载";
      const dlBtn =
        r.status === "parsed" || !r.filePath
          ? `<button class="h-btn" data-dl="${esc(r.url || "")}" title="下载">↓</button>`
          : `<button class="h-btn" data-open="${esc(r.filePath)}" title="打开">▶</button>`;
      return `<div class="h-item">
      <div class="h-dot ${p.cls}"></div>
      <div class="h-info"><div class="h-title">${r.title || r.name || r.url || "?"}</div><div class="h-meta">${p.label} · ${r.resolution || fmt(r.size)} · ${new Date(r.time).toLocaleString("zh-CN")}</div></div>
      <span class="h-status ${sCls}">${sLabel}</span>
      <div class="h-acts">${dlBtn}<button class="h-btn del" data-del="${r.id}" title="删除">×</button></div>
    </div>`;
    })
    .join("");
  historyList.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      await api.deleteHistory(b.dataset.del);
      loadHistory();
    }),
  );
  historyList
    .querySelectorAll("[data-open]")
    .forEach((b) => b.addEventListener("click", () => api.openFile(b.dataset.open)));
  historyList.querySelectorAll("[data-dl]").forEach((b) =>
    b.addEventListener("click", () => {
      urlInput.value = b.dataset.dl;
      clearInputBtn.classList.remove("hidden");
      handleUrl(b.dataset.dl);
    }),
  );
}
clearHistoryBtn.addEventListener("click", async () => {
  await api.clearHistory();
  loadHistory();
});
openFolderBtn.addEventListener("click", () => api.openFolder());

// ── Core: Parse ─────────────────────────────────────────
async function handleUrl(raw) {
  const url = clean(raw);
  if (!url) {
    show("未找到有效链接", "error");
    return;
  }
  hide();
  cookiesRow.classList.add("hidden");
  cookiesHelp.classList.add("hidden");
  show("解析中…", "loading");
  resetUI();
  parsedMedia = null;

  const opts = {};
  if (cookiesMode === "file" && cookiesFile) opts.cookiesFile = cookiesFile;
  const result = await api.parseUrl(url, opts);

  if (result.error) {
    show(result.error, "error");
    if (isCookieErr(result.error)) cookiesRow.classList.remove("hidden");
    const p = detect(url);
    await api.addHistory({
      url,
      title: url,
      platform: p.name,
      status: "failed",
      resolution: result.error.substring(0, 80),
    });
    loadHistory();
    return;
  }

  parsedMedia = result.media?.[0];
  if (!parsedMedia) {
    show("未找到媒体文件", "error");
    return;
  }
  const fb = result._fallback ? ` · 引擎: ${result.engine}` : "";
  show(`解析完成${fb}`, "success");
  renderPreview(parsedMedia);
  renderFormats(parsedMedia.formats);
  downloadBtn.disabled = false;

  const p = detect(url);
  await api.addHistory({
    url,
    title: parsedMedia.fileName,
    platform: p.name,
    status: "parsed",
    resolution: parsedMedia.resolution,
    thumbnail: parsedMedia.thumbnail,
  });
  loadHistory();
}

// ── Core: Download ──────────────────────────────────────
async function startDownload() {
  if (!parsedMedia) return;
  const cOpts = {};
  if (cookiesMode === "file" && cookiesFile) cOpts.cookiesFile = cookiesFile;
  let dlUrl = parsedMedia.url;
  if (parsedMedia.isBtch && parsedMedia._links && selectedFormat) {
    const idx = parseInt((selectedFormat || "q0").replace("q", ""));
    if (parsedMedia._links[idx]) dlUrl = parsedMedia._links[idx].url;
  }

  downloadBtn.disabled = true;
  downloadBtn.querySelector("span").textContent = "⏳ 下载中…";
  const qid = addQ(parsedMedia.fileName);
  updQ(qid, { status: "downloading" });
  hide();

  const result = await api.startDownload({
    url: dlUrl,
    formatId: selectedFormat || parsedMedia.bestFormatId,
    index: 0,
    isBtch: parsedMedia.isBtch || false,
    _bvid: parsedMedia._bvid,
    _cid: parsedMedia._cid,
    ...cOpts,
  });
  if (result.success) updQ(qid, { status: "done", pct: 100, filePath: result.filePath, size: result.size });
  else updQ(qid, { status: "fail", pct: 100 });
  downloadBtn.disabled = false;
  downloadBtn.querySelector("span").textContent = "⬇ 下载视频";
  loadHistory();
}

// ── Events ──────────────────────────────────────────────
api.onDownloadProgress((d) => {
  const q = queue.find((x) => x.status === "downloading");
  if (q) updQ(q.id, { pct: d.percent });
});
api.onDownloadComplete((d) => {
  const q = queue.find((x) => x.status === "downloading");
  if (q) updQ(q.id, { status: "done", pct: 100, filePath: d.filePath, size: d.size });
  loadHistory();
});
api.onDownloadError((d) => {
  const q = queue.find((x) => x.status === "downloading");
  if (q) updQ(q.id, { status: "fail", pct: 100 });
});

urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleUrl(urlInput.value);
  }
  if (e.key === "Escape") {
    urlInput.value = "";
    clearInputBtn.classList.add("hidden");
    resetUI();
  }
});
pasteBtn.addEventListener("click", async () => {
  try {
    const t = await navigator.clipboard.readText();
    if (t) {
      urlInput.value = t;
      clearInputBtn.classList.remove("hidden");
      handleUrl(t);
    }
  } catch {
    urlInput.focus();
  }
});
downloadBtn.addEventListener("click", startDownload);
document.addEventListener("paste", (e) => {
  if (document.activeElement === urlInput) return;
  const t = e.clipboardData?.getData("text") || "";
  if (/https?:\/\//.test(t)) {
    e.preventDefault();
    urlInput.value = t;
    clearInputBtn.classList.remove("hidden");
    handleUrl(t);
  }
});

// ── Init ────────────────────────────────────────────────
(async () => {
  await loadSettings();
  loadHistory();
  try {
    const i = await api.getEngineInfo();
    if (!i.ytDlpExists) show("⚠ yt-dlp 引擎未找到", "error");
  } catch {}
})();
