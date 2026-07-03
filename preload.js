const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Window controls
  minimize: () => ipcRenderer.invoke("window-minimize"),
  maximize: () => ipcRenderer.invoke("window-maximize"),
  close: () => ipcRenderer.invoke("window-close"),

  // Engine
  getEngineInfo: () => ipcRenderer.invoke("get-engine-info"),
  parseUrl: (url, opts) => ipcRenderer.invoke("parse-url", url, opts),
  startDownload: (p) => ipcRenderer.invoke("start-download", p),
  cancelDownload: () => ipcRenderer.invoke("cancel-download"),

  // Events
  onDownloadProgress: (cb) => {
    const h = (_, d) => cb(d);
    ipcRenderer.on("download-progress", h);
    return () => ipcRenderer.removeListener("download-progress", h);
  },
  onDownloadComplete: (cb) => {
    const h = (_, d) => cb(d);
    ipcRenderer.on("download-complete", h);
    return () => ipcRenderer.removeListener("download-complete", h);
  },
  onDownloadError: (cb) => {
    const h = (_, d) => cb(d);
    ipcRenderer.on("download-error", h);
    return () => ipcRenderer.removeListener("download-error", h);
  },

  // Settings
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (s) => ipcRenderer.invoke("save-settings", s),
  selectDir: () => ipcRenderer.invoke("select-dir"),

  // History (new record-based system)
  getHistory: () => ipcRenderer.invoke("get-history"),
  addHistory: (r) => ipcRenderer.invoke("add-history", r),
  updateHistory: (id, u) => ipcRenderer.invoke("update-history", id, u),
  deleteHistory: (id) => ipcRenderer.invoke("delete-history", id),
  clearHistory: () => ipcRenderer.invoke("clear-history"),

  // Thumbnail cache
  cacheThumbnail: (url) => ipcRenderer.invoke("cache-thumbnail", url),

  // Files
  deleteFile: (fp) => ipcRenderer.invoke("delete-file", fp),
  openFile: (fp) => ipcRenderer.invoke("open-file", fp),
  openFolder: () => ipcRenderer.invoke("open-folder"),
  selectCookiesFile: () => ipcRenderer.invoke("select-cookies-file"),
  listLocalFiles: () => ipcRenderer.invoke("list-local-files"),
  fileExists: (name) => ipcRenderer.invoke("file-exists", name),
});
