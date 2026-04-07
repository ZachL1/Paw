import { forwardRef, useEffect, useRef } from "react";
import type { HistoryItem } from "../App";

interface HistoryListProps {
  items: HistoryItem[];
  selectedIndex: number;
  onSelect: (item: HistoryItem) => void;
  onDelete: (id: number) => void;
}

const HistoryList = forwardRef<HTMLDivElement, HistoryListProps>(
  ({ items, selectedIndex, onSelect, onDelete }, ref) => {
    const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

    // Scroll selected item into view
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
          No clipboard history
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
              px-3 py-1.5 mx-1 rounded cursor-pointer flex items-center gap-2
              transition-colors duration-75
              ${index === selectedIndex ? "item-selected" : "hover:bg-white/5"}
            `}
            onClick={() => onSelect(item)}
            onContextMenu={(e) => {
              e.preventDefault();
              onDelete(item.id);
            }}
          >
            {/* Pin indicator */}
            {item.is_pinned && (
              <span className="text-yellow-400 text-xs flex-shrink-0">📌</span>
            )}

            {/* Content type icon */}
            <span className="text-white/30 text-xs flex-shrink-0">
              {item.content_type === "image" ? "🖼" : ""}
              {item.content_type === "file" ? "📁" : ""}
            </span>

            {/* Title */}
            <span className="text-white/90 text-sm truncate flex-1">
              {item.title}
            </span>

            {/* Source app */}
            {item.source_app && (
              <span className="text-white/20 text-xs flex-shrink-0 truncate max-w-[80px]">
                {item.source_app}
              </span>
            )}

            {/* Copy count */}
            {item.copy_count > 1 && (
              <span className="text-white/20 text-xs flex-shrink-0">
                ×{item.copy_count}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }
);

HistoryList.displayName = "HistoryList";

export default HistoryList;
