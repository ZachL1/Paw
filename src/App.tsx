import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import Fuse from "fuse.js";
import SearchBar from "./components/SearchBar";
import HistoryList from "./components/HistoryList";
import PreviewPanel from "./components/PreviewPanel";
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
}

function App() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(async () => {
    try {
      const history = await invoke<HistoryItem[]>("get_history");
      setItems(history);
    } catch (e) {
      console.error("Failed to load history:", e);
    }
  }, []);

  useEffect(() => {
    loadHistory();
    const unlistenClipboard = listen("clipboard-changed", () => {
      loadHistory();
    });
    const unlistenShown = listen("window-shown", () => {
      loadHistory();
      setQuery("");
      setSelectedIndex(0);
      setShowPreview(false);
      setShowSettings(false);
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
  }, [loadHistory]);

  // Fuzzy search with Fuse.js
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

  // Load preview content when selection changes
  useEffect(() => {
    if (showPreview && filteredItems[selectedIndex]) {
      invoke<string>("get_item_content", { id: filteredItems[selectedIndex].id })
        .then(setPreviewContent)
        .catch(() => setPreviewContent(null));
    }
  }, [selectedIndex, showPreview, filteredItems]);

  const handleSelect = useCallback(async (item: HistoryItem) => {
    try {
      await invoke("paste_item", { id: item.id });
    } catch (e) {
      console.error("Failed to paste:", e);
    }
  }, []);

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const maxIndex = filteredItems.length - 1;

      switch (true) {
        case e.key === "ArrowDown" || (e.ctrlKey && e.key === "n"):
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, maxIndex));
          break;
        case e.key === "ArrowUp" || (e.ctrlKey && e.key === "p"):
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case e.key === "Enter":
          e.preventDefault();
          if (filteredItems[selectedIndex]) {
            handleSelect(filteredItems[selectedIndex]);
          }
          break;
        case e.key === "Escape":
          e.preventDefault();
          if (showPreview) {
            setShowPreview(false);
          } else {
            invoke("hide_window");
          }
          break;
        case e.ctrlKey && e.key === "u":
          e.preventDefault();
          setQuery("");
          setSelectedIndex(0);
          break;
        case e.key === "ArrowRight":
          e.preventDefault();
          setShowPreview(true);
          break;
        case e.key === "ArrowLeft":
          e.preventDefault();
          setShowPreview(false);
          break;
        case e.altKey && e.key === "p":
          e.preventDefault();
          if (filteredItems[selectedIndex]) {
            handleTogglePin(filteredItems[selectedIndex].id);
          }
          break;
        case e.key === "Delete" && e.altKey:
          e.preventDefault();
          if (filteredItems[selectedIndex]) {
            handleDelete(filteredItems[selectedIndex].id);
          }
          break;
        case e.key === "," && e.ctrlKey:
          e.preventDefault();
          setShowSettings((s) => !s);
          break;
      }
    },
    [filteredItems, selectedIndex, handleSelect, handleDelete, handleTogglePin, showPreview]
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

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
        className="h-5 flex-shrink-0 flex items-center justify-center cursor-move"
      >
        <div className="w-8 h-1 rounded-full bg-white/20" />
      </div>

      {showSettings ? (
        <SettingsView onClose={() => setShowSettings(false)} />
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Main panel */}
          <div className="flex flex-col flex-1 min-w-0">
            <SearchBar
              query={query}
              onQueryChange={setQuery}
              itemCount={filteredItems.length}
            />
            <HistoryList
              ref={listRef}
              items={filteredItems}
              selectedIndex={selectedIndex}
              onSelect={handleSelect}
              onDelete={handleDelete}
              onTogglePin={handleTogglePin}
            />
            <Footer
              itemCount={filteredItems.length}
              onClearAll={handleClearAll}
              showPreview={showPreview}
            />
          </div>

          {/* Preview panel */}
          {showPreview && (
            <PreviewPanel
              item={filteredItems[selectedIndex] || null}
              content={previewContent}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default App;
