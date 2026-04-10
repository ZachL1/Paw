import { isMac } from "../utils/platform";

interface FooterProps {
  itemCount: number;
  onClearAll: () => void;
}

function Footer({ itemCount, onClearAll }: FooterProps) {
  const mod = isMac ? "⌥" : "Alt+";

  return (
    <div className="group px-3 py-1.5 border-t border-white/10 flex items-center justify-between text-[10px] text-white/25">
      <span>{itemCount} items</span>
      <div className="flex items-center gap-1">
        <span>
          ↑↓ nav · ↵ paste · {mod}P pin
        </span>
        {itemCount > 0 && (
          <button
            onClick={onClearAll}
            className="ml-1 opacity-0 group-hover:opacity-100 text-red-400/50 hover:text-red-400 transition-opacity"
          >
            · clear
          </button>
        )}
      </div>
    </div>
  );
}

export default Footer;
