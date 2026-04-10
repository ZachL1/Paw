import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

interface PreviewData {
  content: string | null;
  content_type: string;
  title: string;
  is_pinned: boolean;
  first_copied_at: string;
  last_copied_at: string;
  copy_count: number;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr + "Z");
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "Z");
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PreviewPage() {
  const [data, setData] = useState<PreviewData | null>(null);

  useEffect(() => {
    const unlisten = listen<PreviewData>("preview-update", (event) => {
      setData(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  if (!data || !data.content) {
    return (
      <div className="preview-popup h-full flex items-center justify-center rounded-xl border border-white/10">
        <span className="text-white/25 text-sm">Loading...</span>
      </div>
    );
  }

  const isImage = data.content_type === "image";
  const isDataImage = data.content?.startsWith("data:image/");
  const textContent = data.content || data.title;
  const charCount = textContent.length;
  const lineCount = textContent.split("\n").length;
  const dimensions = isImage
    ? data.title.match(/(\d+)\s*x\s*(\d+)/i)
    : null;

  return (
    <div className="preview-popup h-full flex flex-col border-l border-white/10 overflow-hidden">
      {/* Content area — fills all available space */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 min-h-0">
        {isDataImage ? (
          <div className="flex items-center justify-center h-full w-full">
            <img
              src={data.content ?? undefined}
              alt="clipboard image"
              className="max-w-full max-h-full object-contain rounded"
              style={{ minHeight: 0 }}
            />
          </div>
        ) : isImage ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <span className="text-white/20 text-4xl">🖼</span>
            <span className="text-white/30 text-sm">
              Image{dimensions ? ` · ${dimensions[1]}×${dimensions[2]}` : ""}
            </span>
          </div>
        ) : (
          <pre className="text-white/85 text-[13px] whitespace-pre-wrap break-words font-mono leading-relaxed select-text">
            {textContent}
          </pre>
        )}
      </div>

      {/* Metadata — Maccy style: stacked rows */}
      <div className="flex-shrink-0 px-3 py-2 border-t border-white/8 bg-white/[0.02] space-y-0.5">
        <div className="text-white/40 text-[11px]">
          首次复制时间: {formatDate(data.first_copied_at)}
        </div>
        <div className="text-white/40 text-[11px]">
          上次复制时间: {formatDate(data.last_copied_at)}
        </div>
        <div className="text-white/40 text-[11px]">
          复制次数: {data.copy_count}
          {isImage && dimensions && ` · ${dimensions[1]}×${dimensions[2]}`}
          {!isImage && ` · ${lineCount} 行 · ${charCount} 字符`}
          {data.is_pinned && " · 📌 已固定"}
        </div>
      </div>
    </div>
  );
}

export default PreviewPage;
