# CopyX 📋

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

## Roadmap

### 🖥️ Cross-Platform Desktop

- [ ] **macOS support** — native `.dmg` packaging, `Cmd+V` paste simulation via AppleScript/CGEvent, native window focus handling, menu bar tray icon
- [ ] **Windows support** — `.msi`/`.exe` installer, `SendInput` API for paste simulation, Win32 focus management, system tray integration
- [ ] **Wayland full support** — improve paste simulation, window focus and positioning under Wayland compositors

### 🖼️ Rich Content Support

- [ ] **Image clipboard** — detect and store copied images (PNG/JPEG), show thumbnails in history list, full preview in preview panel
- [ ] **Rich text / HTML** — preserve formatting when copying from browsers and editors
- [ ] **File references** — track copied file paths, show file icon and name
- [ ] **Color values** — detect hex/rgb color codes and show color swatches
- [ ] **Code snippets** — syntax highlighting in preview panel

### 📱 Mobile Platforms

- [ ] **iOS app** — clipboard history via App Extensions and Background Tasks (iOS clipboard access is restricted — explore Share Extension and Shortcuts integration)
- [ ] **Android app** — clipboard listener service, floating overlay UI, Accessibility Service for paste simulation

### 🔄 Cross-Device Sync

- [ ] **Cloud sync** — encrypted clipboard history sync across devices (E2E encrypted, user-controlled)
- [ ] **LAN sync** — peer-to-peer sync on the same network without cloud dependency (mDNS discovery + TLS)
- [ ] **Universal clipboard** — copy on one device, paste on another (like Apple's Handoff, but cross-platform)

### ✨ Enhanced UX

- [ ] **Snippets / templates** — save reusable text templates with variables (e.g., email templates, code boilerplate)
- [ ] **Collections / folders** — organize pinned items into named groups
- [ ] **Smart paste** — auto-format when pasting (e.g., strip formatting, trim whitespace, URL encode)
- [ ] **Quick actions** — transform clipboard content (uppercase, lowercase, base64, JSON format, markdown → HTML)
- [ ] **Tagging & labels** — tag items for better organization and search
- [ ] **Statistics** — clipboard usage analytics (most copied items, daily stats)

### 🔧 Developer Features

- [ ] **CLI tool** — `copyx list`, `copyx search`, `copyx paste` for terminal workflows
- [ ] **API / plugin system** — allow third-party integrations and automation
- [ ] **Regex search** — advanced search with regex patterns
- [ ] **Webhooks** — trigger actions on clipboard events

### 🎨 Theming & Polish

- [ ] **Light / dark / auto theme** — follow system appearance
- [ ] **Custom themes** — user-defined color schemes
- [ ] **Custom CSS** — advanced users can inject custom styles
- [ ] **Localization (i18n)** — multi-language support

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## License

[MIT](LICENSE)
