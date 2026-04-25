import packageJson from "../../package.json";

interface AboutDialogProps {
  onClose: () => void;
}

function AboutDialog({ onClose }: AboutDialogProps) {
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center rounded-lg bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-[280px] rounded-lg border border-white/15 bg-[#1e1e2e] px-5 py-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-white text-sm font-semibold">About Paw</div>
        <div className="mt-2 text-xs leading-relaxed text-white/60">
          Cross-platform clipboard manager inspired by Maccy.
        </div>
        <div className="mt-4 flex items-center justify-between text-[11px] text-white/40">
          <span>Version</span>
          <span>{packageJson.version}</span>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-white/10 px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-white/20 hover:text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default AboutDialog;
