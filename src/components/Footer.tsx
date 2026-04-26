import { isMac } from "../utils/platform";
import { translate, type ResolvedLanguage } from "../i18n";

interface FooterProps {
  itemCount: number;
  onClearAll: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  onQuit: () => void;
  language: ResolvedLanguage;
}

function Footer({
  itemCount,
  onClearAll,
  onOpenSettings,
  onOpenAbout,
  onQuit,
  language,
}: FooterProps) {
  const mod = isMac ? "⌥" : "Alt+";
  const clearShortcut = isMac ? "⌥⌫" : "Alt+Delete";
  const settingsShortcut = isMac ? "⌘," : "Ctrl+,";
  const quitShortcut = isMac ? "⌘Q" : "Ctrl+Q";

  return (
    <div className="border-t border-white/10 px-2.5 py-1 text-[10px] text-white/25">
      <div className="flex items-center justify-between">
        <span>{translate(language, "footer.items", { count: itemCount })}</span>
        <span>
          {translate(language, "footer.hints", { mod })}
        </span>
      </div>

      <div className="mt-0.5 border-t border-white/10 pt-0.5">
        <button
          type="button"
          onClick={onClearAll}
          disabled={itemCount === 0}
          className="group flex w-full items-center justify-between rounded px-1 py-0.5 text-left text-[13px] leading-tight text-white/80 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:text-white/20"
        >
          <span>{translate(language, "footer.clear")}</span>
          <span className="text-white/30 text-xs">{clearShortcut}</span>
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          className="group flex w-full items-center justify-between rounded px-1 py-0.5 text-left text-[13px] leading-tight text-white/80 transition-colors hover:bg-white/5"
        >
          <span>{translate(language, "footer.preferences")}</span>
          <span className="text-white/30 text-xs">{settingsShortcut}</span>
        </button>

        <button
          type="button"
          onClick={onOpenAbout}
          className="group flex w-full items-center justify-between rounded px-1 py-0.5 text-left text-[13px] leading-tight text-white/80 transition-colors hover:bg-white/5"
        >
          <span>{translate(language, "footer.about")}</span>
          <span className="text-white/0 text-xs">·</span>
        </button>

        <button
          type="button"
          onClick={onQuit}
          className="group flex w-full items-center justify-between rounded px-1 py-0.5 text-left text-[13px] leading-tight text-white/80 transition-colors hover:bg-white/5"
        >
          <span>{translate(language, "footer.quit")}</span>
          <span className="text-white/30 text-xs">{quitShortcut}</span>
        </button>
      </div>
    </div>
  );
}

export default Footer;
