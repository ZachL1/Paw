# Paw 📋

A lightweight, keyboard-first clipboard manager built for true cross-platform support. Inspired by [Maccy](https://github.com/p0deje/Maccy).

Built with **Tauri + Rust + React + TypeScript**.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

---

## ⚡ Quick Start

> Get Paw installed and running in under 2 minutes on Ubuntu/Debian.

### 1. Install dependencies

```bash
sudo apt install xdotool libwebkit2gtk-4.0-37 libgtk-3-0
```

### 2. Download & install

Go to the [**Releases page**](https://github.com/ZachL1/Paw/releases/latest) and download the `.deb` package, then:

```bash
sudo dpkg -i paw_*.deb
sudo apt-get install -f   # fix any missing dependencies
```

> **AppImage** (no install needed, works on any Linux distro):
> ```bash
> chmod +x paw_*.AppImage && ./paw_*.AppImage
> ```

### 3. Launch

```bash
paw &
```

Paw starts silently in the system tray. You won't see a window — that's normal.

### 4. Use it

1. **Copy** anything in any app as usual (`Ctrl+C`)
2. Press **`Alt+V`** anywhere to open Paw
3. **Type** to search your clipboard history
4. Use **`↑↓`** to pick an item, press **`Enter`** to paste it
5. Press **`Escape`** or click outside to dismiss

That's it! ✅

### Auto-start on login (optional)

```bash
# Create a systemd user service
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/paw.service << 'EOF'
[Unit]
Description=Paw clipboard manager

[Service]
ExecStart=%h/.local/bin/paw
Restart=on-failure

[Install]
WantedBy=default.target
EOF

systemctl --user enable --now paw.service
```

---

## Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| 🐧 Linux (X11) | ✅ Supported | Primary development platform |
| 🐧 Linux (Wayland) | 🟡 Partial | Paste via wtype/ydotool |
| 🍎 macOS | ✅ Supported | Native paste via CGEvent, tray/menu integration |
| 🪟 Windows | 🔲 Planned | |

## Features

- 🔍 **Instant full-text search** — fast substring search across title + content
- ⌨️ **Keyboard-first** — full keyboard navigation, no mouse needed
- 📌 **Pin items** — keep frequently used snippets at the top
- 👁️ **Slideout preview** — same-window preview panel for full content
- 🖼️ **Image support** — copies and pastes images, shows thumbnails
- 📚 **Virtualized history list** — smooth scrolling with large histories
- 🔄 **Incremental updates** — clipboard changes merge without full reload
- 🎯 **Auto-paste** — select an item and it pastes to the active app
- 🧩 **Tray + footer actions** — Preferences, About, Quit, and quick clear
- ⚙️ **Configurable** — hotkey, history size, poll interval and more
- 🪶 **Lightweight** — ~4 MB deb package, ~11 MB binary, minimal RAM
- 🌙 **Dark UI** — clean, distraction-free floating panel

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+V` | Show/hide Paw (configurable) |
| `↑` `↓` / `Ctrl+P` `Ctrl+N` | Navigate up/down |
| `Enter` | Paste selected item |
| `Escape` | Close preview / close window |
| `→` | Open preview panel |
| `←` | Close preview panel |
| `Alt+P` | Pin / unpin selected item |
| `Alt+Delete` | Delete selected item |
| `Ctrl+U` | Clear search |
| `Ctrl+,` | Open settings |
| `Ctrl+1`–`9` | Paste item by position |
| Double-click | Pin / unpin item |

## Settings

Open settings with **`Ctrl+,`** or via the tray menu. Config is stored in `~/.config/paw/config.json`.

| Setting | Default | Description |
|---------|---------|-------------|
| Global Hotkey | `Alt+V` | Shortcut to toggle Paw — click the field and press your desired combo |
| Max History | 1000 | Maximum items to keep |
| Auto-clear | Never | Auto-delete items after N days |
| Poll Interval | 500 ms | How often clipboard is checked |
| Paste on Select | Yes | Auto-paste when you pick an item |

## Installation

### Ubuntu / Debian (.deb)

```bash
sudo apt install xdotool
sudo dpkg -i paw_0.1.2_amd64.deb
sudo apt-get install -f
```

### Any Linux (AppImage)

```bash
chmod +x paw_0.1.2_amd64.AppImage
./paw_0.1.2_amd64.AppImage
```

### Fedora / RHEL (.rpm)

```bash
sudo rpm -i paw-0.1.2-1.x86_64.rpm
sudo dnf install xdotool
```

## Building from Source

### Prerequisites

- [Rust](https://rustup.rs/) 1.70+
- [Node.js](https://nodejs.org/) 18+
- Linux system libraries:

```bash
# Ubuntu / Debian
sudo apt install libwebkit2gtk-4.0-dev libgtk-3-0 libayatana-appindicator3-dev librsvg2-dev xdotool
```

### Build

```bash
git clone https://github.com/ZachL1/Paw.git
cd Paw
npm install
npm run tauri build
# Packages in: src-tauri/target/release/bundle/
```

### Development

```bash
npm run tauri dev
```

## Architecture

```
Paw
├── src-tauri/src/        # Rust backend
│   ├── main.rs           # App entry, Tauri commands, tray, hotkey
│   ├── clipboard.rs      # Clipboard polling monitor
│   ├── database.rs       # SQLite storage layer
│   ├── config.rs         # JSON config persistence
│   ├── paste.rs          # Paste simulation (xdotool/wtype)
│   └── models.rs         # Data models
└── src/                  # React frontend
    ├── App.tsx            # Main app, window lifecycle, keyboard handling
    └── components/
        ├── SearchBar.tsx     # Auto-focus search input
        ├── HistoryList.tsx   # Scrollable item list
        ├── PreviewPanel.tsx  # Content preview sidebar
        ├── SettingsView.tsx  # Settings form with hotkey recorder
        └── Footer.tsx        # Shortcut hints
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Tauri](https://tauri.app/) v1 |
| Backend | Rust |
| Frontend | React + TypeScript |
| Styling | Tailwind CSS v4 |
| Database | SQLite (rusqlite) |
| Search | SQLite (`LIKE` substring, backend) |
| Clipboard | arboard crate |

## Acknowledgements

Paw is inspired by [Maccy](https://github.com/p0deje/Maccy), an excellent clipboard manager for macOS by Alex Rodionov. While Paw shares no code with Maccy, its UX design — keyboard-first navigation, instant search, floating panel — is modeled after Maccy's elegant approach.

## Roadmap

### 🖥️ Cross-Platform Desktop

- [x] **macOS support** — native CGEvent paste, menu bar tray, and keyboard-first popup flow
- [ ] **macOS `.dmg` packaging** — native installer bundle
- [ ] **Windows support** — `.msi`/`.exe` installer, `SendInput` paste, system tray
- [ ] **Wayland full support** — window focus and paste under Wayland compositors

### 🔄 Cross-Device Sync

- [ ] **Cloud sync** — E2E encrypted history sync across devices
- [ ] **LAN sync** — peer-to-peer sync on the same network (mDNS + TLS)
- [ ] **Universal clipboard** — copy on one device, paste on another

## Contributing

Contributions are welcome! Feel free to open a PR. For major changes, please open an issue first to discuss.

## License

[MIT](LICENSE)
