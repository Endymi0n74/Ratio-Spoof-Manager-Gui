# Memory — Ratio Spoof Manager (Tauri)

- **Chemin :** `D:\Codex\ratio-spoof-manager-tauri`
- **Version :** 2.0.0 (`package.json`, `src-tauri/tauri.conf.json`)
- **Quoi :** GUI desktop (**Tauri 2 + Rust + HTML/CSS/JS/Vite**) pour `ratio-spoof`, le spoofeur de ratio Real-Debrid. Rewrite de l'interface Tkinter d'origine (GUI Python historique, dont le `CHANGELOG.md` est archivé dans le dépôt moteur).
- **Doc principale :** [`README.md`](README.md)

---

## Arborescence

| Chemin | Rôle |
|---|---|
| `src/` | Frontend (vite, JS vanilla) — `app.js`, `components/` (`NewSessionForm`, `SessionCard`, `LogPanel`, `Toast`, `SpeedChart`, `worker.js`) |
| `src-tauri/src/` | Backend Rust — `lib.rs`, `commands.rs` (IPC), `session.rs` (SessionManager), `process.rs` (spawn/signal/job), `settings.rs` |
| `src-tauri/binaries/` | Sidecar Go **téléchargé** (`ratio-spoof-<target-triple>[.exe]`), **non versionné** (seul `.gitkeep` est suivi) |
| `scripts/fetch-engine.mjs` + `engine.lock.json` | Récupération du sidecar depuis la release du dépôt moteur (tag + SHA-256 épinglés) |
| `.cache/` | Outils et sauvegardes locaux, **ignoré par Git** (Go portable utilisé pour le dépôt moteur) |

## Dépôt

- **Dépôt moteur (source de vérité du sidecar) :** <https://github.com/Endymi0n74/ratio-spoof> — créé le 13/09/2026, historique repris de `engine/` via `git subtree split -P engine`, CI + workflow de release, release courante `v1.9.1`.
- **GitHub :** <https://github.com/Endymi0n74/Ratio-Spoof-Manager-Gui> — renommé **deux fois** le 13/09/2026 (`Ratio_Spoof_Gui` → `ratio-spoof-manager-tauri` → `Ratio-Spoof-Manager-Gui`), branche unique `master`. Le dossier de travail et l'ancien remote gardent la trace du nom intermédiaire ; l'`origin` du dépôt local a été réaligné sur le nom courant. Release **[v2.0.0](https://github.com/Endymi0n74/Ratio-Spoof-Manager-Gui/releases/tag/v2.0.0)** publiée le 13/09/2026 : paquet portable Windows (`ratio-spoof-manager.exe` + sidecar + `SHA256SUMS.txt`).
- `origin` du dépôt local pointe sur ce nom ; l'ancienne adresse est redirigée par GitHub.
- Historique : le `master` d'origine (96 commits — moteur ratio-spoof depuis 2023 + GUI Python) a été écrasé par un push forcé le 13/09/2026, à la demande. Le moteur vit depuis dans le dépôt `Endymi0n74/ratio-spoof` (historique repris par `git subtree split`), les tags et la release `gui-v1.2.3` ont été supprimés ensuite.
- Le tag annoté `v2.0.0` pointait sur `9cd168e` (« interface complete v2.0.0 »), soit 3 commits en retard : il n'avait jamais été poussé, il a donc été déplacé sur le commit du nettoyage (`0a38164`) puis publié avec la release.
- **Ce dépôt ne contient plus que l'interface** : aucun code Go, aucun binaire versionné.

## Build & vérifications

```bash
# Frontend + backend (sans installateur : évite le téléchargement WiX/NSIS)
npm run tauri build -- --no-bundle     # → src-tauri/target/release/ratio-spoof-manager.exe

# Tests du backend — `npm run build` d'abord : `tauri::generate_context!`
# exige que `dist/` (frontendDist) existe, sinon le crate ne compile pas en test.
npm run build
cd src-tauri && cargo test --lib        # 13 passed, 1 ignored (dont la résolution du moteur)
cd src-tauri && cargo clippy --all-targets
```

