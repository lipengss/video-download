import { Captions, FolderOpen, Globe, Key, Settings, X } from "lucide-react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { PLATFORMS, QUALITIES } from "../lib/constants";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  dlPath: string;
  defaultQuality: string;
  cookiesMap: Record<string, string>;
  useProxy: boolean;
  proxyUrl: string;
  writeSubs: boolean;
  poToken: string;
  potStatus: { running: boolean; version?: string | null } | null;
  onStartPot: () => void;
  onDlPathChange: (path: string) => void;
  onDefaultQualityChange: (quality: string) => void;
  onCookiesChange: (cookies: Record<string, string>) => void;
  onUseProxyChange: (use: boolean) => void;
  onProxyUrlChange: (url: string) => void;
  onWriteSubsChange: (v: boolean) => void;
  onPoTokenChange: (v: string) => void;
  onSave: () => void;
  onSelectDir: () => Promise<{ path: string | null }>;
  onPickCookies: (name: string) => Promise<void>;
}

export function SettingsPanel({
  open,
  onClose,
  dlPath,
  defaultQuality,
  cookiesMap,
  useProxy,
  proxyUrl,
  writeSubs,
  poToken,
  potStatus,
  onStartPot,
  onDlPathChange,
  onDefaultQualityChange,
  onCookiesChange,
  onUseProxyChange,
  onProxyUrlChange,
  onWriteSubsChange,
  onPoTokenChange,
  onSave,
  onSelectDir,
  onPickCookies,
}: SettingsPanelProps) {
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/45" onClick={onClose} />}
      <div
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-[360px] flex-col border-l border-white/[0.08] bg-[#131d2d]  transition-transform duration-200",
          !open && "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Settings className="h-4 w-4" />
            <span className="text-sm font-bold">设置</span>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <OverlayScrollbarsComponent
          className="flex-1 p-5"
          options={{ scrollbars: { autoHide: "leave", theme: "os-theme-light" } }}
        >
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[1.6px] text-[#627895]">下载设置</p>
          <div className="mb-4">
            <span className="mb-1.5 block text-xs text-[#a8b5cb]">保存路径</span>
            <div className="flex gap-2">
              <input
                value={dlPath}
                readOnly
                className="h-10 min-w-0 flex-1 rounded-[12px] border border-white/[0.08] bg-[#1d2a40] px-3 text-xs outline-none"
              />
              <Button
                variant="outline"
                onClick={async () => {
                  const r = await onSelectDir();
                  if (r.path) onDlPathChange(r.path);
                }}
                className="h-10 rounded-[12px] border-white/[0.08] bg-[#1d2a40] px-3 text-xs"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                浏览
              </Button>
            </div>
          </div>
          <p className="mb-2 text-xs text-[#a8b5cb]">默认画质</p>
          <div className="mb-6 grid grid-cols-2 gap-2">
            {QUALITIES.map((q) => (
              <button
                key={q}
                onClick={() => onDefaultQualityChange(q)}
                className={cn(
                  "h-10 rounded-[12px] text-xs font-semibold",
                  defaultQuality === q ? "bg-[#4e73ff]" : "border border-white/[0.07] bg-[#1d2a40] text-[#788dab]",
                )}
              >
                {q}
              </button>
            ))}
          </div>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[1.6px] text-[#627895]">字幕</p>
          <div className="mb-6 space-y-2 rounded-[12px] bg-[#172236] px-3 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Captions className="h-4 w-4 text-[#8ea0bd]" />
                <span className="text-xs">同时下载字幕</span>
              </div>
              <button
                onClick={() => onWriteSubsChange(!writeSubs)}
                className={cn("relative h-6 w-11 rounded-full", writeSubs ? "bg-[#4e73ff]" : "bg-[#2a3952]")}
              >
                <span
                  className={cn(
                    "absolute top-1 h-4 w-4 rounded-full bg-white transition",
                    writeSubs ? "left-6" : "left-1",
                  )}
                />
              </button>
            </div>
          </div>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[1.6px] text-[#627895]">Cookies 管理</p>
          <div className="mb-6 space-y-2">
            {PLATFORMS.map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-[12px] bg-[#172236] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: p.bg }}>
                    <img src={p.icon} className="h-4 w-4" referrerPolicy="no-referrer" />
                  </span>
                  <span className="text-xs">{p.short}</span>
                </div>
                {cookiesMap[p.name] ? (
                  <button
                    onClick={() => {
                      const next = { ...cookiesMap };
                      delete next[p.name];
                      onCookiesChange(next);
                    }}
                    className="text-[11px] text-emerald-300"
                  >
                    已配置 · 清除
                  </button>
                ) : (
                  <button onClick={() => onPickCookies(p.name)} className="text-[11px] font-semibold text-[#7f98ff]">
                    导入
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="space-y-2 rounded-[12px] bg-[#172236] px-3 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-[#8ea0bd]" />
                <span className="text-xs">启用代理</span>
              </div>
              <button
                onClick={() => onUseProxyChange(!useProxy)}
                className={cn("relative h-6 w-11 rounded-full", useProxy ? "bg-[#4e73ff]" : "bg-[#2a3952]")}
              >
                <span
                  className={cn(
                    "absolute top-1 h-4 w-4 rounded-full bg-white transition",
                    useProxy ? "left-6" : "left-1",
                  )}
                />
              </button>
            </div>
            {useProxy && (
              <input
                value={proxyUrl}
                onChange={(e) => onProxyUrlChange(e.target.value)}
                placeholder="http://127.0.0.1:7890"
                className="h-9 w-full rounded-[10px] border border-white/[0.08] bg-[#1d2a40] px-3 text-xs outline-none"
              />
            )}
          </div>
          <p className="mb-3 mt-6 text-[11px] font-bold uppercase tracking-[1.6px] text-[#627895]">PO Token 服务</p>
          <div className="mb-4 space-y-2 rounded-[12px] bg-[#172236] px-3 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    potStatus?.running ? "bg-emerald-400" : "bg-[#5b6b85]",
                  )}
                />
                <span className="text-xs">
                  {potStatus?.running ? `已运行${potStatus.version ? ` v${potStatus.version}` : ""}` : "未运行"}
                </span>
              </div>
              {potStatus?.running ? (
                <span className="text-[11px] text-emerald-300">自动获取 PO Token</span>
              ) : (
                <button onClick={onStartPot} className="text-[11px] font-semibold text-[#7f98ff]">
                  启动服务
                </button>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-[#627895]">
              自动获取 PO Token，解决 YouTube 高清下载 403 报错。
            </p>
          </div>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[1.6px] text-[#627895]">PO Token（高级）</p>
          <div className="space-y-2 rounded-[12px] bg-[#172236] px-3 py-3">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-[#8ea0bd]" />
              <span className="text-xs">YouTube PO Token</span>
            </div>
            <input
              value={poToken}
              onChange={(e) => onPoTokenChange(e.target.value)}
              placeholder="web.gvs+…（可选）"
              className="h-9 w-full rounded-[10px] border border-white/[0.08] bg-[#1d2a40] px-3 text-xs outline-none"
            />
            <p className="text-[11px] leading-relaxed text-[#627895]">
              YouTube 高清下载需 PO Token，否则会 403 报错。推荐运行
              <span className="text-[#9fb3d6]"> bgutil-ytdlp-pot-provider </span>
              自动获取；也可手动粘贴完整 token。
            </p>
          </div>
        </OverlayScrollbarsComponent>
        <div className="border-t border-white/[0.07] p-5">
          <Button onClick={onSave} className="h-11 w-full rounded-[15px] bg-[#4e73ff]">
            保存设置
          </Button>
        </div>
      </div>
    </>
  );
}
