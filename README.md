# Paw 📋

A lightweight, keyboard-first clipboard manager built for true cross-platform support. Inspired by [Maccy](https://github.com/p0deje/Maccy).

Built with **Tauri + Rust + React + TypeScript**.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| 🐧 Linux (X11) | ✅ Supported | Primary development platform |
| 🐧 Linux (Wayland) | 🟡 Partial | Paste via wtype/ydotool |
| 🍎 macOS | 🔲 Planned | |
| 🪟 Windows | 🔲 Planned | |
| 📱 iOS | 🔲 Exploring | |
| 🤖 Android | 🔲 Exploring | |

## Features

- 🔍 **Fuzzy search** — type to filter history instantly
- ⌨️ **Keyboard-first** — full keyboard navigation, no mouse needed
- 📌 **Pin items** — keep frequently used snippets at the top
- 👁️ **Preview panel** — see full content before pasting
- 🎯 **Auto-paste** — select an item and it pastes to the active app
- ⚙️ **Configurable** — hotkey, history size, poll interval and more
- 🪶 **Lightweight** — ~4MB deb package, ~11MB binary, minimal memory usage
- 🌙 **Dark glassmorphism UI** — clean, modern, distraction-free

## Installation

### Ubuntu / Debian

```bash
# Download the latest .deb from Releases
sudo dpkg -i paw_0.1.0_amd64.deb
sudo apt-get install -f  # install dependencies if needed

# Required for paste simulation
sudo apt install xdotool
```

### AppImage (any Linux)

```bash
chmod +x paw_0.1.0_amd64.AppImage
./paw_0.1.0_amd64.AppImage
```

### Fedora / RHEL

```bash
sudo rpm -i paw-0.1.0-1.x86_64.rpm
```

## Usage

### Quick Start

1. Launch `paw` — it runs in the system tray
2. Copy some text in any app
3. Press **`Alt+V`** to open Paw
4. Type to search, use `↑↓` to navigate, press `Enter` to paste

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+V` | Show/hide Paw (configurable) |
| `↑` `↓` / `Ctrl+P` `Ctrl+N` | Navigate up/down |
| `Enter` | Paste selected item |
| `Escape` | Close preview / close window |
| `→` | Open preview panel |
| `←` | Close preview panel |
| `Alt+P` | Pin/unpin selected item |
| `Alt+Delete` | Delete selected item |
| `Ctrl+U` | Clear search |
| `Ctrl+,` | Open settings |

### Settings

Open settings via `Ctrl+,` or the tray menu. Configuration is saved to `~/.config/paw/config.json`.

| Setting | Default | Description |
|---------|---------|-------------|
| Global Hotkey | `Alt+V` | Shortcut to toggle Paw |
| Max History | 1000 | Maximum items to keep |
| Auto-clear | Never | Auto-delete items after N days |
| Poll Interval | 500ms | How often to check clipboard |
| Paste on Select | Yes | Auto-paste when selecting an item |

## Building from Source

### Prerequisites

- [Rust](https://rustup.rs/) (1.70+)
- [Node.js](https://nodejs.org/) (18+)
- Linux system dependencies:

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
```

Packages will be in `src-tauri/target/release/bundle/`.

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
├── src/                  # React frontend
│   ├── App.tsx           # Main app with keyboard handling
│   └── components/
│       ├── SearchBar.tsx    # Auto-focus search input
│       ├── HistoryList.tsx  # Scrollable item list
│       ├── PreviewPanel.tsx # Content preview sidebar
│       ├── SettingsView.tsx # Settings form
│       └── Footer.tsx       # Shortcut hints
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Tauri](https://tauri.app/) v1 |
| Backend | Rust |
| Frontend | React + TypeScript |
| Styling | Tailwind CSS v4 |
| Database | SQLite (rusqlite) |
| Search | Fuse.js |
| Clipboard | arboard crate |

## Acknowledgements

Paw is inspired by [Maccy](https://github.com/p0deje/Maccy), an excellent clipboard manager for macOS by Alex Rodionov. While Paw shares no code with Maccy (different language, framework, and platform), its UX design — keyboard-first navigation, instant search, floating panel — is modeled after Maccy's elegant approach.

## Roadmap

### 🖥️ Cross-Platform Desktop

- [ ] **macOS support** — native `.dmg` packaging, `Cmd+V` paste simulation via AppleScript/CGEvent, menu bar tray icon
- [ ] **Windows support** — `.msi`/`.exe` installer, `SendInput` API for paste simulation, system tray integration
- [ ] **Wayland full support** — improve paste simulation, window focus and positioning under Wayland compositors

### 🖼️ Image Support

- [ ] **Image clipboard** — detect and store copied images (PNG/JPEG), show thumbnails in history list, full preview in preview panel

### 🔄 Cross-Device Sync

- [ ] **Cloud sync** — encrypted clipboard history sync across devices (E2E encrypted, user-controlled)
- [ ] **LAN sync** — peer-to-peer sync on the same network without cloud dependency (mDNS discovery + TLS)
- [ ] **Universal clipboard** — copy on one device, paste on another (like Apple's Handoff, but cross-platform)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## License

[MIT](LICENSE)
