# Ratio Spoof Manager v2

Interface desktop moderne pour [ratio-spoof](https://github.com/ap-pauloafonso/ratio-spoof), migrée de Tkinter vers Tauri (Rust + Web).

Le moteur Go n'est **pas** embarqué sous forme de sources ni de binaire versionné : il est
téléchargé depuis la release du dépôt dédié [Endymi0n74/ratio-spoof](https://github.com/Endymi0n74/ratio-spoof),
seule source de vérité du sidecar (voir [Moteur & sidecar](#moteur--sidecar)).

![Version](https://img.shields.io/badge/version-2.0.1-blue)
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
- Accès réseau au premier build — le sidecar est récupéré depuis la release du moteur ; [Go](https://go.dev/dl/) 1.20+ n'est nécessaire que pour travailler sur le moteur lui-même

## Installation

```bash
# 1. Clone
git clone https://github.com/Endymi0n74/Ratio-Spoof-Manager-Gui.git
cd Ratio-Spoof-Manager-Gui

# 2. Dépendances
npm install

# 3. Mode développement
npm run tauri dev

# 4. Exécutable release (sans installateur MSI, donc sans WiX/NSIS à télécharger)
npm run tauri build -- --no-bundle
```

Rien à copier à la main : `tauri dev` et `tauri build` exécutent `npm run engine:fetch`
(`beforeDevCommand` / `beforeBuildCommand`), qui télécharge le sidecar de la cible courante
dans `src-tauri/binaries/` après vérification de son empreinte SHA-256. Une fois le fichier
en place et conforme, plus aucun accès réseau n'est nécessaire pour rebuild.

## Structure du dépôt

| Chemin | Rôle |
|--------|------|
| `src/` | Interface (JS vanilla, composants, styles) |
| `src-tauri/` | Backend Rust (Tauri 2) et sidecar téléchargé (`src-tauri/binaries/`, non versionné) |
| `scripts/fetch-engine.mjs` | Téléchargement du sidecar depuis la release du moteur, avec vérification d'empreinte |
| `engine.lock.json` | Épinglage : dépôt + tag du moteur, nom et SHA-256 de l'asset de chaque cible |
| `.github/workflows/release.yml` | Release : build de l'exécutable, assemblage du paquet portable, publication des assets |
| `packaging/LISEZ-MOI.txt` | Mode d'emploi placé dans le paquet portable |
| `memory.md` | Mémoire du projet : architecture, cycle de vie du moteur, limites connues |

## Moteur & sidecar

Le sidecar est le binaire Go `ratio-spoof` lancé par le backend. Pour qu'il n'existe qu'une
seule source de vérité, ce dépôt n'en garde **ni les sources, ni le binaire** :

| Où | Rôle |
|----|------|
| [`Endymi0n74/ratio-spoof`](https://github.com/Endymi0n74/ratio-spoof) | Sources Go, CI (`go vet` + `go test`) et publication des assets d'une release |
| `engine.lock.json` | Tag épinglé + nom et SHA-256 de l'asset de chaque cible supportée |
| `scripts/fetch-engine.mjs` | Télécharge, vérifie puis installe le sidecar dans `src-tauri/binaries/` |

Chaque release du moteur publie un binaire par cible, nommé comme Tauri attend un `externalBin`
(`ratio-spoof-<target-triple>[.exe]`) plus un `SHA256SUMS` : `x86_64-pc-windows-msvc`,
`x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`, `x86_64-apple-darwin`, `aarch64-apple-darwin`.
Le target triple est résolu automatiquement (option `--target`, `TAURI_ENV_TARGET_TRIPLE`, `rustc -vV`,
puis la plateforme de Node).

```bash
npm run engine:fetch                    # installe le sidecar de la cible courante
npm run engine:check                    # vérifie l'empreinte sans rien télécharger
node scripts/fetch-engine.mjs --force   # retélécharge même si l'empreinte est déjà bonne
node scripts/fetch-engine.mjs --offline # refuse tout accès réseau
```

Une empreinte qui ne correspond pas arrête le build avec un message explicite : un asset remplacé
côté release ne passe jamais inaperçu. Pour adopter une nouvelle version du moteur : publier un tag
dans le dépôt moteur, réinstaller chaque cible (`--force`) puis ré-épingler les empreintes
(`npm run engine:update-lock`).

Pour développer le moteur en local, `RATIO_SPOOF_ENGINE_BIN=<chemin>` installe un binaire construit
à la main à la place de l'asset — l'empreinte n'est alors pas vérifiée, mais elle est affichée pour
ré-épinglage.

## Release et paquet portable

Un tag `v*` déclenche [`.github/workflows/release.yml`](.github/workflows/release.yml) (Windows x64,
sans installateur) : `npm ci` → `engine:fetch` (sidecar vérifié) → `npm run build` (le `dist/` exigé
par la compilation du crate) → `cargo test --lib` → `npm run tauri build -- --no-bundle` → assemblage
du paquet → publication. Le workflow refuse de
continuer si la version du tag ne correspond pas à celle de `package.json` (l'archive porterait un faux
numéro de version) ou si un test du backend échoue — rien n'est publié sans être vérifié.

Quatre assets sont publiés :

| Asset | Rôle |
|-------|------|
| `ratio-spoof-manager-v<version>-windows-x64-portable.zip` | Le paquet prêt à l'emploi (voir ci-dessous) |
| `ratio-spoof-manager.exe` | L'exécutable seul |
| `ratio-spoof-x86_64-pc-windows-msvc.exe` | Le sidecar seul (asset du moteur, repris tel quel) |
| `SHA256SUMS.txt` | Empreintes des trois fichiers ci-dessus |

Contenu de l'archive, qui se décompresse et se lance sans installation :

```
ratio-spoof-manager-v2.0.1-windows-x64/
├─ ratio-spoof-manager.exe
├─ binaries/
│  └─ ratio-spoof-x86_64-pc-windows-msvc.exe   # trouvé automatiquement par l'application
├─ LISEZ-MOI.txt
└─ SHA256SUMS.txt                              # empreintes relatives au dossier
```

Reconstruire les assets d'un tag existant sans en créer un nouveau :

```bash
gh workflow run release.yml -f tag=v2.0.0        # build le réf courant (master)
gh workflow run release.yml --ref v2.0.0 -f tag=v2.0.0   # reconstruction fidèle du tag
```

Les assets sont remplacés (`gh release upload --clobber`) : relancer le workflow sur un tag déjà
publié met la release à jour au lieu d'échouer.

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
| Lancement | Le sidecar téléchargé est résolu dans le bundle (à côté de l'exécutable, dans ses ressources, sinon dans le dépôt en développement) ; il est lancé dans son propre groupe de processus, sans console visible |
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
