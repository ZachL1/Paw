import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

interface SearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  itemCount: number;
}

function SearchBar({ query, onQueryChange, itemCount }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Re-focus search input whenever window is shown
    const unlisten = listen("window-shown", () => {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div className="px-3 pt-3 pb-2 border-b border-white/10">
      <div className="relative">
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Type to search..."
          className="w-full bg-white/5 text-white text-sm placeholder-white/30
                     pl-9 pr-3 py-2 rounded-md border border-white/10
                     focus:outline-none focus:border-blue-400/50 focus:bg-white/8
                     transition-colors"
        />
        {query && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-white/30">
            {itemCount} items
          </span>
        )}
      </div>
    </div>
  );
}

export default SearchBar;
