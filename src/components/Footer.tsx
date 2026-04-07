interface FooterProps {
  itemCount: number;
  onClearAll: () => void;
}

function Footer({ itemCount, onClearAll }: FooterProps) {
  return (
    <div className="px-3 py-2 border-t border-white/10 flex items-center justify-between">
      <span className="text-white/30 text-xs">{itemCount} items</span>
      <div className="flex gap-3 text-xs text-white/30">
        <span>
          <kbd className="px-1 py-0.5 bg-white/10 rounded text-[10px]">↑↓</kbd>{" "}
          navigate
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-white/10 rounded text-[10px]">↵</kbd>{" "}
          paste
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-white/10 rounded text-[10px]">esc</kbd>{" "}
          close
        </span>
        {itemCount > 0 && (
          <button
            onClick={onClearAll}
            className="text-red-400/50 hover:text-red-400 transition-colors"
          >
            clear all
          </button>
        )}
      </div>
    </div>
  );
}

export default Footer;
