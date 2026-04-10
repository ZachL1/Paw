import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen, emit } from "@tauri-apps/api/event";
import { WebviewWindow, appWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
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
const PREVIEW_WIDTH = 480;
const PREVIEW_GAP = 8;

function App() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewWindowRef = useRef<WebviewWindow | null>(null);
  const previewVisibleRef = useRef(false);
  const previewRequestId = useRef(0);

  const loadHistory = useCallback(async () => {
    try {
      const history = await invoke<HistoryItem[]>("get_history");
      setItems(history);
    } catch (e) {
      console.error("Failed to load history:", e);
    }
  }, []);

  // Hide preview window
  const hidePreview = useCallback(async () => {
    previewVisibleRef.current = false;
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    const pw = previewWindowRef.current;
    if (pw) {
      try {
        await pw.hide();
      } catch {
        // window may already be closed
      }
    }
  }, []);

  // Create or get the preview window
  const getOrCreatePreviewWindow = useCallback(async (): Promise<WebviewWindow> => {
    const existing = WebviewWindow.getByLabel("preview");
    if (existing) {
      previewWindowRef.current = existing;
      return existing;
    }

    const pw = new WebviewWindow("preview", {
      url: "index.html?preview=1",
      decorations: false,
      transparent: true,
      width: PREVIEW_WIDTH,
      height: 400,
      visible: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focus: false,
      resizable: false,
    });

    previewWindowRef.current = pw;

    // Redirect focus back to main window if preview gets focused
    pw.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        appWindow.setFocus();
      }
    });

    // Wait for the window to be created
    await new Promise<void>((resolve) => {
      pw.once("tauri://created", () => resolve());
      pw.once("tauri://error", () => resolve());
    });

    return pw;
  }, []);

  // Position and show preview window next to main window
  const showPreviewAt = useCallback(async (item: HistoryItem) => {
    const requestId = ++previewRequestId.current;

    try {
      // Load full content
      const content = await invoke<string>("get_item_content", { id: item.id });
      if (previewRequestId.current !== requestId) return;

      // Send preview data
      const previewData = {
        content,
        content_type: item.content_type,
        title: item.title,
        is_pinned: item.is_pinned,
        first_copied_at: item.first_copied_at,
        last_copied_at: item.last_copied_at,
        copy_count: item.copy_count,
      };

      const pw = await getOrCreatePreviewWindow();
      if (previewRequestId.current !== requestId) return;

      // Get main window position and size
      const pos = await appWindow.outerPosition();
      const size = await appWindow.outerSize();
      const monitor = await appWindow.currentMonitor();

      if (!monitor) return;

      const scaleFactor = monitor.scaleFactor || 1;
      const screenWidth = monitor.size.width / scaleFactor;
      const screenLeft = monitor.position.x / scaleFactor;

      const mainX = pos.x / scaleFactor;
      const mainY = pos.y / scaleFactor;
      const mainW = size.width / scaleFactor;
      const mainH = size.height / scaleFactor;

      // Decide: show to left or right of main window
      const spaceRight = (screenLeft + screenWidth) - (mainX + mainW);
      const spaceLeft = mainX - screenLeft;
      const previewW = PREVIEW_WIDTH;

      let previewX: number;
      if (spaceRight >= previewW + PREVIEW_GAP) {
        // Show to the right
        previewX = mainX + mainW + PREVIEW_GAP;
      } else if (spaceLeft >= previewW + PREVIEW_GAP) {
        // Show to the left
        previewX = mainX - previewW - PREVIEW_GAP;
      } else {
        // Default: right, even if it goes off screen slightly
        previewX = mainX + mainW + PREVIEW_GAP;
      }

      // Calculate preview height - match main window height
      const previewH = Math.min(mainH, monitor.size.height / scaleFactor - 40);

      await pw.setSize(new LogicalSize(previewW, previewH));
      await pw.setPosition(new LogicalPosition(previewX, mainY));

      // Emit preview data to the preview window
      await emit("preview-update", previewData);

      if (!previewVisibleRef.current) {
        await pw.show();
        previewVisibleRef.current = true;
        // Immediately refocus main window
        await appWindow.setFocus();
      }
    } catch (e) {
      console.error("Failed to show preview:", e);
    }
  }, [getOrCreatePreviewWindow]);

  // Schedule preview after delay
  const schedulePreview = useCallback((item: HistoryItem | undefined) => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }

    if (!item) {
      hidePreview();
      return;
    }

    // If preview is already visible, update immediately (no delay for navigation)
    if (previewVisibleRef.current) {
      showPreviewAt(item);
      return;
    }

    previewTimerRef.current = setTimeout(() => {
      showPreviewAt(item);
    }, PREVIEW_DELAY_MS);
  }, [showPreviewAt, hidePreview]);

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

  // Trigger preview when selection changes
  useEffect(() => {
    schedulePreview(filteredItems[selectedIndex]);
  }, [selectedIndex, filteredItems, schedulePreview]);

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const maxIndex = filteredItems.length - 1;

      switch (true) {
        case e.key === "ArrowDown" || ((e.ctrlKey || (isMac && e.metaKey)) && e.key === "n"):
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, maxIndex));
          break;
        case e.key === "ArrowUp" || ((e.ctrlKey || (isMac && e.metaKey)) && e.key === "p"):
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
          if (filteredItems[selectedIndex]) {
            handleTogglePin(filteredItems[selectedIndex].id);
          }
          break;
        case (e.key === "Delete" || (isMac && e.key === "Backspace")) && e.altKey:
          e.preventDefault();
          if (filteredItems[selectedIndex]) {
            handleDelete(filteredItems[selectedIndex].id);
          }
          break;
        case e.key === "," && (e.ctrlKey || (isMac && e.metaKey)):
          e.preventDefault();
          setShowSettings((s) => !s);
          break;
        case e.key >= "1" && e.key <= "9" && (isMac ? e.metaKey : e.ctrlKey): {
          e.preventDefault();
          const n = parseInt(e.key, 10);
          const unpinnedStart = filteredItems.findIndex((item) => !item.is_pinned);
          if (unpinnedStart !== -1) {
            const targetIndex = unpinnedStart + (n - 1);
            if (targetIndex < filteredItems.length && !filteredItems[targetIndex].is_pinned) {
              setSelectedIndex(targetIndex);
              handleSelect(filteredItems[targetIndex]);
            }
          }
          break;
        }
      }
    },
    [filteredItems, selectedIndex, handleSelect, handleDelete, handleTogglePin, hidePreview]
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
            onHover={setSelectedIndex}
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
