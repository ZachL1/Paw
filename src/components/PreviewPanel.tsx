import type { HistoryItem } from "../App";

interface PreviewPanelProps {
  item: HistoryItem | null;
  content: string | null;
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

function countLines(text: string): number {
  return text.split("\n").length;
}

function parseDimensions(title: string): string | null {
  const match = title.match(/(\d+)\s*x\s*(\d+)/i);
  return match ? `${match[1]}×${match[2]}` : null;
}

function PreviewPanel({ item, content }: PreviewPanelProps) {
  if (!item) {
    return (
      <div className="w-72 border-l border-white/10 flex items-center justify-center text-white/25 text-sm transition-all duration-200 ease-in-out">
        No item selected
      </div>
    );
  }

  const isImage = item.content_type === "image";
  const isDataImage = content?.startsWith("data:image/");
  const textContent = content || item.title;
  const charCount = textContent.length;
  const lineCount = countLines(textContent);
  const dimensions = isImage ? parseDimensions(item.title) : null;

  return (
    <div className="w-72 border-l border-white/10 flex flex-col transition-all duration-200 ease-in-out">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-1.5">
        <span className="text-white/50 text-xs">
          {isImage ? "🖼 Image" : "📄 Text"}
        </span>
        {item.is_pinned && <span className="text-[11px]" title="Pinned">📌</span>}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {isDataImage ? (
          <div className="flex flex-col items-center gap-2">
            <div className="bg-white/5 rounded-lg p-2 border border-white/5">
              <img
                src={content ?? undefined}
                alt="clipboard image"
                className="max-w-full max-h-[300px] object-contain rounded"
              />
            </div>
            {dimensions && (
              <span className="text-white/30 text-[11px]">{dimensions}</span>
            )}
          </div>
        ) : isImage ? (
          <div className="flex flex-col items-center gap-1 py-4">
            <span className="text-white/20 text-2xl">🖼</span>
            <span className="text-white/30 text-[11px]">
              Image{dimensions ? ` · ${dimensions}` : ""}
            </span>
          </div>
        ) : (
          <pre className="text-white/80 text-[13px] whitespace-pre-wrap break-words font-mono leading-[1.6]">
            {textContent}
          </pre>
        )}
      </div>

      {/* Metadata */}
      <div className="px-3 py-2 border-t border-white/10 grid grid-cols-2 gap-x-2 gap-y-0.5 text-white/40 text-[11px]">
        <span>Type</span>
        <span className="text-right">
          {isImage ? `Image${dimensions ? ` (${dimensions})` : ""}` : "Text"}
        </span>
        <span>Copied</span>
        <span className="text-right">
          {item.copy_count} time{item.copy_count !== 1 ? "s" : ""}
        </span>
        <span>Last</span>
        <span className="text-right">{timeAgo(item.last_copied_at)}</span>
        {!isImage && (
          <>
            <span>Size</span>
            <span className="text-right">
              {lineCount} line{lineCount !== 1 ? "s" : ""} · {charCount} char{charCount !== 1 ? "s" : ""}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export default PreviewPanel;
