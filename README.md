# CopyX 📋

A lightweight, keyboard-first clipboard manager for Linux (and cross-platform). Inspired by [Maccy](https://github.com/p0deje/Maccy).

Built with **Tauri + Rust + React + TypeScript**.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

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
sudo dpkg -i copy-x_0.1.0_amd64.deb
sudo apt-get install -f  # install dependencies if needed

# Required for paste simulation
sudo apt install xdotool
```

### AppImage (any Linux)

```bash
chmod +x copy-x_0.1.0_amd64.AppImage
./copy-x_0.1.0_amd64.AppImage
```

### Fedora / RHEL

```bash
sudo rpm -i copy-x-0.1.0-1.x86_64.rpm
```

## Usage

### Quick Start

1. Launch `copy-x` — it runs in the system tray
2. Copy some text in any app
3. Press **`Alt+V`** to open CopyX
4. Type to search, use `↑↓` to navigate, press `Enter` to paste

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+V` | Show/hide CopyX (configurable) |
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

Open settings via `Ctrl+,` or the tray menu. Configuration is saved to `~/.config/copyx/config.json`.

| Setting | Default | Description |
|---------|---------|-------------|
| Global Hotkey | `Alt+V` | Shortcut to toggle CopyX |
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
git clone https://github.com/ZachL1/CopyX.git
cd CopyX
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
CopyX
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

CopyX is inspired by [Maccy](https://github.com/p0deje/Maccy), an excellent clipboard manager for macOS by Alex Rodionov. While CopyX shares no code with Maccy (different language, framework, and platform), its UX design — keyboard-first navigation, instant search, floating panel — is modeled after Maccy's elegant approach.

## License

[MIT](LICENSE)
