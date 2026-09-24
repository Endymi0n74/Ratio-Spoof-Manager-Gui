# Ratio Spoof Manager v2

Modern desktop interface for [ratio-spoof](https://github.com/ap-pauloafonso/ratio-spoof), migrated from Tkinter to Tauri (Rust + Web).

The Go engine is **not** embedded as source code or a versioned binary: it is
downloaded from the release of the dedicated repository [Endymi0n74/ratio-spoof](https://github.com/Endymi0n74/ratio-spoof),
the sidecar's single source of truth (see [Engine & sidecar](#moteur--sidecar)).

![Version](https://img.shields.io/badge/version-2.0.3-blue)
![License](https://img.shields.io/badge/license-MIT-green)

[🇫🇷 Français](README.md) · **🇬🇧 English**

## Features

- **Multi-sessions**: supervise several torrents simultaneously
- **Presets**: Seed, Leech, Balanced, Ratio Boost
- **Real-time validation**: immediate visual feedback
- **Drag & Drop**: drag and drop your .torrent files
- **Colored logs**: smart parsing of the Go engine's output
- **Global stats**: total upload, average ratio, active sessions
- **Delivery traceability**: *About* window — version and git commit frozen into the binary at compile time
- **Toast notifications**: non-blocking feedback
- **Modern dark design**: native GPU-accelerated interface

## License

MIT — see [LICENSE](LICENSE)
