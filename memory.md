# Memory — Ratio Spoof Manager (Tauri)

- **Chemin :** `D:\Codex\ratio-spoof-manager-tauri`
- **Version :** 2.0.0 (`package.json`, `src-tauri/tauri.conf.json`)
- **Quoi :** GUI desktop (**Tauri 2 + Rust + HTML/CSS/JS/Vite**) pour `ratio-spoof`, le spoofeur de ratio Real-Debrid. Rewrite de l'interface Tkinter d'origine (`engine/gui/ratio_spoof_manager.py`).
- **Doc principale :** [`README.md`](README.md)

---

## Arborescence

| Chemin | Rôle |
|---|---|
| `src/` | Frontend (vite, JS vanilla) — `app.js`, `components/` (`NewSessionForm`, `SessionCard`, `LogPanel`, `Toast`, `SpeedChart`, `worker.js`) |
| `src-tauri/src/` | Backend Rust — `lib.rs`, `commands.rs` (IPC), `session.rs` (SessionManager), `process.rs` (spawn/signal/job), `settings.rs` |
| `src-tauri/binaries/` | Sidecar Go embarqué (`ratio-spoof-x86_64-pc-windows-msvc.exe`) |
| `engine/` | **Moteur Go** (`ratio-spoof`), version corrigée (voir § Moteur) |
| `.cache/` | Outils et sauvegardes locaux, **ignoré par Git** (Go portable, ancien sidecar) |

## Dépôt

- **GitHub :** <https://github.com/Endymi0n74/ratio-spoof-manager-tauri> — **renommé le 13/09/2026** (il s'appelait `Ratio_Spoof_Gui`), branche unique `master`, aucun tag ni release.
- `origin` du dépôt local pointe sur ce nom ; l'ancienne adresse est redirigée par GitHub.
- Historique : le `master` d'origine (96 commits — moteur ratio-spoof depuis 2023 + GUI Python) a été écrasé par un push forcé le 13/09/2026, à la demande. Le contenu du moteur est conservé dans `engine/`, les tags et la release `gui-v1.2.3` ont été supprimés ensuite.

## Build & vérifications

```bash
# Frontend + backend (sans installateur : évite le téléchargement WiX/NSIS)
npm run tauri build -- --no-bundle     # → src-tauri/target/release/ratio-spoof-manager.exe

# Tests du backend
cd src-tauri && cargo test --lib        # 10 passed, 1 ignored
cd src-tauri && cargo clippy --all-targets
```

- **Toolchain Rust :** 1.97 (MSRV déclaré 1.70).
- **Toolchain Go :** 1.20.14, version épinglée par `engine/.github/workflows/ci.yml`. Comme Go n'est pas installé sur la machine, une copie **portable locale au projet** vit dans `.cache/go/` (ignoré par Git) : `GOOS=windows GOARCH=amd64 .cache/go/bin/go build ./...`.

## Moteur (engine/) et sidecar

