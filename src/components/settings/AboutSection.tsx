import { useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Download,
  ExternalLink,
  FileText,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTerminalStore } from "../../stores/terminalStore";
import { useUpdateStore } from "../../stores/updateStore";
import { MarkdownContent } from "../ui/MarkdownContent";
import { MARKDOWN_STYLE_SAMPLE } from "../ui/markdownSample";

export function AboutSection() {
  const {
    currentVersion,
    checking,
    updateAvailable,
    updateInfo,
    downloading,
    downloadProgress,
    downloadTotalBytes,
    downloadedBytes,
    readyToInstall,
    installing,
    lastCheckedAt,
    error,
    releaseFallbackUrl,
    fetchVersion,
    checkUpdate,
    downloadUpdate,
    installAndRelaunch,
    reset,
  } = useUpdateStore();
  const activeTerminalCount = useTerminalStore((state) =>
    state.sessions.filter((session) => {
      const status = state.sessionStatuses[session.id];
      return status !== "exited" && status !== "error";
    }).length
  );
  const [installConfirmVisible, setInstallConfirmVisible] = useState(false);

  useEffect(() => {
    if (!currentVersion) {
      fetchVersion();
    }
  }, [currentVersion, fetchVersion]);

  useEffect(() => {
    if (!readyToInstall) {
      setInstallConfirmVisible(false);
    }
  }, [readyToInstall, updateInfo?.version]);

  const handleCheckUpdate = () => {
    if (checking || downloading || installing) return;
    setInstallConfirmVisible(false);
    checkUpdate();
  };

  const handleDownloadUpdate = async () => {
    if (downloading || installing) return;
    const downloaded = await downloadUpdate();
    if (downloaded) {
      setInstallConfirmVisible(true);
    }
  };

  const handleOpenReleaseFallback = async () => {
    try {
      await openUrl(updateInfo?.downloadUrl ?? releaseFallbackUrl);
    } catch (e) {
      console.error("Failed to open release URL:", e);
    }
  };

  const handleConfirmInstall = () => {
    if (installing) return;
    installAndRelaunch();
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const formatBytes = (value: number | null) => {
    if (!value || value <= 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  };

  const canDownload = updateAvailable && updateInfo && !downloading && !readyToInstall && !installing;
  const showLatest = Boolean(lastCheckedAt && !checking && !error && !updateAvailable);
  const progressLabel = downloadTotalBytes
    ? `${downloadProgress}%（${formatBytes(downloadedBytes)} / ${formatBytes(downloadTotalBytes)}）`
    : downloadProgress > 0
      ? `${downloadProgress}%`
      : "正在下载...";

  return (
    <section className="ui-surface-card rounded-2xl border border-border p-4">
      <div className="text-sm font-semibold text-on-surface">关于</div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-on-surface-variant">版本号</span>
        <span className="rounded-md bg-surface-container-high px-2 py-0.5 font-mono text-xs font-semibold text-on-surface">
          V{currentVersion || "---"}
        </span>
      </div>

      <details className="ui-markdown-preview mt-3 rounded-xl border border-border bg-surface-container-high/40">
        <summary className="ui-focus-ring flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium text-on-surface">
          <FileText className="h-3.5 w-3.5" />
          <span>Markdown 样式预览</span>
        </summary>
        <div className="border-t border-border p-3">
          <div className="mb-2 text-[11px] font-medium text-on-surface-variant">默认样式</div>
          <MarkdownContent content={MARKDOWN_STYLE_SAMPLE} linkBehavior="preview" />

          <div className="mt-4 rounded-lg border border-[#2e2e2e] bg-[#0f0f0f] p-3">
            <div className="mb-2 text-[11px] font-medium text-[#9ca0a6]">Terminal 样式</div>
            <MarkdownContent content={MARKDOWN_STYLE_SAMPLE} variant="terminal" />
          </div>
        </div>
      </details>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={handleCheckUpdate}
          disabled={checking || downloading || installing}
          className="ui-interactive ui-focus-ring flex items-center gap-1.5 rounded-lg border border-border bg-surface-container-high px-3 py-1.5 text-xs font-medium text-on-surface transition-colors hover:bg-surface-container-highest disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={checking ? "检查中" : "检查更新"}
        >
          {checking ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span>检查中...</span>
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5" />
              <span>检查更新</span>
            </>
          )}
        </button>

        {error && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-danger">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>{error}</span>
            <button onClick={handleCheckUpdate} className="ml-1 underline hover:no-underline">
              重试
            </button>
            <button onClick={handleOpenReleaseFallback} className="ml-1 underline hover:no-underline">
              查看 Release
            </button>
          </div>
        )}

        {showLatest && (
          <div className="flex items-center gap-1 text-xs text-success">
            <Check className="h-3.5 w-3.5" />
            <span>已是最新版本</span>
          </div>
        )}
      </div>

      {updateAvailable && updateInfo && (
        <div className="mt-3 rounded-xl border border-accent/30 bg-accent/5 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-on-surface">V{updateInfo.version}</span>
                <span className="rounded-full bg-success/20 px-2 py-0.5 text-[10px] font-medium text-success">
                  新版本可用
                </span>
              </div>
              {updateInfo.releaseDate && (
                <div className="mt-1 text-xs text-on-surface-variant">
                  发布日期：{formatDate(updateInfo.releaseDate)}
                </div>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              {canDownload && (
                <button
                  onClick={handleDownloadUpdate}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>下载更新</span>
                </button>
              )}
              {readyToInstall && !installConfirmVisible && (
                <button
                  onClick={() => setInstallConfirmVisible(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-success px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  <span>安装并重启</span>
                </button>
              )}
              <button
                onClick={handleOpenReleaseFallback}
                className="flex items-center gap-1 text-xs text-on-surface-variant underline hover:no-underline"
              >
                <ExternalLink className="h-3 w-3" />
                <span>查看 Release 页面</span>
              </button>
            </div>
          </div>

          {downloading && (
            <div className="mt-3 rounded-lg border border-border/60 bg-surface-container-high/60 p-3">
              <div className="mb-2 flex items-center justify-between text-xs text-on-surface-variant">
                <span>正在下载更新</span>
                <span>{progressLabel}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-container-highest">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            </div>
          )}

          {readyToInstall && installConfirmVisible && (
            <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-danger" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-on-surface">确认安装并重启</div>
                  <div className="mt-1 text-xs text-on-surface-variant">
                    安装更新会关闭并重启 CLI-Manager。
                    {activeTerminalCount > 0
                      ? ` 当前仍有 ${activeTerminalCount} 个运行中的终端会话，继续操作会中断其中的任务。`
                      : " 请确认当前工作已保存。"}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={handleConfirmInstall}
                      disabled={installing}
                      className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {installing ? "正在安装..." : "确认安装并重启"}
                    </button>
                    <button
                      onClick={() => setInstallConfirmVisible(false)}
                      disabled={installing}
                      className="rounded-lg border border-border bg-surface-container-high px-3 py-1.5 text-xs font-medium text-on-surface transition-colors hover:bg-surface-container-highest disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      稍后
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {updateInfo.releaseNotes && (
            <div className="mt-3 border-t border-border/50 pt-3">
              <div className="mb-1 text-xs font-medium text-on-surface-variant">更新说明</div>
              <MarkdownContent content={updateInfo.releaseNotes} linkBehavior="open" />
            </div>
          )}

          <button
            onClick={reset}
            disabled={checking || downloading || installing}
            className="mt-3 text-xs text-on-surface-variant underline hover:no-underline disabled:cursor-not-allowed disabled:opacity-60"
          >
            稍后提醒
          </button>
        </div>
      )}
    </section>
  );
}
