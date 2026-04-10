import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import Fuse from "fuse.js";
import { isMac } from "./utils/platform";
import SearchBar from "./components/SearchBar";
import HistoryList from "./components/HistoryList";
import SettingsView from "./components/SettingsView";
import Footer from "./components/Footer";

export interface HistoryItem {
  id: number;
  content_type: string;
  content: string | null;
  title: string;
  source_app: string | null;
  first_copied_at: string;
  last_copied_at: string;
  copy_count: number;
  is_pinned: boolean;
  thumbnail: string | null;
}

const PREVIEW_DELAY_MS = 500;
const PREVIEW_MIN_W = 280;
const PREVIEW_MAX_W = 560;
const PREVIEW_MIN_H = 120;
const PREVIEW_MAX_H = 600;
const METADATA_BAR_H = 40;
const PADDING = 32; // p-4 top + bottom

function computeSizeHint(item: HistoryItem, content: string): { w: number; h: number } {
  if (item.content_type === "image") {
    // Parse dimensions from title like "1920 x 1080 image"
    const match = item.title.match(/(\d+)\s*x\s*(\d+)/i);
    if (match) {
      const imgW = parseInt(match[1], 10);
      const imgH = parseInt(match[2], 10);
      const aspect = imgW / imgH;
      // Fit image within max bounds, preserving aspect ratio
      let w = Math.min(imgW, PREVIEW_MAX_W);
      let h = w / aspect + METADATA_BAR_H + PADDING;
      if (h > PREVIEW_MAX_H) {
        h = PREVIEW_MAX_H;
        w = (h - METADATA_BAR_H - PADDING) * aspect;
      }
      w = Math.max(w, PREVIEW_MIN_W);
      h = Math.max(h, PREVIEW_MIN_H);
      return { w: Math.round(w), h: Math.round(h) };
    }
    return { w: 400, h: 350 };
  }

  // Text content: size based on line count and max line length
  const lines = content.split("\n");
  const lineCount = lines.length;
  const maxLineLen = Math.max(...lines.map(l => l.length));

  // Width: based on longest line (13px font, ~7.8px per char mono)
  const charW = 7.8;
  const textW = Math.min(Math.max(maxLineLen * charW + PADDING, PREVIEW_MIN_W), PREVIEW_MAX_W);

  // Height: ~20px per line + padding + metadata
  const lineH = 20;
  const textH = Math.min(Math.max(lineCount * lineH + PADDING + METADATA_BAR_H, PREVIEW_MIN_H), PREVIEW_MAX_H);

  return { w: Math.round(textW), h: Math.round(textH) };
}

