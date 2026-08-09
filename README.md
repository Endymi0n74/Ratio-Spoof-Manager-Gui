# Ratio Spoof Manager v2

Interface desktop moderne pour [ratio-spoof](https://github.com/ap-pauloafonso/ratio-spoof), migrée de Tkinter vers Tauri (Rust + Web).

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Fonctionnalités

- **Multi-sessions** : supervisez plusieurs torrents simultanément
- **Presets** : Seed, Leech, Balanced, Ratio Boost
- **Validation temps réel** : indication visuelle immédiate
- **Drag & Drop** : glissez-déposez vos .torrent
- **Logs colorés** : parsing intelligent des sorties du moteur Go
- **Stats globales** : upload total, ratio moyen, sessions actives
- **Notifications toast** : feedback non bloquant
- **Design dark moderne** : interface native GPU-accelerée

## Prérequis

- [Rust](https://rustup.rs/) (1.70+)
- [Node.js](https://nodejs.org/) 20+
- Le binaire `ratio-spoof` (core Go) à placer dans `src-tauri/binaries/`

## Installation

```bash
# 1. Clone
git clone https://github.com/Endymi0n74/Ratio_Spoof_Gui.git
cd Ratio_Spoof_Gui

# 2. Placez le binaire ratio-spoof
cp /chemin/vers/ratio-spoof src-tauri/binaries/
# Windows: cp ratio-spoof.exe src-tauri/binaries/

# 3. Dépendances
npm install

# 4. Mode développement
cargo tauri dev

# 5. Build release
cargo tauri build
```

## Architecture

```
┌─────────────────┐     IPC (invoke)     ┌──────────────────┐
│   Frontend      │ ◄──────────────────► │   Backend Rust   │
│   (HTML/CSS/JS) │                      │   (Tauri)        │
│                 │                      │                  │
│ • Dashboard     │                      │ • SessionManager │
│ • Formulaire    │                      │ • ProcessHandle  │
│ • Logs colorés  │                      │ • Settings       │
│ • Toasts        │                      │ • Validation     │
└─────────────────┘                      └────────┬─────────┘
                                                  │
                                                  │ spawn
                                                  ▼
                                         ┌──────────────────┐
                                         │  Sidecar (Go)    │
                                         │  ratio-spoof     │
                                         └──────────────────┘
```

## Composants

| Fichier | Description |
|---------|-------------|
| `src/app.js` | Orchestration principale, polling, stats |
| `src/components/NewSessionForm.js` | Formulaire + presets + drag-drop |
| `src/components/SessionCard.js` | Carte de session avec métriques |
| `src/components/LogPanel.js` | Journal avec filtres et coloration |
| `src/components/Toast.js` | Système de notifications |
| `src-tauri/src/session.rs` | Gestion multi-sessions et parsing |
| `src-tauri/src/commands.rs` | Commandes IPC exposées au frontend |
| `src-tauri/src/process.rs` | Spawn et contrôle du binaire Go |

## Commandes IPC

| Commande | Description |
|----------|-------------|
| `launch_session` | Démarre une nouvelle session |
| `stop_session` | Arrête une session |
| `pause_session` | Met en pause |
| `resume_session` | Reprend |
| `get_sessions` | Liste toutes les sessions |
| `get_session_logs` | Récupère les logs |
| `get_settings` / `save_settings` | Persistance |
| `pick_torrent` / `pick_executable` | File dialogs natifs |
| `get_presets` | Liste des presets |
| `validate_field` | Validation temps réel |

## Roadmap

- [ ] Tray icon (minimisation barre des tâches)
- [ ] Auto-update via GitHub releases
- [ ] Graphes de ratio (Canvas/SVG)
- [ ] Profils personnalisés utilisateur
- [ ] Raccourcis clavier globaux

## License

MIT — voir [LICENSE](LICENSE)