- `engine/` est la **version corrigée** du dépôt `Ratio_Spoof_Gui` (7 correctifs d'audit : fuite de connexions tracker, `Notify` bufferisé, `Run() error`, erreurs enveloppées `%w`, lint, vérification de `crypto/rand`, renommage des champs `HttpTracker`), vérifiée par `go build`, `go vet`, `go test ./...` (7 packages) et un test de non-régression sur la fermeture du corps HTTP.
Le dossier `engine/` ne contient plus que le moteur Go : la GUI Python d'origine (`engine/gui/`), les images du README et le workflow CI (`engine/.github/`, jamais exécuté depuis un sous-dossier) ont été retirés le 13/09/2026. `engine/CHANGELOG.md` reste comme archive des releases de la GUI historique.

- **Reconstruire le sidecar** après toute modification du moteur :
  ```bash
  cd engine && GOOS=windows GOARCH=amd64 ../.cache/go/bin/go build \
      -o ../src-tauri/binaries/ratio-spoof-x86_64-pc-windows-msvc.exe .
  ```
  Le binaire livré : 7 830 528 o, md5 `b74a8b32a95b3af2d65c8d55b3c6b442`. L'ancien binaire de 2021 est archivé dans `.cache/old-sidecar/`.
- **Résolution du sidecar** (`process.rs::resolve_engine_path`) : chemin explicite si fourni ; sinon nom nu (`ratio-spoof`) cherché à côté de l'exécutable, puis dans `<exe>/binaries`, `<exe>/../Resources/binaries` (macOS), dans `src-tauri/binaries` (développement), et enfin dans le `PATH`. Le nom suffixé par le triplet de la cible est accepté sans coder le triplet en dur.

## Cycle de vie du moteur — le point sensible

Le moteur est un processus Go qui annonce périodiquement au tracker ; le tuer brutalement laisse une **annonce « stopped » manquante** et peut laisser un **orphelin qui continue d'annoncer**.

| Situation | Mécanisme |
|---|---|
| Arrêt demandé (`stop_session`) | `CTRL_BREAK_EVENT` sous Windows (l'appelant fait `AttachConsole(pid)` au préalable, sinon l'appel système renvoie succès sans rien délivrer), `SIGTERM` au groupe sur Unix. Go le traduit en `os.Interrupt` → annonce finale « stopped ». |
| Moteur qui ne répond pas | Tué de force après 10 s (`STOP_GRACE_PERIOD`). |
| Fermeture de l'application (`quit_app`, Ctrl+Q) | Arrêt propre de tous les moteurs, délai `SHUTDOWN_GRACE_PERIOD` = 3 s, puis kill. |
| **Crash de l'application** | Chaque moteur est rattaché à un **job Windows `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`** : le handle du job n'est jamais fermé par notre code, c'est Windows qui le libère quand le processus disparaît → tous les moteurs du job sont tués. |
| Job indisponible / rattachement refusé | L'échec est **inscrit en avertissement dans le journal de la session** (`log_orphan_protection`) — jamais silencieux : l'utilisateur voit que la garantie anti-orphelin est perdue, alors que l'arrêt normal reste effectif. |

Détail Windows : `GenerateConsoleCtrlEvent` **renvoie succès même quand rien n'atteint la cible** ; l'événement ne touche qu'un groupe de processus d'une console à laquelle l'appelant est attaché. Ces deux pièges ont été établis par des spikes Go/Rust avant l'écriture du code.

## Tests notables (backend)

- `graceful_stop_reaches_a_child_in_its_own_console` — lance un **témoin Rust** (le binaire de test avec `--ignored`) et vérifie qu'il meurt après `CTRL_BREAK_EVENT`. Testé par mutation : il échoue bien si l'attache à la console est retirée. `ping` / `cmd` ne conviennent pas comme témoins (ils installent leur propre handler et avalent le break).
- `closing_the_job_kills_assigned_processes` — verrouille aussi le layout de `JOBOBJECT_EXTENDED_LIMIT_INFORMATION` (144 o en 64 bits), que le noyau lit tel quel.
- `spawned_engine_is_attached_to_the_kill_on_close_job` — vérifie via `IsProcessInJob` que le **vrai** chemin de lancement rattache bien le moteur, et qu'aucun avertissement n'est émis quand la protection est active.
- `session::tests::orphan_protection_loss_is_journaled` — la perte de la garantie arrive bien en `Warn` dans le journal, et rien n'est écrit quand elle est en place.

## Points ouverts / limites connues

- **Aucun équivalent Unix du job** : sur Linux/macOS, un crash de l'application laisse encore les moteurs vivants (seul l'arrêt explicite est couvert).
- La **cross-compilation complète** du crate pour Linux n'est pas vérifiable ici (sysroot GTK absent) ; le module Unix isolé a été compilé pour `x86_64-unknown-linux-gnu` via un `rustc` ciblé.
- `cargo clippy` conserve un avertissement **préexistant** (`manual Range::contains` dans `extract_ratio`, `session.rs`).
- Le parsing des stats repose sur des heuristiques textuelles (`extract_speed`, `extract_ratio`…) appliquées aux lignes du moteur : à revoir si le format de sortie de `printer.go` change.
- Fichiers volontairement **non versionnés** : `.cache/` (outils locaux), `dist/` (bundle Vite), `node_modules/`, `src-tauri/target/`.
- **Nettoyage du 13/09/2026 :** ~6,5 Go libérés (`node_modules/`, `src-tauri/target/`, ancien sidecar de 2021, archive de l'historique écrasé, `rsm_ultra.zip`). Seul le **Go portable** est conservé dans `.cache/go` (Go n'est pas installé sur la machine) : sans lui, pas de reconstruction du sidecar.
