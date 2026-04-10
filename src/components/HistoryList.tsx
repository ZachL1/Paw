import { forwardRef, useEffect, useMemo, useRef } from "react";
import type { HistoryItem } from "../App";
import { isMac } from "../utils/platform";

interface HistoryListProps {
  items: HistoryItem[];
  selectedIndex: number;
  onSelect: (item: HistoryItem) => void;
  onDelete: (id: number) => void;
  onTogglePin: (id: number) => void;
  onHover?: (index: number) => void;
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
  ({ items, selectedIndex, onSelect, onDelete, onTogglePin, onHover }, ref) => {
    const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
      itemRefs.current[selectedIndex]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }, [selectedIndex]);

    const pinnedCount = useMemo(
      () => items.filter((i) => i.is_pinned).length,
      [items]
    );

    if (items.length === 0) {
      return (
        <div
          ref={ref}
          className="flex-1 flex items-center justify-center text-white/30 text-sm"
        >
          <div className="text-center">
            <div>No clipboard history</div>
            <div className="text-xs mt-1">Copy something to get started</div>
          </div>
        </div>
      );
    }

    let unpinnedIndex = 0;

    return (
      <div ref={ref} className="flex-1 overflow-y-auto py-1">
        {items.map((item, index) => {
          const showDivider =
            pinnedCount > 0 && index === pinnedCount;

          // Track position among unpinned items for shortcut badges
          const currentUnpinnedIndex = item.is_pinned
            ? -1
            : unpinnedIndex++;
          const shortcutNum =
            currentUnpinnedIndex >= 0 && currentUnpinnedIndex < 9
              ? currentUnpinnedIndex + 1
              : null;

          return (
            <div key={item.id}>
              {showDivider && (
                <div className="section-divider" />
              )}
              <div
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                className={`
                  group px-3 py-1 mx-1 rounded cursor-pointer flex items-center gap-2
                  transition-colors duration-100
                  ${index === selectedIndex ? "item-selected" : "hover:bg-white/5"}
                `}
                onClick={() => onSelect(item)}
                onMouseEnter={() => onHover?.(index)}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  onTogglePin(item.id);
                }}
              >
                {/* Pin indicator */}
                {item.is_pinned && (
                  <span className="text-amber-400/60 text-[10px] flex-shrink-0 leading-none">
                    •
                  </span>
                )}

                {/* Thumbnail for images only — no placeholder for text */}
                {item.content_type === "image" && item.thumbnail ? (
                  <img
                    src={`data:image/png;base64,${item.thumbnail}`}
                    alt="clipboard image"
                    className="w-8 h-6 object-cover rounded flex-shrink-0"
                  />
                ) : item.content_type === "file" ? (
                  <span className="text-white/30 text-xs flex-shrink-0 w-4 text-center">
                    📁
                  </span>
                ) : null}

                {/* Title */}
                <span className="text-white/90 text-sm truncate flex-1 leading-snug">
                  {item.title || "(empty)"}
                </span>

                {/* Time ago */}
                <span className="text-white/15 text-xs flex-shrink-0">
                  {timeAgo(item.last_copied_at)}
                </span>

                {/* Copy count badge (only when >= 3) */}
                {item.copy_count >= 3 && (
                  <span className="text-white/20 text-[10px] bg-white/5 px-1 rounded flex-shrink-0">
                    ×{item.copy_count}
                  </span>
                )}

                {/* Shortcut badge for first 9 unpinned items */}
                {shortcutNum !== null && (
                  <span className="text-white/30 text-[10px] font-mono bg-white/8 px-1 rounded flex-shrink-0">
                    {isMac ? "⌘" : "Ctrl+"}
                    {shortcutNum}
                  </span>
                )}

                {/* Delete button (visible on hover) */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(item.id);
                  }}
                  className="text-white/0 group-hover:text-white/30 hover:!text-red-400 text-[10px] flex-shrink-0 transition-colors leading-none"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }
);

HistoryList.displayName = "HistoryList";

export default HistoryList;
