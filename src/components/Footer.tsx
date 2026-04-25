import { isMac } from "../utils/platform";

interface FooterProps {
  itemCount: number;
  onClearAll: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  onQuit: () => void;
}

function Footer({
  itemCount,
  onClearAll,
  onOpenSettings,
  onOpenAbout,
  onQuit,
}: FooterProps) {
  const mod = isMac ? "⌥" : "Alt+";
  const clearShortcut = isMac ? "⌥⌫" : "Alt+Delete";
  const settingsShortcut = isMac ? "⌘," : "Ctrl+,";
  const quitShortcut = isMac ? "⌘Q" : "Ctrl+Q";

  return (
    <div className="border-t border-white/10 px-3 py-2 text-[10px] text-white/25">
      <div className="flex items-center justify-between">
        <span>{itemCount} items</span>
        <span>
          ↑↓ nav · → preview · ← close · ↵ paste · {mod}P pin
        </span>
      </div>

      <div className="mt-2 border-t border-white/10 pt-1.5">
        <button
          type="button"
          onClick={onClearAll}
          disabled={itemCount === 0}
          className="group flex w-full items-center justify-between rounded px-1 py-1.5 text-left text-sm text-white/80 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:text-white/20"
        >
          <span>Clear</span>
          <span className="text-white/30 text-xs">{clearShortcut}</span>
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          className="group flex w-full items-center justify-between rounded px-1 py-1.5 text-left text-sm text-white/80 transition-colors hover:bg-white/5"
        >
          <span>Preferences…</span>
          <span className="text-white/30 text-xs">{settingsShortcut}</span>
        </button>

        <button
          type="button"
          onClick={onOpenAbout}
          className="group flex w-full items-center justify-between rounded px-1 py-1.5 text-left text-sm text-white/80 transition-colors hover:bg-white/5"
        >
          <span>About</span>
          <span className="text-white/0 text-xs">·</span>
        </button>

        <button
          type="button"
          onClick={onQuit}
          className="group flex w-full items-center justify-between rounded px-1 py-1.5 text-left text-sm text-white/80 transition-colors hover:bg-white/5"
        >
          <span>Quit</span>
          <span className="text-white/30 text-xs">{quitShortcut}</span>
        </button>
      </div>
    </div>
  );
}

export default Footer;
