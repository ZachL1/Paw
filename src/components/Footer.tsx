interface FooterProps {
  itemCount: number;
  onClearAll: () => void;
  showPreview: boolean;
}

function Footer({ itemCount, onClearAll, showPreview }: FooterProps) {
  return (
    <div className="px-3 py-2 border-t border-white/10 flex items-center justify-between">
      <span className="text-white/30 text-xs">{itemCount} items</span>
      <div className="flex gap-2 text-[10px] text-white/30">
        <span>
          <kbd className="px-1 py-0.5 bg-white/10 rounded">↑↓</kbd> nav
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-white/10 rounded">↵</kbd> paste
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-white/10 rounded">{showPreview ? "←" : "→"}</kbd>{" "}
          preview
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-white/10 rounded">Alt+P</kbd> pin
        </span>
        {itemCount > 0 && (
          <button
            onClick={onClearAll}
            className="text-red-400/40 hover:text-red-400 transition-colors"
          >
            clear
          </button>
        )}
      </div>
    </div>
  );
}

export default Footer;
