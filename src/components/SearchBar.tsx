import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import pawMark from "../assets/paw-mark.svg";

interface SearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
}

function SearchBar({ query, onQueryChange }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Re-focus search input whenever window is shown
    const unlisten = listen("window-shown", () => {
      // Use two attempts to ensure focus lands on the input even if
      // other state updates (loadHistory, closePreview) cause re-renders.
      setTimeout(() => inputRef.current?.focus(), 50);
      setTimeout(() => inputRef.current?.focus(), 200);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div className="px-3 pt-1 pb-0.5 border-b border-white/10">
      <div className="flex items-center gap-1.5">
        <div
          data-tauri-drag-region
          className="shrink-0 cursor-move px-0.5 text-[15px] font-semibold leading-none text-white/60 select-none flex items-center gap-1"
        >
          <img src={pawMark} alt="" className="h-4 w-4 opacity-80" />
          Paw
        </div>
        <div className="relative flex-1">
          <svg
            className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30"
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
            className="w-full bg-white/5 text-white text-[13px] placeholder-white/30
                       pl-7 pr-7 py-0.5 rounded-md border border-white/10
                       focus:outline-none focus:border-blue-400/50 focus:bg-white/8
                       transition-colors"
          />
          {query && (
            <button
              onClick={() => onQueryChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
              aria-label="Clear search"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SearchBar;
