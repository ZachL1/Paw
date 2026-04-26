import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { isMac } from "../utils/platform";
import type { AppConfig } from "../App";
import { resolveLanguage, translate, type LanguagePreference, type ResolvedLanguage } from "../i18n";

interface SettingsViewProps {
  onClose: () => void;
}

/** Convert a browser KeyboardEvent.code to the tao hotkey key name. */
function codeToKeyName(code: string): string | null {
  if (code.startsWith("Key")) return code.slice(3); // KeyV → V
  if (code.startsWith("Digit")) return code.slice(5); // Digit5 → 5
  if (/^F\d+$/.test(code)) return code; // F1–F12
  const map: Record<string, string> = {
    Space: "Space", Enter: "Enter", Tab: "Tab", Backspace: "Backspace",
    Escape: "Escape", Delete: "Delete", Insert: "Insert",
    Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
    ArrowUp: "ArrowUp", ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
    Backslash: "Backslash", Semicolon: ";", Quote: "'",
    Backquote: "`", Comma: ",", Period: ".", Slash: "/",
    NumpadMultiply: "NumpadMultiply", NumpadAdd: "NumpadAdd",
    NumpadSubtract: "NumpadSubtract", NumpadDecimal: "NumpadDecimal",
    NumpadDivide: "NumpadDivide",
  };
  if (code in map) return map[code];
  // NumpadN
  const numpad = code.match(/^Numpad(\d)$/);
  if (numpad) return `Num${numpad[1]}`;
  return null;
}

const MODIFIER_CODES = new Set([
  "ControlLeft", "ControlRight",
  "AltLeft", "AltRight",
  "ShiftLeft", "ShiftRight",
  "MetaLeft", "MetaRight",
]);

/** Format a hotkey string like "Ctrl+Shift+V" for display. */
function formatHotkey(hotkey: string): string {
  return hotkey
    .split("+")
    .map((p) => {
      if (p === "Super") return isMac ? "⌘" : "Super";
      if (p === "Alt") return isMac ? "⌥" : "Alt";
      if (p === "Ctrl") return isMac ? "⌃" : "Ctrl";
      if (p === "Shift") return isMac ? "⇧" : "Shift";
      return p;
    })
    .join(" + ");
}

function HotkeyRecorder({
  value,
  onChange,
  language,
}: {
  value: string;
  onChange: (hotkey: string) => void;
  language: ResolvedLanguage;
}) {
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState<string>("");
  const divRef = useRef<HTMLDivElement>(null);

  const stopRecording = useCallback(() => {
    setRecording(false);
    setPreview("");
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.code === "Escape") {
        stopRecording();
        return;
      }

      const isModifierOnly = MODIFIER_CODES.has(e.code);

      // Build currently held modifiers
      const mods: string[] = [];
      if (e.ctrlKey) mods.push("Ctrl");
      if (e.altKey) mods.push("Alt");
      if (e.shiftKey) mods.push("Shift");
      if (e.metaKey) mods.push("Super");

      if (isModifierOnly) {
        setPreview(mods.join("+") + (mods.length ? "+" : "") + "…");
        return;
      }

      // Must have at least one modifier
      if (mods.length === 0) return;

      const keyName = codeToKeyName(e.code);
      if (!keyName) return;

      const hotkey = [...mods, keyName].join("+");
      onChange(hotkey);
      stopRecording();
    },
    [onChange, stopRecording]
  );

  useEffect(() => {
    if (recording) {
      divRef.current?.focus();
    }
  }, [recording]);

  return (
    <div
      ref={divRef}
      tabIndex={0}
      onKeyDown={recording ? handleKeyDown : undefined}
      onBlur={recording ? stopRecording : undefined}
      onClick={() => setRecording(true)}
      className={`
        mt-1 w-full px-3 py-1.5 rounded border text-sm cursor-pointer
        flex items-center gap-2 select-none outline-none
        transition-colors duration-150
        ${
          recording
            ? "bg-blue-500/10 border-blue-400/60 text-blue-300"
            : "bg-white/5 border-white/10 text-white hover:border-white/25"
        }
      `}
    >
      {recording ? (
        <>
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
          <span className="flex-1 font-mono">
            {preview || translate(language, "settings.pressShortcut")}
          </span>
          <span className="text-white/30 text-xs">{translate(language, "settings.escCancel")}</span>
        </>
      ) : (
        <>
          <span className="flex-1 font-mono tracking-wide">
            {value ? formatHotkey(value) : <span className="text-white/30">{translate(language, "settings.clickRecord")}</span>}
          </span>
          <span className="text-white/30 text-xs">{translate(language, "settings.clickChange")}</span>
        </>
      )}
    </div>
  );
}

