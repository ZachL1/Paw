import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";

interface Config {
  hotkey: string;
  max_history: number;
  auto_clear_days: number | null;
  poll_interval_ms: number;
  paste_on_select: boolean;
  show_source_app: boolean;
  show_copy_count: boolean;
  ignored_apps: string[];
}

interface SettingsViewProps {
  onClose: () => void;
}

function SettingsView({ onClose }: SettingsViewProps) {
  const [config, setConfig] = useState<Config | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<Config>("get_config").then(setConfig).catch(console.error);
  }, []);

  const handleSave = useCallback(async () => {
    if (!config) return;
    try {
      await invoke("save_config", { newConfig: config });
      setSaved(true);
      setError(null);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    }
  }, [config]);

  if (!config) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <h2 className="text-white/90 text-sm font-semibold">⚙ Settings</h2>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white/80 text-xs transition-colors"
        >
          ✕ Close
        </button>
      </div>

      {/* Settings form */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* General */}
        <section>
          <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">
            General
          </h3>

          <label className="block mb-3">
            <span className="text-white/70 text-xs">Global Hotkey</span>
            <input
              type="text"
              value={config.hotkey}
              onChange={(e) =>
                setConfig({ ...config, hotkey: e.target.value })
              }
              className="mt-1 w-full bg-white/5 text-white text-sm px-3 py-1.5 rounded border border-white/10 focus:outline-none focus:border-blue-400/50"
              placeholder="e.g. Alt+V, Ctrl+Shift+C"
            />
          </label>

          <label className="flex items-center gap-2 mb-2">
            <input
              type="checkbox"
              checked={config.paste_on_select}
              onChange={(e) =>
                setConfig({ ...config, paste_on_select: e.target.checked })
              }
              className="rounded accent-blue-500"
            />
            <span className="text-white/70 text-xs">
              Paste on select (simulate Ctrl+V)
            </span>
          </label>
        </section>

        {/* Storage */}
        <section>
          <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">
            Storage
          </h3>

          <label className="block mb-3">
            <span className="text-white/70 text-xs">Max history items</span>
            <input
              type="number"
              value={config.max_history}
              onChange={(e) =>
                setConfig({
                  ...config,
                  max_history: parseInt(e.target.value) || 1000,
                })
              }
              min={10}
              max={10000}
              className="mt-1 w-full bg-white/5 text-white text-sm px-3 py-1.5 rounded border border-white/10 focus:outline-none focus:border-blue-400/50"
            />
          </label>

          <label className="block mb-3">
            <span className="text-white/70 text-xs">
              Auto-clear after (days, empty = never)
            </span>
            <input
              type="number"
              value={config.auto_clear_days ?? ""}
              onChange={(e) =>
                setConfig({
                  ...config,
                  auto_clear_days: e.target.value
                    ? parseInt(e.target.value)
                    : null,
                })
              }
              min={1}
              placeholder="Never"
              className="mt-1 w-full bg-white/5 text-white text-sm px-3 py-1.5 rounded border border-white/10 focus:outline-none focus:border-blue-400/50"
            />
          </label>
        </section>

        {/* Appearance */}
        <section>
          <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">
            Appearance
          </h3>

          <label className="flex items-center gap-2 mb-2">
            <input
              type="checkbox"
              checked={config.show_source_app}
              onChange={(e) =>
                setConfig({ ...config, show_source_app: e.target.checked })
              }
              className="rounded accent-blue-500"
            />
            <span className="text-white/70 text-xs">Show source app</span>
          </label>

          <label className="flex items-center gap-2 mb-2">
            <input
              type="checkbox"
              checked={config.show_copy_count}
              onChange={(e) =>
                setConfig({ ...config, show_copy_count: e.target.checked })
              }
              className="rounded accent-blue-500"
            />
            <span className="text-white/70 text-xs">Show copy count</span>
          </label>
        </section>

        {/* Advanced */}
        <section>
          <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">
            Advanced
          </h3>

          <label className="block mb-3">
            <span className="text-white/70 text-xs">
              Clipboard poll interval (ms)
            </span>
            <input
              type="number"
              value={config.poll_interval_ms}
              onChange={(e) =>
                setConfig({
                  ...config,
                  poll_interval_ms: parseInt(e.target.value) || 500,
                })
              }
              min={100}
              max={5000}
              step={100}
              className="mt-1 w-full bg-white/5 text-white text-sm px-3 py-1.5 rounded border border-white/10 focus:outline-none focus:border-blue-400/50"
            />
          </label>
        </section>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between">
        <div className="text-xs">
          {saved && <span className="text-green-400">✓ Saved</span>}
          {error && <span className="text-red-400">{error}</span>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white/80 text-xs px-3 py-1.5 rounded border border-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="bg-blue-500/80 hover:bg-blue-500 text-white text-xs px-3 py-1.5 rounded transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default SettingsView;
