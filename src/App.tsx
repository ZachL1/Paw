import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import SearchBar from "./components/SearchBar";
import HistoryList from "./components/HistoryList";
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
  const listRef = useRef<HTMLDivElement>(null);

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
    const unlisten = listen("clipboard-changed", () => {
      loadHistory();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadHistory]);

  const filteredItems = items.filter((item) => {
    if (!query) return true;
    const lowerQuery = query.toLowerCase();
    return item.title.toLowerCase().includes(lowerQuery);
  });

  const handleSelect = useCallback(
    async (item: HistoryItem) => {
      try {
        await invoke("paste_item", { id: item.id });
      } catch (e) {
        console.error("Failed to paste:", e);
      }
    },
    []
  );

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
          invoke("hide_window");
          break;
        case e.ctrlKey && e.key === "u":
          e.preventDefault();
          setQuery("");
          setSelectedIndex(0);
          break;
        case e.key === "Delete" && e.altKey:
          e.preventDefault();
          if (filteredItems[selectedIndex]) {
            handleDelete(filteredItems[selectedIndex].id);
          }
          break;
      }
    },
    [filteredItems, selectedIndex, handleSelect, handleDelete]
  );

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  return (
    <div
      className="glass-bg h-full flex flex-col rounded-lg border border-white/10"
      onKeyDown={handleKeyDown}
    >
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
      />
      <Footer itemCount={filteredItems.length} onClearAll={handleClearAll} />
    </div>
  );
}

export default App;