- **Toolchain Rust :** 1.97.1 (MSRV déclaré 1.70).
- **Release automatisée :** `.github/workflows/release.yml` (runner `windows-latest`) enchaîne `npm ci` → `engine:fetch` → `npm run build` (produit `dist/`, exigé par `generate_context!`) → **`cargo test --lib`** → `npm run tauri build -- --no-bundle` → assemblage du paquet portable → publication des 4 assets : `ratio-spoof-manager-v<version>-windows-x64-portable.zip` (exe + `binaries/ratio-spoof-x86_64-pc-windows-msvc.exe` + `LISEZ-MOI.txt` + `SHA256SUMS.txt` interne), `ratio-spoof-manager.exe`, le sidecar, et un `SHA256SUMS.txt` global. Le workflow **refuse** un tag dont la version diffère de `package.json`, ne publie **rien** si les tests du backend échouent, et remplace les assets existants (`gh release upload --clobber`) au lieu d'échouer. L'ordre des étapes compte : `engine:fetch` précède les tests, car `embedded_engine_is_found_in_the_repository` résout le moteur sur le vrai `src-tauri/binaries/` du dépôt (vide juste après le checkout). Le mode d'emploi placé dans l'archive est versionné (`packaging/LISEZ-MOI.txt`), les empreintes sont écrites en LF (compatibles `sha256sum -c`). Conséquence assumée : **`package-lock.json` est désormais versionné** (`npm ci` et le cache npm de `setup-node` l'exigent).
- **Build v2.0.0 (13/09/2026, après nettoyage) :** `npm ci` (18 paquets) puis `npm run tauri build -- --no-bundle` → 2 m 37 s, **aucun avertissement**, `src-tauri/target/release/ratio-spoof-manager.exe` (13 906 944 o, sha256 `1bc24e8f…`). Le log confirme l'ordre du nouveau hook : `Running beforeBuildCommand` → `engine:fetch` (sidecar déjà conforme, aucune requête réseau) → `vite build` → compilation cargo. `node_modules/` et `src-tauri/target/` ont été recréés pour ce build (ignorés par Git).
- **Toolchain Go :** 1.20.14, version épinglée par le workflow CI du dépôt moteur. Go **n'est plus requis pour construire l'interface** (le sidecar est téléchargé) ; il ne sert qu'à travailler sur le moteur, et comme Go n'est pas installé sur la machine, une copie **portable locale au projet** vit dans `.cache/go/` (ignoré par Git) : `CGO_ENABLED=0 GOOS=windows GOARCH=amd64 ../ratio-spoof-manager-tauri/.cache/go/bin/go build ./...` depuis le dépôt moteur.

## Moteur et sidecar — une seule source de vérité (13/09/2026)

- Le moteur Go vit dans un **dépôt dédié** : <https://github.com/Endymi0n74/ratio-spoof>. C'est le fork corrigé (7 correctifs d'audit : fuite de connexions tracker, `Notify` bufferisé, `Run() error`, erreurs enveloppées `%w`, lint, vérification de `crypto/rand`, renommage des champs `HttpTracker`), vérifié par `go vet`, `go test ./...` (7 packages) et un test de non-régression sur la fermeture du corps HTTP. Son historique est celui de l'ancien `engine/`, repris par `git subtree split -P engine` (2 commits) ; il a reçu une CI (`go vet` + `go test`, Go 1.20.14) et un workflow de release. `CHANGELOG.md` y conserve l'archive des releases de la GUI Python historique.
- Une release publie **un asset par cible**, nommé exactement comme Tauri attend un `externalBin` (`ratio-spoof-<target-triple>[.exe]`) plus `SHA256SUMS` : `x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`, `x86_64-apple-darwin`, `aarch64-apple-darwin`. Builds en `-trimpath -buildvcs=false` (ni chemin local ni état VCS dans le binaire ; en revanche un build local Windows et la CI Linux ne donnent pas les mêmes octets — c'est le SHA-256 épinglé qui garantit l'intégrité). Release courante : **`v1.9.1`** (poussée le 13/09/2026, tag → workflow → 5 assets + `SHA256SUMS`).
- Côté interface, **plus aucune source ni binaire versionné** : `engine/` a été supprimé (`git rm -r engine`) et `src-tauri/binaries/*` est ignoré par Git (seul `.gitkeep` est suivi). `engine.lock.json` épingle le dépôt, le tag et le SHA-256 de chaque asset ; `scripts/fetch-engine.mjs` (sans aucune dépendance) télécharge, vérifie puis installe le binaire de la cible courante. Appelé par `beforeDevCommand`/`beforeBuildCommand`, et utilisable seul : `npm run engine:fetch` / `engine:check` / `engine:update-lock`, `--force`, `--offline`.
- **Résolution du triple** dans cet ordre : `--target` → `RATIO_SPOOF_TARGET` → `TAURI_ENV_TARGET_TRIPLE` (posé par le CLI Tauri pour les hooks) → `rustc -vV` → plateforme de Node. Empreinte divergente = **build arrêté** avec l'attendu et l'obtenu ; `--offline` interdit le réseau quand le binaire est déjà conforme. Développement du moteur : `RATIO_SPOOF_ENGINE_BIN=<chemin>` installe un binaire local (empreinte affichée mais non vérifiée).
- **Release v2.0.0 de l'interface** — 4 assets, tous produits par le workflow sauf le sidecar qui est repris tel quel (empreinte du moteur conservée, `7c44d541…`) :
  - `ratio-spoof-manager-v2.0.0-windows-x64-portable.zip` — `LISEZ-MOI.txt`, `ratio-spoof-manager.exe`, `binaries/ratio-spoof-x86_64-pc-windows-msvc.exe` et un `SHA256SUMS.txt` interne (vérifié : `sha256sum -c` passe aussi bien dedans que sur les assets bruts) ;
  - `ratio-spoof-manager.exe`, le sidecar, et un `SHA256SUMS.txt` global couvrant les trois.
  Les assets ont été reconstruits après le correctif de résolution du moteur (voir § Moteur) : une archive téléchargée avant le 13/09/2026 16h00 ouvrait une seconde fenêtre au lancement d'une session.
  L'exécutable publié est celui de la CI, donc **différent en octets du build local** (même source, toolchain/linkeur du runner différents). Mieux : deux exécutions du workflow sur le **même commit** ont produit la même taille (13 932 032 o) mais des empreintes différentes — l'exécutable de l'interface n'est **pas reproductible octet pour octet**, chaque exécution régénère donc `SHA256SUMS.txt` ; le sidecar, lui, est téléchargé et strictement identique d'une release à l'autre (`7c44d541…`). Dans `binaries/`, le moteur est trouvé automatiquement (`engine_search_dirs` cherche à côté de l'exe puis dans `binaries/`).
- **Publier une nouvelle version du moteur** : tag `vX.Y.Z` sur le dépôt moteur (le workflow construit et publie), puis côté interface `npm run engine:fetch -- --target=<triple> --force` et `npm run engine:update-lock -- --target=<triple>` pour chaque cible, et mise à jour du `tag` dans `engine.lock.json`.
- **Piège corrigé le 13/09/2026 — le moteur résolu vers l'application elle-même :** `find_engine_in` acceptait tout fichier nommé `ratio-spoof-*`. Or l'application s'appelle `ratio-spoof-manager.exe` (paquet portable comme build `--no-bundle`), donc elle se trouvait dans son propre dossier de recherche et était choisie comme « moteur » : lancer une session ouvrait une **seconde fenêtre de l'interface** au lieu de démarrer un torrent (l'instance fille réaffichait les sessions lues dans `localStorage`, toutes à « Arrêté », d'où l'impression d'un état incohérent). Deux garde-fous : le fichier en cours d'exécution est exclu (comparaison de chemins canoniques) et le suffixe doit avoir la forme d'un triplet de cible — au moins trois composants, ce qui écarte `manager`. Tests de non-régression : `application_binary_is_not_mistaken_for_the_engine` (échouait avant la correction) et `engine_file_names_must_look_like_a_target_triple`. L'ordre de recherche reste : dossier de l'exécutable, son sous-dossier `binaries/`, ressources macOS, puis chemins de développement.
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
- Fichiers volontairement **non versionnés** : `.cache/` (outils locaux), `dist/` (bundle Vite), `node_modules/`, `src-tauri/target/`, `src-tauri/binaries/*` (sidecar téléchargé).
- **Nettoyage du 13/09/2026 :** ~6,5 Go libérés (`node_modules/`, `src-tauri/target/`, ancien sidecar de 2021, archive de l'historique écrasé, `rsm_ultra.zip`), puis ~400 Ko de sources moteur retirées de ce dépôt (déménagées dans `Endymi0n74/ratio-spoof`). Seul le **Go portable** est conservé dans `.cache/go` (Go n'est pas installé sur la machine) : il sert désormais à construire le dépôt moteur, pas l'interface.
