/** 视频格式/画质 */
export interface VideoFormat {
  id: string;
  resolution: string;
  width: number;
  height: number;
  quality: string;
  ext: string;
  filesize: number;
  filesizeFormatted: string;
  vcodec?: string;
  acodec?: string;
  tbr?: number;
  /** B 站专用 */
  qn?: number;
  needLogin?: boolean;
}

/** btch 引擎的多画质链接 */
export interface BtchLink {
  url: string;
  quality: string;
}

/** 解析返回的单个媒体项 */
export interface Media {
  index: number;
  url: string;
  thumbnail: string;
  fileName: string;
  type: "video" | "image" | "unknown";
  width: number;
  height: number;
  aspectRatio: string;
  resolution: string;
  quality: string;
  duration?: number;
  title?: string;
  formats: VideoFormat[];
  bestFormatId: string | null;

  // ── 引擎标记 ──
  /** btch 引擎解析，下载时走 CDN 直链 */
  isBtch?: boolean;
  /** btch 引擎同视频不同画质的链接列表 */
  _links?: BtchLink[];

  // ── B 站专用 ──
  _bvid?: string;
  _cid?: number;
  _aid?: number;

  // ── 内部标记 ──
  /** 解析时使用的原始 URL（用于历史匹配） */
  _parseUrl?: string;
}

/** 解析结果（引擎返回） */
export interface ParseResult {
  success: boolean;
  engine: string;
  error?: string;
  media: Media[];
  _fallback?: boolean;
  _ytError?: string;
}

/** 历史记录 */
export interface HItem {
  id: string;
  time: string;
  url: string;
  title: string;
  platform: string;
  status: string;
  resolution?: string;
  thumbnail?: string;
  filePath?: string;
  size?: number;
  name?: string;
  /** UI 计算字段 */
  _local?: boolean;
}

/** 下载队列项 */
export interface QItem {
  id: number;
  media: Media | null;
  format: string | null;
  status: "queued" | "downloading" | "done" | "failed" | "cancelled" | "paused";
  pct: number;
  filePath?: string;
  error?: string;
  isBtch?: boolean;
  _bvid?: string;
  _cid?: number;
}

/** 下载进度事件 */
export interface DownloadProgress {
  index: number;
  fileName: string;
  percent: number;
  totalSize?: string;
  speed?: string;
  eta?: string;
}

/** 下载完成事件 */
export interface DownloadComplete {
  index: number;
  fileName: string;
  filePath: string;
  size: number;
  originalUrl?: string;
}

/** 下载错误事件 */
export interface DownloadError {
  index: number;
  fileName: string;
  error: string;
  filePath?: string;
}

/** 引擎信息 */
export interface EngineInfo {
  engine: string;
  ytDlpExists: boolean;
  downloadPath: string;
}

/** 本地文件信息 */
export interface LocalFile {
  name: string;
  path: string;
  size: number;
  time: string;
}

/** 应用设置 */
export interface AppSettings {
  downloadPath: string;
  defaultQuality?: string;
  useProxy?: boolean;
  proxyUrl?: string;
  cookies?: Record<string, string>;
  activated?: boolean;
  activatedAt?: string;
  activatedCode?: string;
  activatedExpiresAt?: string;
}
