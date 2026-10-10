# Ratio Spoof Manager v2

![Version](https://img.shields.io/badge/version-2.0.10-blue)
![Tauri](https://img.shields.io/badge/Tauri-2.x-24c8db)
![License](https://img.shields.io/badge/license-MIT-green)

[🇫🇷 Français](README.md) · **🇬🇧 English**

Modern desktop interface for [ratio-spoof](https://github.com/ap-pauloafonso/ratio-spoof), the Real-Debrid ratio spoofer. **Tauri 2** application: Rust backend, HTML/CSS/JS frontend (Vite), GPU-accelerated WebView2 rendering.

The Go engine is **not** embedded: it is downloaded at build time from the release of the dedicated repository [Endymi0n74/ratio-spoof](https://github.com/Endymi0n74/ratio-spoof), the sidecar's single source of truth (see [Engine & sidecar](#engine--sidecar)).

## Features

- **Multi-sessions**: supervise several torrents at once, each with its own speed chart
- **Presets**: Seed, Leech, Balanced, Ratio Boost — plus your own saved presets
- **Real-time validation**: every field is checked as you type (percentages, `kbps`/`mbps` speeds, port)
- **Drag & Drop**: drop your `.torrent` files into the form
- **Colored logs**: smart parsing of the Go engine's output
- **Global stats**: total upload, average ratio, active sessions
- **Auto-updates**: startup check, signed artifact, then restart (see [Updates](#updates))
- **Delivery traceability**: *About* window — version and git commit frozen into the binary at compile time

## Installation

Two ways to install the app, with two update behaviors:

| | Portable package (`.zip`) | Installer (`_x64-setup.exe`) |
|---|---|---|
| Setup | None — extract and run | Classic NSIS wizard |
| Updates | The prompt appears; accepting launches the installer (installed copy) | Download, signature check, install, restart |

Download the archive from the latest release: [Endymi0n74/Ratio-Spoof-Manager-Gui/releases](https://github.com/Endymi0n74/Ratio-Spoof-Manager-Gui/releases)

**Portable package**: extract the archive **in full** and keep `ratio-spoof-manager.exe` next to its `binaries\` folder — that is where the app looks for the engine. An explicit path remains available via "Custom path" if you separate the two.

**Verify the checksums**: every release ships a `SHA256SUMS.txt` covering all assets.

```bash
# Bash
sha256sum -c SHA256SUMS.txt
# PowerShell
Get-FileHash .\ratio-spoof-manager.exe -Algorithm SHA256
```

## Updates

The app checks the latest release at startup (manual check under *Settings → Check for updates*). If a newer version exists, it announces it and offers to install.

The check reads the release's `latest.json` asset; the downloaded installer is **signature-verified** against the public key embedded in the binary before anything runs — a tampered artifact is rejected. The app restarts itself after installation.

The portable package gets the same prompt: accepting launches the NSIS installer, declining leaves the portable untouched — the question returns on the next start.

## Usage

1. Launch the app.
2. Drag & drop a `.torrent` file (or browse to pick one).
3. Set the download (e.g. `100%`), the upload (e.g. `50%`), the DL/UL speeds (a number, then `kbps` or `mbps`) and the port.
4. Pick the client (or a custom Peer ID).
5. Click **Start session** — the session appears with its live logs and chart.

A complete illustrated guide ships as [GUIDE.html](GUIDE.html) (open it in any browser).

## Development

Prerequisites: [Node.js](https://nodejs.org/) 18+, [Rust](https://rustup.rs/) (MSRV 1.90), and the Windows build tools (Visual Studio C++ Build Tools, NSIS for installers).

```bash
npm install               # frontend dependencies
npm run engine:fetch      # download the Go engine (SHA-256 verified)
npm run tauri:dev         # run the app in development mode

npm run build             # build the frontend (dist/)
cd src-tauri && cargo test --lib   # backend Rust tests
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
npm run tauri:build       # production build (installer + portable)
```

Le lockfile du moteur (`engine.lock.json`) pins the sidecar's version and checksum; `npm run engine:check` verifies the downloaded binary matches.

## Engine & sidecar

The Go engine is downloaded at build time from the release of the dedicated repository [Endymi0n74/ratio-spoof](https://github.com/Endymi0n74/ratio-spoof), where it is built and published per target triple. It is taken byte-for-byte, and its SHA-256 checksum is verified before every build.

The engine is **never** embedded in this repository's binaries nor versioned here: this repository ships only the interface.

## License

MIT — see [LICENSE](LICENSE)
