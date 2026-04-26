import { forwardRef, useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { HistoryItem } from "../App";
import { isMac, isLinux } from "../utils/platform";
import { translate, type ResolvedLanguage } from "../i18n";

interface HistoryListProps {
  items: HistoryItem[];
  selectedIndex: number;
  onSelect: (item: HistoryItem) => void;
  onDelete: (id: number) => void;
  onTogglePin: (id: number) => void;
  onHover?: (index: number) => void;
  searchQuery?: string;
  language: ResolvedLanguage;
}

const ITEM_HEIGHT = 24;
const IMAGE_ROW_MIN_HEIGHT = 54;
const IMAGE_ROW_MAX_HEIGHT = 172;
const IMAGE_PREVIEW_MAX_WIDTH = 520;
const IMAGE_PREVIEW_MAX_HEIGHT = 160;
const DIVIDER_HEIGHT = 7;

function parseImageDimensions(title: string): { width: number; height: number } | null {
  const match = title.match(/Image\s+(\d+)\s*[×x]\s*(\d+)/i);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
}

function getItemHeight(item: HistoryItem): number {
  if (item.content_type !== "image" || !item.thumbnail) {
    return ITEM_HEIGHT;
  }

  const dimensions = parseImageDimensions(item.title);
  if (!dimensions) {
    return 72;
  }

  const previewHeight = getImagePreviewSize(dimensions).height;
  return Math.min(IMAGE_ROW_MAX_HEIGHT, Math.max(IMAGE_ROW_MIN_HEIGHT, previewHeight + 12));
}

function getImagePreviewSize(dimensions: { width: number; height: number }) {
  const scale = Math.min(
    IMAGE_PREVIEW_MAX_WIDTH / dimensions.width,
    IMAGE_PREVIEW_MAX_HEIGHT / dimensions.height
  );

  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale)),
  };
}

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
  ({ items, selectedIndex, onSelect, onDelete, onTogglePin, onHover, searchQuery, language }, ref) => {
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
        return getItemHeight(items[index]) + (hasDivider ? DIVIDER_HEIGHT : 0);
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
            <div>{translate(language, "history.empty.title")}</div>
            <div className="text-xs mt-1">{translate(language, "history.empty.subtitle")}</div>
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
            const isImage = item.content_type === "image" && Boolean(item.thumbnail);
            const imageDimensions = isImage ? parseImageDimensions(item.title) : null;
            const imagePreviewSize = imageDimensions ? getImagePreviewSize(imageDimensions) : null;
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
                    group relative px-2 py-0.5 ml-1 mr-0.5 rounded cursor-pointer flex items-center gap-1.5
                    ${isImage ? "h-[calc(100%-1px)]" : ""}
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

                  {isImage ? (
                    <div className="min-w-0 flex-1 overflow-hidden pr-12">
                      <img
                        src={`data:image/png;base64,${item.thumbnail}`}
                        alt={translate(language, "history.imageAlt")}
                        className="block max-w-full rounded-sm object-contain object-left"
                        style={{
                          width: imagePreviewSize?.width,
                          height: imagePreviewSize?.height,
                        }}
                      />
                    </div>
                  ) : item.content_type === "file" ? (
                    <span className="text-white/30 text-xs flex-shrink-0 w-4 text-center">
                      📁
                    </span>
                  ) : null}

                  {/* Title with search highlighting */}
                  {!isImage && (
                    <span className={`text-white/90 text-[13px] truncate flex-1 leading-tight ${shortcutNum !== null ? "pr-12" : "pr-4"}`}>
                      <HighlightedText text={item.title || "(empty)"} query={searchQuery ?? ""} />
                    </span>
                  )}

                  {/* Shortcut badge for first 9 unpinned items */}
                  {shortcutNum !== null && (
                    <span className="absolute right-7 top-1/2 -translate-y-1/2 text-white/30 text-[10px] font-mono bg-white/8 px-1 rounded leading-none py-[1px]">
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
                    aria-label={translate(language, "history.delete")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/0 group-hover:text-white/30 hover:!text-red-400 text-[10px] transition-colors leading-none"
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
