import type { HistoryItem } from "../App";

interface PreviewPanelProps {
  item: HistoryItem | null;
  content: string | null;
}

function PreviewPanel({ item, content }: PreviewPanelProps) {
  if (!item) {
    return (
      <div className="w-64 border-l border-white/10 flex items-center justify-center text-white/20 text-sm">
        No item selected
      </div>
    );
  }

  return (
    <div className="w-64 border-l border-white/10 flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/10">
        <div className="text-white/60 text-xs font-medium truncate">
          {item.is_pinned && "📌 "}
          {item.source_app || "Unknown source"}
        </div>
        <div className="text-white/30 text-[10px] mt-0.5">
          Copied {item.copy_count} time{item.copy_count > 1 ? "s" : ""}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {item.content_type === "image" && content?.startsWith("data:image/") ? (
          <img
            src={content}
            alt="clipboard image"
            className="max-w-full rounded"
          />
        ) : (
          <pre className="text-white/80 text-xs whitespace-pre-wrap break-all font-mono leading-relaxed">
            {content || item.title}
          </pre>
        )}
      </div>

      {/* Footer hints */}
      <div className="px-3 py-1.5 border-t border-white/10 text-[10px] text-white/20">
        <kbd className="px-1 py-0.5 bg-white/10 rounded">←</kbd> close preview
      </div>
    </div>
  );
}

export default PreviewPanel;
