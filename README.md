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
- [Go](https://go.dev/dl/) 1.20+ — utile seulement pour reconstruire le moteur ; le sidecar compilé est déjà versionné dans `src-tauri/binaries/`

## Installation

```bash
# 1. Clone
git clone https://github.com/Endymi0n74/ratio-spoof-manager-tauri.git
cd ratio-spoof-manager-tauri

# 2. Dépendances
npm install

# 3. Mode développement
npm run tauri dev

# 4. Exécutable release (sans installateur MSI, donc sans WiX/NSIS à télécharger)
npm run tauri build -- --no-bundle
```

Rien à copier pour lancer l'application : le sidecar est embarqué. Pour le **reconstruire** après une modification du moteur :

```bash
cd engine && GOOS=windows GOARCH=amd64 go build \
    -o ../src-tauri/binaries/ratio-spoof-x86_64-pc-windows-msvc.exe .
```

## Structure du dépôt

| Chemin | Rôle |
|--------|------|
| `src/` | Interface (JS vanilla, composants, styles) |
| `src-tauri/` | Backend Rust (Tauri 2) et sidecar embarqué |
| `engine/` | Moteur Go `ratio-spoof` (source, tests, `Makefile`) |
| `memory.md` | Mémoire du projet : architecture, cycle de vie du moteur, limites connues |

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

## Cycle de vie du moteur

| Étape | Comportement |
|-------|--------------|
| Lancement | Le sidecar embarqué est résolu dans le bundle (à côté de l'exécutable, dans ses ressources, sinon dans le dépôt en développement) ; il est lancé dans son propre groupe de processus, sans console visible |
| Arrêt (`stop_session`) | Le moteur reçoit `CTRL_BREAK_EVENT` sous Windows, `SIGTERM` ailleurs : c'est l'équivalent de `SIGTERM` côté Go, que le moteur traduit en `os.Interrupt` pour envoyer son annonce finale « stopped » au tracker |
| Moteur qui ne répond pas | Tué de force après 10 s (le moteur coincé dans un retry réseau ne doit pas rester vivant) |
| Fermeture de l'application | Tous les moteurs sont arrêtés proprement (3 s), puis tués : aucun ne survit en orphelin |
| Crash de l'application | Chaque moteur est rattaché à un job Windows « kill on close » : dès que le processus de l'application disparaît, Windows tue ses moteurs — même sans fermeture propre |

Sous Windows, l'événement de console ne peut être adressé qu'au groupe de processus d'une console à laquelle l'appelant est attaché : le backend s'attache donc à la console du moteur (`AttachConsole`) avant d'envoyer le signal.

Si le rattachement au job « kill on close » échoue (par exemple quand l'application tourne elle-même dans un job qui interdit l'imbrication), la perte de la garantie est **inscrite en avertissement dans le journal de la session** au démarrage du moteur : elle n'est jamais silencieuse et l'utilisateur sait exactement ce qui reste couvert (le bouton Arrêter, Ctrl+Q) et ce qui ne l'est plus (un arrêt brutal).

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
