import { forwardRef, useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { HistoryItem } from "../App";
import { isMac, isLinux } from "../utils/platform";

interface HistoryListProps {
  items: HistoryItem[];
  selectedIndex: number;
  onSelect: (item: HistoryItem) => void;
  onDelete: (id: number) => void;
  onTogglePin: (id: number) => void;
  onHover?: (index: number) => void;
  searchQuery?: string;
}

const ITEM_HEIGHT = 24;
const DIVIDER_HEIGHT = 7;

/** Highlight matching substring in text (case-insensitive) */
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 1) {
    return <>{text}</>;
  }
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-400/30 text-yellow-200 rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

const HistoryList = forwardRef<HTMLDivElement, HistoryListProps>(
  ({ items, selectedIndex, onSelect, onDelete, onTogglePin, onHover, searchQuery }, ref) => {
    const scrollRef = useRef<HTMLDivElement>(null);

    const pinnedCount = useMemo(
      () => items.filter((i) => i.is_pinned).length,
      [items]
    );

    // Precompute unpinned indices and shortcut numbers
    const unpinnedIndices = useMemo(() => {
      const map = new Map<number, number>();
      let idx = 0;
      for (let i = 0; i < items.length; i++) {
        if (!items[i].is_pinned) {
          map.set(i, idx++);
        }
      }
      return map;
    }, [items]);

    const virtualizer = useVirtualizer({
      count: items.length,
      getScrollElement: () => scrollRef.current,
      estimateSize: (index) => {
        const hasDivider = pinnedCount > 0 && index === pinnedCount;
        return ITEM_HEIGHT + (hasDivider ? DIVIDER_HEIGHT : 0);
      },
      overscan: 10,
    });

    // Scroll selected item into view
    useEffect(() => {
      if (items.length > 0 && selectedIndex >= 0 && selectedIndex < items.length) {
        virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
      }
    }, [selectedIndex, items.length, virtualizer]);

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

    return (
      <div ref={(node) => {
        // Forward both refs
        (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }} className="flex-1 overflow-y-auto py-0.5">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const index = virtualRow.index;
            const item = items[index];
            const showDivider = pinnedCount > 0 && index === pinnedCount;
            const currentUnpinnedIndex = unpinnedIndices.get(index) ?? -1;
            const shortcutNum =
              currentUnpinnedIndex >= 0 && currentUnpinnedIndex < 9
                ? currentUnpinnedIndex + 1
                : null;

            return (
              <div
                key={item.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {showDivider && (
                  <div className="section-divider" />
                )}
                <div
                  className={`
                    group px-2 py-0.5 mx-1 rounded cursor-pointer flex items-center gap-1.5
                    ${isLinux ? "" : "transition-colors duration-100"}
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

                  {/* Thumbnail for images only */}
                  {item.content_type === "image" && item.thumbnail ? (
                    <img
                      src={`data:image/png;base64,${item.thumbnail}`}
                      alt="clipboard image"
                      className="w-7 h-5 object-cover rounded flex-shrink-0"
                    />
                  ) : item.content_type === "file" ? (
                    <span className="text-white/30 text-xs flex-shrink-0 w-4 text-center">
                      📁
                    </span>
                  ) : null}

                  {/* Title with search highlighting */}
                  <span className="text-white/90 text-[13px] truncate flex-1 leading-tight">
                    <HighlightedText text={item.title || "(empty)"} query={searchQuery ?? ""} />
                  </span>

                  {/* Shortcut badge for first 9 unpinned items */}
                  {shortcutNum !== null && (
                    <span className="text-white/30 text-[10px] font-mono bg-white/8 px-1 rounded flex-shrink-0 leading-none py-[1px]">
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
      </div>
    );
  }
);

HistoryList.displayName = "HistoryList";

export default HistoryList;
