/**
 * 持久化存储模块
 */

const fs = require("fs");
const path = require("path");

function loadJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* ignore */
  }
  return fallback;
}

function saveJSON(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

class Storage {
  constructor(userDataPath) {
    this._settingsFile = path.join(userDataPath, "settings.json");
    this._historyFile = path.join(userDataPath, "history.json");
    this._cacheDir = path.join(userDataPath, "thumb_cache");
    ensureDir(this._cacheDir);
  }

  getSettings() {
    return loadJSON(this._settingsFile, { downloadPath: path.join(path.dirname(this._settingsFile), "downloads") });
  }

  saveSettings(s) {
    saveJSON(this._settingsFile, s);
  }

  getHistory() {
    return loadJSON(this._historyFile, []);
  }

  saveHistory(h) {
    saveJSON(this._historyFile, h);
  }

  get cacheDir() {
    return this._cacheDir;
  }

  get settingsFile() {
    return this._settingsFile;
  }

  get historyFile() {
    return this._historyFile;
  }
}

module.exports = { Storage, loadJSON, saveJSON, ensureDir };
