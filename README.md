# Ratio Spoof Manager v2

![Version](https://img.shields.io/badge/version-2.0.10-blue)
![Tauri](https://img.shields.io/badge/Tauri-2.x-24c8db)
![License](https://img.shields.io/badge/license-MIT-green)

**🇫🇷 Français** · [🇬🇧 English](README.en.md)

Interface desktop moderne pour [ratio-spoof](https://github.com/ap-pauloafonso/ratio-spoof), le spoofeur de ratio Real-Debrid. Application **Tauri 2** : backend Rust, frontend HTML/CSS/JS (Vite), rendu WebView2 accéléré GPU.

Le moteur Go n'est **pas** embarqué : il est téléchargé au build depuis la release du dépôt dédié [Endymi0n74/ratio-spoof](https://github.com/Endymi0n74/ratio-spoof), seule source de vérité du sidecar (voir [Moteur & sidecar](#moteur--sidecar)).

## Fonctionnalités

- **Multi-sessions** : supervisez plusieurs torrents simultanément, chacun avec son graphique de vitesse
- **Presets** : Seed, Leech, Balanced, Ratio Boost — et enregistrement de vos propres presets
- **Validation temps réel** : chaque champ est vérifié au fil de la saisie (pourcentages, vitesses `kbps`/`mbps`, port)
- **Drag & Drop** : glissez-déposez vos fichiers `.torrent` dans le formulaire
- **Logs colorés** : parsing intelligent des sorties du moteur Go
- **Stats globales** : upload total, ratio moyen, sessions actives
- **Mises à jour automatiques** : vérification au démarrage, artefact signé puis redémarrage (voir [Mises à jour](#mises-à-jour))
- **Traçabilité de livraison** : fenêtre *A propos* — version et commit git figés dans le binaire à la compilation

## Installation

Deux façons d'installer l'application, deux comportements de mise à jour :

| | Paquet portable (`.zip`) | Installateur (`_x64-setup.exe`) |
|---|---|---|
| Installation | Aucune — décompressez et lancez | Assistant NSIS classique |
| Mises à jour | L'annonce apparaît ; accepter lance l'installateur (copie installée) | Téléchargement, vérification de signature, installation, redémarrage |

Téléchargez l'archive de la dernière release : [Endymi0n74/Ratio-Spoof-Manager-Gui/releases](https://github.com/Endymi0n74/Ratio-Spoof-Manager-Gui/releases)

**Paquet portable** : décompressez l'archive **en entier** et gardez `ratio-spoof-manager.exe` à côté de son dossier `binaries\` — c'est là que l'application cherche le moteur. Un chemin explicite reste possible via « Chemin personnalisé » si vous séparez les deux.

**Vérifier les empreintes** : chaque release publie un `SHA256SUMS.txt` couvrant tous les assets.

```powershell
# PowerShell
Get-FileHash .\ratio-spoof-manager.exe -Algorithm SHA256
# Bash
sha256sum -c SHA256SUMS.txt
```

## Mises à jour

L'application vérifie la release la plus récente au démarrage (vérification manuelle dans *Paramètres → Verifier une mise a jour*). Si une version plus récente existe, elle annonce la version et propose l'installation.

Le contrôle lit l'asset `latest.json` de la release ; l'installateur téléchargé est **vérifié par signature** contre la clé publique figée dans le binaire avant toute exécution — un artefact altéré est refusé. L'application redémarre d'elle-même après installation.

En paquet portable, la même annonce apparaît : accepter lance l'installateur NSIS, refuser laisse le portable intact — la question est reposée au démarrage suivant.

## Utilisation

1. Lancez l'application.
2. Glissez-déposez un fichier `.torrent` (ou parcourez pour en choisir un).
3. Réglez le téléchargement (ex. `100%`), l'upload (ex. `50%`), les vitesses DL/UL (un nombre, puis `kbps` ou `mbps`) et le port.
4. Choisissez le client (ou un Peer ID personnalisé).
5. Cliquez **Lancer la session** — la session apparaît avec ses logs et son graphique en direct.

Un guide illustré complet est fourni dans [GUIDE.html](GUIDE.html) (ouvre-le dans n'importe quel navigateur).

## Développement

Prérequis : [Node.js](https://nodejs.org/) 18+, [Rust](https://rustup.rs/) (MSRV 1.90), et les outils de build Windows (Visual Studio C++ Build Tools, NSIS pour les installateurs).

```bash
npm install               # dépendances frontend
npm run engine:fetch      # télécharge le moteur Go (empreinte SHA-256 vérifiée)
npm run tauri:dev         # application en mode développement

npm run build             # build du frontend (dist/)
npm test                  # tests du frontend (vitest + jsdom)
cd src-tauri && cargo test --lib   # tests du backend Rust
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
npm run tauri:build       # build de production (installateur + portable)
```

Les deux suites sont exécutées par la CI à chaque push : `cargo test` pour le backend, `npm test` pour le frontend (qui instancie réellement l'application et vérifie que le DOM se remplit). Le test frontend est ce qui empêche qu'une exception au démarrage — qui vide l'interface sans message — arrive en production.

Le lockfile du moteur (`engine.lock.json`) épinglage la version et l'empreinte du sidecar ; `npm run engine:check` vérifie que le binaire téléchargé correspond bien.

## Moteur & sidecar

Le moteur Go est téléchargé au build depuis la release du dépôt dédié [Endymi0n74/ratio-spoof](https://github.com/Endymi0n74/ratio-spoof), où il est construit et publié par target triple. Il est récupéré tel quel (mêmes octets) et son empreinte SHA-256 est vérifiée avant chaque build.

Le moteur n'est **jamais** embarqué dans les binaires de ce dépôt ni versionné ici : ce dépôt livre uniquement l'interface.

## Licence

MIT — voir [LICENSE](LICENSE)