function SettingsView({ onClose }: SettingsViewProps) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimeoutRef = useRef<number | null>(null);
  const trayMenuVisibilitySaveChain = useRef(Promise.resolve());

  useEffect(() => {
    invoke<AppConfig>("get_config").then(setConfig).catch(console.error);
  }, []);

  useEffect(() => {
    return () => {
      if (savedTimeoutRef.current !== null) {
        window.clearTimeout(savedTimeoutRef.current);
      }
    };
  }, []);

  const markSaved = useCallback(() => {
    if (savedTimeoutRef.current !== null) {
      window.clearTimeout(savedTimeoutRef.current);
    }
    setSaved(true);
    setError(null);
    savedTimeoutRef.current = window.setTimeout(() => {
      setSaved(false);
      savedTimeoutRef.current = null;
    }, 2000);
  }, []);

  const persistConfig = useCallback(async (nextConfig: AppConfig) => {
    try {
      await invoke("save_config", { newConfig: nextConfig });
      markSaved();
    } catch (e) {
      setError(String(e));
    }
  }, [markSaved]);

  const persistTrayMenuVisibility = useCallback((hidden: boolean) => {
    trayMenuVisibilitySaveChain.current = trayMenuVisibilitySaveChain.current
      .catch(() => undefined)
      .then(() =>
        invoke("set_hide_tray_menu_actions", {
          hideTrayMenuActions: hidden,
        })
      )
      .then(() => {
        markSaved();
      })
      .catch((e) => {
        setError(String(e));
      });
  }, [markSaved]);

  const persistMenuBarIconVisibility = useCallback((visible: boolean) => {
    trayMenuVisibilitySaveChain.current = trayMenuVisibilitySaveChain.current
      .catch(() => undefined)
      .then(() =>
        invoke("set_menu_bar_icon_visible", {
          visible,
        })
      )
      .then(() => {
        markSaved();
      })
      .catch((e) => {
        setError(String(e));
      });
  }, [markSaved]);

  const handleSave = useCallback(async () => {
    if (!config) return;
    await persistConfig(config);
  }, [config, persistConfig]);

  if (!config) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-sm">
        {translate(resolveLanguage("system"), "settings.loading")}
      </div>
    );
  }

  const language = resolveLanguage(config.language);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <h2 className="text-white/90 text-sm font-semibold">⚙ {translate(language, "settings.title")}</h2>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white/80 text-xs transition-colors"
        >
          ✕ {translate(language, "settings.close")}
        </button>
      </div>

      {/* Settings form */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* General */}
        <section>
          <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">
            {translate(language, "settings.general")}
          </h3>

          <label className="block mb-3">
            <span className="text-white/70 text-xs">{translate(language, "settings.language")}</span>
            <select
              value={config.language}
              onChange={(e) =>
                setConfig({ ...config, language: e.target.value as LanguagePreference })
              }
              className="mt-1 w-full bg-white/5 text-white text-sm px-3 py-1.5 rounded border border-white/10 focus:outline-none focus:border-blue-400/50"
            >
              <option value="system">{translate(language, "settings.language.system")}</option>
              <option value="en">{translate(language, "settings.language.en")}</option>
              <option value="zh-CN">{translate(language, "settings.language.zhCN")}</option>
            </select>
          </label>

          <label className="block mb-3">
            <span className="text-white/70 text-xs">{translate(language, "settings.hotkey")}</span>
            <HotkeyRecorder
              value={config.hotkey}
              onChange={(hotkey) => setConfig({ ...config, hotkey })}
              language={language}
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
              {translate(language, "settings.pasteOnSelect", { shortcut: isMac ? "⌘V" : "Ctrl+V" })}
            </span>
          </label>

          <label className="flex items-center gap-2 mb-2">
            <input
              type="checkbox"
              checked={config.launch_at_startup}
              onChange={(e) =>
                setConfig({ ...config, launch_at_startup: e.target.checked })
              }
              className="rounded accent-blue-500"
            />
            <span className="text-white/70 text-xs">
              {translate(language, "settings.launchStartup")}
            </span>
          </label>

          <label className="flex items-center gap-2 mb-2">
            <input
              type="checkbox"
              checked={config.hide_tray_menu_actions}
              onChange={(e) => {
                const hidden = e.target.checked;
                const nextConfig = {
                  ...config,
                  hide_tray_menu_actions: hidden,
                };
                setConfig(nextConfig);
                persistTrayMenuVisibility(hidden);
              }}
              className="rounded accent-blue-500"
            />
            <span className="text-white/70 text-xs">
              {translate(language, "settings.hideTrayMenuActions")}
            </span>
          </label>

          {isMac && (
            <label className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                checked={config.show_menu_bar_icon}
                onChange={(e) => {
                  const visible = e.target.checked;
                  const nextConfig = {
                    ...config,
                    show_menu_bar_icon: visible,
                  };
                  setConfig(nextConfig);
                  persistMenuBarIconVisibility(visible);
                }}
                className="rounded accent-blue-500"
              />
              <span className="text-white/70 text-xs">
                {translate(language, "settings.showMenuBarIcon")}
              </span>
            </label>
          )}
        </section>

        {/* Storage */}
        <section>
          <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">
            {translate(language, "settings.storage")}
          </h3>

          <label className="block mb-3">
            <span className="text-white/70 text-xs">{translate(language, "settings.maxHistory")}</span>
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
               {translate(language, "settings.autoClear")}
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
              placeholder={translate(language, "settings.never")}
              className="mt-1 w-full bg-white/5 text-white text-sm px-3 py-1.5 rounded border border-white/10 focus:outline-none focus:border-blue-400/50"
            />
          </label>
        </section>

        {/* Appearance */}
        <section>
          <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">
            {translate(language, "settings.appearance")}
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
            <span className="text-white/70 text-xs">{translate(language, "settings.showSourceApp")}</span>
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
            <span className="text-white/70 text-xs">{translate(language, "settings.showCopyCount")}</span>
          </label>
        </section>

        {/* Advanced */}
        <section>
          <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">
            {translate(language, "settings.advanced")}
          </h3>

          <label className="block mb-3">
            <span className="text-white/70 text-xs">
              {translate(language, "settings.pollInterval")}
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

          <label className="block mb-3">
            <span className="text-white/70 text-xs">
              {translate(language, "settings.previewDelay")}
            </span>
            <input
              type="number"
              value={config.preview_delay_ms}
              onChange={(e) =>
                setConfig({
                  ...config,
                  preview_delay_ms: parseInt(e.target.value) || 1500,
                })
              }
              min={200}
              max={10000}
              step={100}
              className="mt-1 w-full bg-white/5 text-white text-sm px-3 py-1.5 rounded border border-white/10 focus:outline-none focus:border-blue-400/50"
            />
          </label>

        </section>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between">
        <div className="text-xs">
          {saved && <span className="text-green-400">✓ {translate(language, "settings.saved")}</span>}
          {error && <span className="text-red-400">{error}</span>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white/80 text-xs px-3 py-1.5 rounded border border-white/10 transition-colors"
          >
            {translate(language, "settings.cancel")}
          </button>
          <button
            onClick={handleSave}
            className="bg-blue-500/80 hover:bg-blue-500 text-white text-xs px-3 py-1.5 rounded transition-colors"
          >
            {translate(language, "settings.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SettingsView;