function App() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewVisibleRef = useRef(false);
  const previewRequestId = useRef(0);
  const previewItemIdRef = useRef<number | null>(null);
  const filteredItemsRef = useRef<HistoryItem[]>([]);
  // Cache full content by item id to avoid repeated IPC calls
  const contentCacheRef = useRef<Map<number, string>>(new Map());

  const loadHistory = useCallback(async () => {
    try {
      const history = await invoke<HistoryItem[]>("get_history");
      setItems(history);
      contentCacheRef.current.clear();
    } catch (e) {
      console.error("Failed to load history:", e);
    }
  }, []);

  const hidePreview = useCallback(() => {
    previewVisibleRef.current = false;
    previewItemIdRef.current = null;
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    invoke("hide_preview").catch(() => {});
  }, []);

  const showPreviewFor = useCallback(async (item: HistoryItem) => {
    if (previewItemIdRef.current === item.id && previewVisibleRef.current) {
      return;
    }
    previewItemIdRef.current = item.id;
    const requestId = ++previewRequestId.current;

    try {
      const cached = contentCacheRef.current.get(item.id);
      const content = cached
        ? cached
        : item.content_type === "image" && item.thumbnail
          ? "data:image/png;base64," + item.thumbnail
          : item.title;

      // Calculate size hint based on content
      const sizeHint = computeSizeHint(item, content);

      const previewData = {
        content,
        content_type: item.content_type,
        title: item.title,
        is_pinned: item.is_pinned,
        first_copied_at: item.first_copied_at,
        last_copied_at: item.last_copied_at,
        copy_count: item.copy_count,
      };

      await invoke("show_preview", { data: previewData, sizeHint });
      previewVisibleRef.current = true;

      if (cached) return;
      if (previewRequestId.current !== requestId) return;

      const fullContent = await invoke<string>("get_item_content", { id: item.id });
      if (previewRequestId.current !== requestId) return;

      contentCacheRef.current.set(item.id, fullContent);
      const fullSizeHint = computeSizeHint(item, fullContent);
      await invoke("show_preview", { data: { ...previewData, content: fullContent }, sizeHint: fullSizeHint });
    } catch (e) {
      console.error("Failed to show preview:", e);
    }
  }, []);

  // Trigger preview for a given item — called explicitly from keyboard/hover
  const triggerPreview = useCallback((item: HistoryItem | undefined) => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    if (!item) {
      hidePreview();
      return;
    }
    if (previewVisibleRef.current) {
      showPreviewFor(item);
    } else {
      previewTimerRef.current = setTimeout(() => {
        showPreviewFor(item);
      }, PREVIEW_DELAY_MS);
    }
  }, [showPreviewFor, hidePreview]);

  useEffect(() => {
    loadHistory();
    const unlistenClipboard = listen("clipboard-changed", () => {
      loadHistory();
    });
    const unlistenShown = listen("window-shown", () => {
      loadHistory();
      setQuery("");
      setSelectedIndex(0);
      setShowSettings(false);
      hidePreview();
      setTimeout(() => {
        containerRef.current?.focus();
      }, 50);
    });
    const unlistenSettings = listen("show-settings", () => {
      setShowSettings(true);
    });
    return () => {
      unlistenClipboard.then((fn) => fn());
      unlistenShown.then((fn) => fn());
      unlistenSettings.then((fn) => fn());
    };
  }, [loadHistory, hidePreview]);

  // Fuzzy search
  const fuse = useRef(
    new Fuse<HistoryItem>([], {
      keys: ["title"],
      threshold: 0.4,
      includeScore: true,
    })
  );

  useEffect(() => {
    fuse.current.setCollection(items);
  }, [items]);

  const filteredItems = query
    ? fuse.current.search(query).map((r) => r.item)
    : items;

  // Keep ref in sync
  filteredItemsRef.current = filteredItems;

  const handleSelect = useCallback(async (item: HistoryItem) => {
    try {
      hidePreview();
      await invoke("paste_item", { id: item.id });
    } catch (e) {
      console.error("Failed to paste:", e);
    }
  }, [hidePreview]);

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        await invoke("delete_item", { id });
        await loadHistory();
      } catch (e) {
        console.error("Failed to delete:", e);
      }
    },
    [loadHistory]
  );

  const handleTogglePin = useCallback(
    async (id: number) => {
      try {
        await invoke("toggle_pin", { id });
        await loadHistory();
      } catch (e) {
        console.error("Failed to toggle pin:", e);
      }
    },
    [loadHistory]
  );

  const handleClearAll = useCallback(async () => {
    try {
      await invoke("clear_history");
      await loadHistory();
    } catch (e) {
      console.error("Failed to clear:", e);
    }
  }, [loadHistory]);

  // Hover triggers selection change + preview
  const handleHover = useCallback((index: number) => {
    setSelectedIndex(index);
    triggerPreview(filteredItemsRef.current[index]);
  }, [triggerPreview]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const curItems = filteredItemsRef.current;
      const maxIndex = curItems.length - 1;

      switch (true) {
        case e.key === "ArrowDown" || ((e.ctrlKey || (isMac && e.metaKey)) && e.key === "n"): {
          e.preventDefault();
          const newIdx = Math.min(selectedIndex + 1, maxIndex);
          setSelectedIndex(newIdx);
          triggerPreview(curItems[newIdx]);
          break;
        }
        case e.key === "ArrowUp" || ((e.ctrlKey || (isMac && e.metaKey)) && e.key === "p"): {
          e.preventDefault();
          const newIdx = Math.max(selectedIndex - 1, 0);
          setSelectedIndex(newIdx);
          triggerPreview(curItems[newIdx]);
          break;
        }
        case e.key === "Enter":
          e.preventDefault();
          if (curItems[selectedIndex]) {
            handleSelect(curItems[selectedIndex]);
          }
          break;
        case e.key === "Escape":
          e.preventDefault();
          if (previewVisibleRef.current) {
            hidePreview();
          } else {
            invoke("hide_window");
          }
          break;
        case (e.ctrlKey || (isMac && e.metaKey)) && e.key === "u":
          e.preventDefault();
          setQuery("");
          setSelectedIndex(0);
          break;
        case e.altKey && (e.key === "p" || e.code === "KeyP"):
          e.preventDefault();
          if (curItems[selectedIndex]) {
            handleTogglePin(curItems[selectedIndex].id);
          }
          break;
        case (e.key === "Delete" || (isMac && e.key === "Backspace")) && e.altKey:
          e.preventDefault();
          if (curItems[selectedIndex]) {
            handleDelete(curItems[selectedIndex].id);
          }
          break;
        case e.key === "," && (e.ctrlKey || (isMac && e.metaKey)):
          e.preventDefault();
          setShowSettings((s) => !s);
          break;
        case e.key >= "1" && e.key <= "9" && (isMac ? e.metaKey : e.ctrlKey): {
          e.preventDefault();
          const n = parseInt(e.key, 10);
          const unpinnedStart = curItems.findIndex((item) => !item.is_pinned);
          if (unpinnedStart !== -1) {
            const targetIndex = unpinnedStart + (n - 1);
            if (targetIndex < curItems.length && !curItems[targetIndex].is_pinned) {
              setSelectedIndex(targetIndex);
              handleSelect(curItems[targetIndex]);
            }
          }
          break;
        }
      }
    },
    [selectedIndex, handleSelect, handleDelete, handleTogglePin, hidePreview, triggerPreview]
  );

  useEffect(() => {
    setSelectedIndex(0);
    hidePreview();
  }, [query, hidePreview]);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="glass-bg h-full flex flex-col rounded-lg border border-white/10 outline-none overflow-hidden"
      onKeyDown={handleKeyDown}
    >
      {/* Drag handle */}
      <div
        data-tauri-drag-region
        className="h-4 flex-shrink-0 flex items-center justify-center cursor-move"
      >
        <div className="w-6 h-0.5 rounded-full bg-white/20" />
      </div>

      {showSettings ? (
        <SettingsView onClose={() => setShowSettings(false)} />
      ) : (
        <div className="flex flex-col flex-1 min-h-0">
          <SearchBar
            query={query}
            onQueryChange={setQuery}
          />
          <HistoryList
            ref={listRef}
            items={filteredItems}
            selectedIndex={selectedIndex}
            onSelect={handleSelect}
            onDelete={handleDelete}
            onTogglePin={handleTogglePin}
            onHover={handleHover}
          />
          <Footer
            itemCount={filteredItems.length}
            onClearAll={handleClearAll}
          />
        </div>
      )}
    </div>
  );
}

export default App;
