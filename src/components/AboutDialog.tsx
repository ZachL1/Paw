import packageJson from "../../package.json";
import { translate, type ResolvedLanguage } from "../i18n";

interface AboutDialogProps {
  onClose: () => void;
  language: ResolvedLanguage;
}

function AboutDialog({ onClose, language }: AboutDialogProps) {
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center rounded-lg bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-[280px] rounded-lg border border-white/15 bg-[#1e1e2e] px-5 py-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-white text-sm font-semibold">{translate(language, "about.title")}</div>
        <div className="mt-2 text-xs leading-relaxed text-white/60">
          {translate(language, "about.description")}
        </div>
        <div className="mt-4 flex items-center justify-between text-[11px] text-white/40">
          <span>{translate(language, "about.version")}</span>
          <span>{packageJson.version}</span>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-white/10 px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-white/20 hover:text-white"
          >
            {translate(language, "about.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AboutDialog;
