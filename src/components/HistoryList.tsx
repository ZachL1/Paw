import { forwardRef, useEffect, useRef } from "react";
import type { HistoryItem } from "../App";

interface HistoryListProps {
  items: HistoryItem[];
  selectedIndex: number;
  onSelect: (item: HistoryItem) => void;
  onDelete: (id: number) => void;
  onTogglePin: (id: number) => void;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr + "Z");
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

const HistoryList = forwardRef<HTMLDivElement, HistoryListProps>(
  ({ items, selectedIndex, onSelect, onDelete, onTogglePin }, ref) => {
    const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
      itemRefs.current[selectedIndex]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }, [selectedIndex]);

    if (items.length === 0) {
      return (
        <div
          ref={ref}
          className="flex-1 flex items-center justify-center text-white/30 text-sm"
        >
          <div className="text-center">
            <div className="text-2xl mb-2">📋</div>
            <div>No clipboard history</div>
            <div className="text-xs mt-1">Copy something to get started</div>
          </div>
        </div>
      );
    }

    return (
      <div ref={ref} className="flex-1 overflow-y-auto py-1">
        {items.map((item, index) => (
          <div
            key={item.id}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            className={`
              group px-3 py-1.5 mx-1 rounded cursor-pointer flex items-center gap-2
              transition-colors duration-75
              ${index === selectedIndex ? "item-selected" : "hover:bg-white/5"}
            `}
            onClick={() => onSelect(item)}
            onDoubleClick={(e) => {
              e.preventDefault();
              onTogglePin(item.id);
            }}
          >
            {/* Pin indicator */}
            {item.is_pinned && (
              <span className="text-amber-400 text-xs flex-shrink-0">📌</span>
            )}

            {/* Content type icon / thumbnail */}
            {item.content_type === "image" && item.thumbnail ? (
              <img
                src={`data:image/png;base64,${item.thumbnail}`}
                alt="clipboard image"
                className="w-8 h-6 object-cover rounded flex-shrink-0"
              />
            ) : (
              <span className="text-white/30 text-xs flex-shrink-0 w-4 text-center">
                {item.content_type === "image" && "🖼"}
                {item.content_type === "file" && "📁"}
                {item.content_type === "text" && ""}
              </span>
            )}

            {/* Title */}
            <span className="text-white/90 text-sm truncate flex-1 leading-snug">
              {item.title || "(empty)"}
            </span>

            {/* Time ago */}
            <span className="text-white/20 text-xs flex-shrink-0">
              {timeAgo(item.last_copied_at)}
            </span>

            {/* Copy count badge */}
            {item.copy_count > 1 && (
              <span className="text-white/20 text-[10px] bg-white/5 px-1 rounded flex-shrink-0">
                ×{item.copy_count}
              </span>
            )}

            {/* Delete button (visible on hover) */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(item.id);
              }}
              className="text-white/0 group-hover:text-white/30 hover:!text-red-400 text-xs flex-shrink-0 transition-colors"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    );
  }
);

HistoryList.displayName = "HistoryList";

export default HistoryList;
