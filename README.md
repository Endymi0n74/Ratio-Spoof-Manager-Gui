# Ratio Spoof Manager v2

Interface desktop moderne pour [ratio-spoof](https://github.com/ap-pauloafonso/ratio-spoof), migrée de Tkinter vers Tauri (Rust + Web).

Le moteur Go n'est **pas** embarqué sous forme de sources ni de binaire versionné : il est
téléchargé depuis la release du dépôt dédié [Endymi0n74/ratio-spoof](https://github.com/Endymi0n74/ratio-spoof),
seule source de vérité du sidecar (voir [Moteur & sidecar](#moteur--sidecar)).

![Version](https://img.shields.io/badge/version-2.0.3-blue)
![License](https://img.shields.io/badge/license-MIT-green)

**🇫🇷 Français** · [🇬🇧 English](README.en.md)

## Fonctionnalités

- **Multi-sessions** : supervisez plusieurs torrents simultanément
- **Presets** : Seed, Leech, Balanced, Ratio Boost
- **Validation temps réel** : indication visuelle immédiate
- **Drag & Drop** : glissez-déposez vos .torrent
- **Logs colorés** : parsing intelligent des sorties du moteur Go
- **Stats globales** : upload total, ratio moyen, sessions actives
- **Traçabilité de livraison** : fenêtre *A propos* — version et commit git figés dans le binaire à la compilation
- **Notifications toast** : feedback non bloquant
- **Design dark moderne** : interface native GPU-accelerée

## License

MIT — voir [LICENSE](LICENSE)
