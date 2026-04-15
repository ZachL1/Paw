import type { HistoryItem } from "../App";

interface PreviewPanelProps {
  item: HistoryItem | null;
  content: string | null;
  loading: boolean;
  placement: "left" | "right";
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

function countLines(text: string): number {
  return text.split("\n").length;
}

function parseDimensions(title: string): string | null {
  const match = title.match(/(\d+)\s*x\s*(\d+)/i);
  return match ? `${match[1]}×${match[2]}` : null;
}

function PreviewPanel({
  item,
  content,
  loading,
  placement: _placement,
}: PreviewPanelProps) {
  if (!item) {
    return (
      <div className="preview-popup h-full flex items-center justify-center text-white/25 text-sm">
        Loading preview...
      </div>
    );
  }

  const isImage = item.content_type === "image";
  const isDataImage = content?.startsWith("data:image/");
  const rawContent = content || item.content || item.title;
  const MAX_PREVIEW_CHARS = 50000;
  const truncated = rawContent.length > MAX_PREVIEW_CHARS;
  const textContent = truncated ? rawContent.slice(0, MAX_PREVIEW_CHARS) : rawContent;
  const charCount = rawContent.length;
  const lineCount = countLines(rawContent);
  const dimensions = isImage ? parseDimensions(item.title) : null;

  return (
    <div className="preview-popup h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 min-h-0">
        {isImage ? (
          loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-white/35">
              <div className="w-7 h-7 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />
              <span className="text-sm">Loading image preview...</span>
            </div>
          ) : isDataImage ? (
            <div className="flex items-center justify-center h-full w-full">
              <img
                src={content ?? undefined}
                alt="clipboard image"
                className="max-w-full max-h-full object-contain rounded"
                style={{ minHeight: 0 }}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-white/30">
              <span className="text-4xl">🖼</span>
              <span className="text-sm">
                Image{dimensions ? ` · ${dimensions}` : ""}
              </span>
            </div>
          )
        ) : (
          <pre className="text-white/85 text-[13px] whitespace-pre-wrap break-words font-mono leading-relaxed select-text">
            {textContent}
            {truncated && (
              <span className="text-white/30 italic">
                {"\n\n"}… (showing first {MAX_PREVIEW_CHARS.toLocaleString()} of {charCount.toLocaleString()} characters)
              </span>
            )}
          </pre>
        )}
      </div>

      <div className="flex-shrink-0 px-3 py-2 border-t border-white/8 bg-white/[0.02] space-y-0.5">
        {item.source_app && (
          <div className="text-white/40 text-[11px]">来源应用: {item.source_app}</div>
        )}
        <div className="text-white/40 text-[11px]">
          首次复制时间: {formatDate(item.first_copied_at)}
        </div>
        <div className="text-white/40 text-[11px]">
          上次复制时间: {formatDate(item.last_copied_at)}
        </div>
        <div className="text-white/40 text-[11px]">
          复制次数: {item.copy_count}
          {isImage && dimensions && ` · ${dimensions}`}
          {!isImage && ` · ${lineCount} 行 · ${charCount} 字符`}
          {item.is_pinned && " · 📌 已固定"}
        </div>
      </div>
    </div>
  );
}

export default PreviewPanel;
