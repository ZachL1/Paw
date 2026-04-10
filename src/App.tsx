import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import {
  appWindow,
  currentMonitor,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import Fuse from "fuse.js";
import { isMac } from "./utils/platform";
import SearchBar from "./components/SearchBar";
import HistoryList from "./components/HistoryList";
import SettingsView from "./components/SettingsView";
import Footer from "./components/Footer";
import PreviewPanel from "./components/PreviewPanel";

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

type PreviewPlacement = "left" | "right";

const PREVIEW_DELAY_MS = 500;
const DEFAULT_PREVIEW_WIDTH = 400;
const MIN_CONTENT_WIDTH = 340;
const MIN_PREVIEW_WIDTH = 220;
const WINDOW_ANIMATION_MS = 180;

function App() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPlacement, setPreviewPlacement] =
    useState<PreviewPlacement>("right");
  const [previewItem, setPreviewItem] = useState<HistoryItem | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [contentWidth, setContentWidth] = useState(400);
  const [previewWidth, setPreviewWidth] = useState(DEFAULT_PREVIEW_WIDTH);

  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewOpenRef = useRef(false);
  const previewPlacementRef = useRef<PreviewPlacement>("right");
  const previewWidthRef = useRef(DEFAULT_PREVIEW_WIDTH);
  const contentWidthRef = useRef(400);
  const windowAnimationTokenRef = useRef(0);
  const windowAnimatingRef = useRef(false);
  const previewRequestIdRef = useRef(0);
  const previewItemIdRef = useRef<number | null>(null);
  const filteredItemsRef = useRef<HistoryItem[]>([]);
  const contentCacheRef = useRef<Map<number, string>>(new Map());

  const loadHistory = useCallback(async () => {
    try {
      const history = await invoke<HistoryItem[]>("get_history");
      setItems(history);
    } catch (e) {
      console.error("Failed to load history:", e);
    }
  }, []);

  const syncContentWidthFromWindow = useCallback(async () => {
    if (windowAnimatingRef.current) {
      return;
    }

    try {
      const [scaleFactor, size] = await Promise.all([
        appWindow.scaleFactor(),
        appWindow.innerSize(),
      ]);
      const logicalSize = size.toLogical(scaleFactor);
      const nextContentWidth = Math.max(
        MIN_CONTENT_WIDTH,
        logicalSize.width - (previewOpenRef.current ? previewWidthRef.current : 0)
      );
      contentWidthRef.current = nextContentWidth;
      setContentWidth(nextContentWidth);
    } catch (e) {
      console.error("Failed to sync window width:", e);
    }
  }, []);

  const resolvePreviewGeometry = useCallback(
    async (): Promise<{ placement: PreviewPlacement; width: number }> => {
      try {
        const [scaleFactor, position, size, monitor] = await Promise.all([
          appWindow.scaleFactor(),
          appWindow.outerPosition(),
          appWindow.innerSize(),
          currentMonitor(),
        ]);

        const logicalPosition = position.toLogical(scaleFactor);
        const logicalSize = size.toLogical(scaleFactor);
        const screenMinX = monitor
          ? monitor.position.toLogical(monitor.scaleFactor).x
          : 0;
        const screenMaxX = monitor
          ? screenMinX + monitor.size.toLogical(monitor.scaleFactor).width
          : logicalPosition.x + logicalSize.width + DEFAULT_PREVIEW_WIDTH;

        const spaceRight = screenMaxX - (logicalPosition.x + logicalSize.width);
        const spaceLeft = logicalPosition.x - screenMinX;
        const placement: PreviewPlacement =
          spaceRight >= DEFAULT_PREVIEW_WIDTH || spaceRight >= spaceLeft
            ? "right"
            : "left";
        const maxAvailable = Math.max(spaceLeft, spaceRight);
        const width = Math.min(
          DEFAULT_PREVIEW_WIDTH,
          Math.max(240, Math.floor(maxAvailable))
        );

        return { placement, width };
      } catch (e) {
        console.error("Failed to resolve preview geometry:", e);
        return { placement: "right", width: DEFAULT_PREVIEW_WIDTH };
      }
    },
    []
  );

  const animateWindowBounds = useCallback(
    async (
      from: { x: number; y: number; width: number; height: number },
      to: { x: number; y: number; width: number; height: number }
    ) => {
      const token = ++windowAnimationTokenRef.current;
      windowAnimatingRef.current = true;

      await new Promise<void>((resolve) => {
        const start = performance.now();

        const step = (now: number) => {
          if (windowAnimationTokenRef.current !== token) {
            resolve();
            return;
          }

          const progress = Math.min(1, (now - start) / WINDOW_ANIMATION_MS);
          const eased =
            progress < 0.5
              ? 2 * progress * progress
              : 1 - Math.pow(-2 * progress + 2, 2) / 2;

          const width = from.width + (to.width - from.width) * eased;
          const x = from.x + (to.x - from.x) * eased;

          void appWindow.setSize(new LogicalSize(width, from.height));
          void appWindow.setPosition(new LogicalPosition(x, from.y));

          if (progress < 1) {
            requestAnimationFrame(step);
          } else {
            resolve();
          }
        };

        requestAnimationFrame(step);
      });

      windowAnimatingRef.current = false;
      await Promise.all([
        appWindow.setSize(new LogicalSize(to.width, to.height)),
        appWindow.setPosition(new LogicalPosition(to.x, to.y)),
      ]);
    },
    []
  );

  const resizeWindowForPreview = useCallback(
    async (open: boolean, placement: PreviewPlacement, previewWidth: number) => {
      const [scaleFactor, position, size, monitor] = await Promise.all([
        appWindow.scaleFactor(),
        appWindow.outerPosition(),
        appWindow.innerSize(),
        currentMonitor(),
      ]);

      const logicalPosition = position.toLogical(scaleFactor);
      const logicalSize = size.toLogical(scaleFactor);
      const baseWidth = open
        ? contentWidthRef.current
        : Math.max(MIN_CONTENT_WIDTH, logicalSize.width - previewWidth);
      const targetWidth = open ? baseWidth + previewWidth : baseWidth;
      let targetX = logicalPosition.x;

      if (open && placement === "left") {
        targetX -= previewWidth;
      } else if (!open && previewPlacementRef.current === "left") {
        targetX += previewWidthRef.current;
      }

      if (monitor) {
        const monitorPosition = monitor.position.toLogical(monitor.scaleFactor);
        const monitorSize = monitor.size.toLogical(monitor.scaleFactor);
        const minX = monitorPosition.x;
        const maxX = minX + monitorSize.width;
        targetX = Math.max(minX, Math.min(targetX, maxX - targetWidth));
      }

      contentWidthRef.current = baseWidth;
      setContentWidth(baseWidth);

      await animateWindowBounds(
        {
          x: logicalPosition.x,
          y: logicalPosition.y,
          width: logicalSize.width,
          height: logicalSize.height,
        },
        {
          x: targetX,
          y: logicalPosition.y,
          width: targetWidth,
          height: logicalSize.height,
        }
      );
    },
    [animateWindowBounds]
  );

  const openPreviewPanel = useCallback(async () => {
    if (previewOpenRef.current) {
      return;
    }

    const { placement, width } = await resolvePreviewGeometry();
    previewPlacementRef.current = placement;
    previewWidthRef.current = width;
    setPreviewWidth(width);
    previewOpenRef.current = true;
    setPreviewPlacement(placement);
    setPreviewOpen(true);

    try {
      await resizeWindowForPreview(true, placement, width);
    } catch (e) {
      console.error("Failed to open preview panel:", e);
    }
  }, [resolvePreviewGeometry, resizeWindowForPreview]);

  const closePreview = useCallback(async () => {
    previewRequestIdRef.current += 1;
    previewItemIdRef.current = null;
    setPreviewLoading(false);

    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }

    const wasOpen = previewOpenRef.current;
    const placement = previewPlacementRef.current;
    const width = previewWidthRef.current;

    previewOpenRef.current = false;
    setPreviewOpen(false);
    setPreviewItem(null);
    setPreviewContent(null);

    if (!wasOpen) {
      return;
    }

    try {
      await resizeWindowForPreview(false, placement, width);
    } catch (e) {
      console.error("Failed to close preview panel:", e);
    }
  }, [resizeWindowForPreview]);

  const showPreviewFor = useCallback(
    async (item: HistoryItem) => {
      const requestId = ++previewRequestIdRef.current;
      previewItemIdRef.current = item.id;
      setPreviewItem(item);

      if (!previewOpenRef.current) {
        await openPreviewPanel();
      }

      if (previewRequestIdRef.current !== requestId) {
        return;
      }

      try {
        if (item.content_type === "image") {
          const cached = contentCacheRef.current.get(item.id);
          if (cached) {
            setPreviewContent(cached);
            setPreviewLoading(false);
            return;
          }

          setPreviewContent(null);
          setPreviewLoading(true);

          const fullContent = await invoke<string>("get_item_content", {
            id: item.id,
          });
          if (previewRequestIdRef.current !== requestId) {
            return;
          }

          contentCacheRef.current.set(item.id, fullContent);
          setPreviewContent(fullContent);
          setPreviewLoading(false);
          return;
        }

        const textContent = item.content ?? item.title;
        contentCacheRef.current.set(item.id, textContent);
        setPreviewContent(textContent);
        setPreviewLoading(false);
      } catch (e) {
        if (previewRequestIdRef.current === requestId) {
          setPreviewLoading(false);
        }
        console.error("Failed to show preview:", e);
      }
    },
    [openPreviewPanel]
  );

  const triggerPreview = useCallback(
    (item: HistoryItem | undefined) => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }

      if (!item) {
        void closePreview();
        return;
      }

      if (previewOpenRef.current) {
        void showPreviewFor(item);
        return;
      }

      previewTimerRef.current = setTimeout(() => {
        void showPreviewFor(item);
      }, PREVIEW_DELAY_MS);
    },
    [closePreview, showPreviewFor]
  );

  useEffect(() => {
    void loadHistory();
    void syncContentWidthFromWindow();

    let unlistenClipboard: (() => void) | null = null;
    let unlistenShown: (() => void) | null = null;
    let unlistenSettings: (() => void) | null = null;
    let unlistenResize: (() => void) | null = null;

    void listen("clipboard-changed", () => {
      void loadHistory();
    }).then((fn) => {
      unlistenClipboard = fn;
    });

    void listen("window-shown", () => {
      void (async () => {
        await loadHistory();
        setQuery("");
        setSelectedIndex(0);
        setShowSettings(false);
        await closePreview();
        setTimeout(() => {
          containerRef.current?.focus();
        }, 50);
      })();
    }).then((fn) => {
      unlistenShown = fn;
    });

    void listen("show-settings", () => {
      setShowSettings(true);
    }).then((fn) => {
      unlistenSettings = fn;
    });

    void appWindow.onResized(() => {
      void syncContentWidthFromWindow();
    }).then((fn) => {
      unlistenResize = fn;
    });

    return () => {
      unlistenClipboard?.();
      unlistenShown?.();
      unlistenSettings?.();
      unlistenResize?.();
    };
  }, [closePreview, loadHistory, syncContentWidthFromWindow]);

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

  filteredItemsRef.current = filteredItems;

  useEffect(() => {
    if (filteredItems.length === 0) {
      setSelectedIndex(0);
      return;
    }

    if (selectedIndex > filteredItems.length - 1) {
      setSelectedIndex(filteredItems.length - 1);
    }
  }, [filteredItems.length, selectedIndex]);

  const handleSelect = useCallback(
    async (item: HistoryItem) => {
      try {
        await closePreview();
        await invoke("paste_item", { id: item.id });
      } catch (e) {
        console.error("Failed to paste:", e);
      }
    },
    [closePreview]
  );

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        if (previewItemIdRef.current === id) {
          await closePreview();
        }
        contentCacheRef.current.delete(id);
        await invoke("delete_item", { id });
        await loadHistory();
      } catch (e) {
        console.error("Failed to delete:", e);
      }
    },
    [closePreview, loadHistory]
  );

  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (!previewOpenRef.current) {
        return;
      }

      const startX = e.clientX;
      const startPreviewWidth = previewWidthRef.current;
      const totalWidth = contentWidthRef.current + previewWidthRef.current;

      const handleMouseMove = (event: MouseEvent) => {
        const delta =
          previewPlacementRef.current === "right"
            ? startX - event.clientX
            : event.clientX - startX;
        const nextPreviewWidth = Math.max(
          MIN_PREVIEW_WIDTH,
          Math.min(startPreviewWidth + delta, totalWidth - MIN_CONTENT_WIDTH)
        );
        const nextContentWidth = totalWidth - nextPreviewWidth;

        previewWidthRef.current = nextPreviewWidth;
        contentWidthRef.current = nextContentWidth;
        setPreviewWidth(nextPreviewWidth);
        setContentWidth(nextContentWidth);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    []
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
      await closePreview();
      contentCacheRef.current.clear();
      await invoke("clear_history");
      await loadHistory();
    } catch (e) {
      console.error("Failed to clear:", e);
    }
  }, [closePreview, loadHistory]);

  const handleHover = useCallback(
    (index: number) => {
      setSelectedIndex(index);
      triggerPreview(filteredItemsRef.current[index]);
    },
    [triggerPreview]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const curItems = filteredItemsRef.current;
      const maxIndex = curItems.length - 1;

      switch (true) {
        case e.key === "ArrowDown" ||
          ((e.ctrlKey || (isMac && e.metaKey)) && e.key === "n"): {
          e.preventDefault();
          const newIdx = Math.min(selectedIndex + 1, maxIndex);
          setSelectedIndex(newIdx);
          triggerPreview(curItems[newIdx]);
          break;
        }
        case e.key === "ArrowUp" ||
          ((e.ctrlKey || (isMac && e.metaKey)) && e.key === "p"): {
          e.preventDefault();
          const newIdx = Math.max(selectedIndex - 1, 0);
          setSelectedIndex(newIdx);
          triggerPreview(curItems[newIdx]);
          break;
        }
        case e.key === "ArrowRight": {
          if (curItems[selectedIndex]) {
            e.preventDefault();
            void showPreviewFor(curItems[selectedIndex]);
          }
          break;
        }
        case e.key === "ArrowLeft": {
          if (previewOpenRef.current) {
            e.preventDefault();
            void closePreview();
          }
          break;
        }
        case e.key === "Enter":
          e.preventDefault();
          if (curItems[selectedIndex]) {
            void handleSelect(curItems[selectedIndex]);
          }
          break;
        case e.key === "Escape":
          e.preventDefault();
          if (previewOpenRef.current) {
            void closePreview();
          } else {
            void invoke("hide_window");
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
            void handleTogglePin(curItems[selectedIndex].id);
          }
          break;
        case (e.key === "Delete" || (isMac && e.key === "Backspace")) &&
          e.altKey:
          e.preventDefault();
          if (curItems[selectedIndex]) {
            void handleDelete(curItems[selectedIndex].id);
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
            if (
              targetIndex < curItems.length &&
              !curItems[targetIndex].is_pinned
            ) {
              setSelectedIndex(targetIndex);
              void handleSelect(curItems[targetIndex]);
            }
          }
          break;
        }
      }
    },
    [
      closePreview,
      handleDelete,
      handleSelect,
      handleTogglePin,
      selectedIndex,
      showPreviewFor,
      triggerPreview,
    ]
  );

  useEffect(() => {
    setSelectedIndex(0);
    void closePreview();
  }, [closePreview, query]);

  useEffect(() => {
    if (showSettings) {
      void closePreview();
    }
  }, [closePreview, showSettings]);

  const mainContent = (
    <div
      className="flex flex-col flex-1 min-h-0 shrink-0"
      style={{ width: contentWidth }}
    >
      <SearchBar query={query} onQueryChange={setQuery} />
      <HistoryList
        ref={listRef}
        items={filteredItems}
        selectedIndex={selectedIndex}
        onSelect={handleSelect}
        onDelete={handleDelete}
        onTogglePin={handleTogglePin}
        onHover={handleHover}
      />
      <Footer itemCount={filteredItems.length} onClearAll={handleClearAll} />
    </div>
  );

  const previewPanel = (
    <div
      className="min-h-0 shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-in-out"
      style={{
        width: previewOpen ? previewWidth : 0,
        opacity: previewOpen ? 1 : 0,
        pointerEvents: previewOpen ? "auto" : "none",
      }}
    >
      <PreviewPanel
        item={previewItem}
        content={previewContent}
        loading={previewLoading}
        placement={previewPlacement}
      />
    </div>
  );

  const previewDivider = previewOpen ? (
    <div
      className="group min-h-0 shrink-0 w-3 flex items-center justify-center cursor-col-resize"
      onMouseDown={handleDividerMouseDown}
    >
      <div className="h-full w-px bg-white/10 group-hover:bg-white/20 transition-colors" />
    </div>
  ) : null;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="glass-bg h-full flex flex-col rounded-lg border border-white/10 outline-none overflow-hidden"
      onKeyDown={handleKeyDown}
    >
      <div
        data-tauri-drag-region
        className="h-4 flex-shrink-0 flex items-center justify-center cursor-move"
      >
        <div className="w-6 h-0.5 rounded-full bg-white/20" />
      </div>

      {showSettings ? (
        <SettingsView onClose={() => setShowSettings(false)} />
      ) : (
        <div className="flex flex-1 min-h-0">
          {previewPlacement === "left" && previewPanel}
          {previewPlacement === "left" && previewDivider}
          {mainContent}
          {previewPlacement === "right" && previewDivider}
          {previewPlacement === "right" && previewPanel}
        </div>
      )}
    </div>
  );
}

export default App;
