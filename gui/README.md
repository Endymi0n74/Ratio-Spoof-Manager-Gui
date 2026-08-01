# Ratio Spoof Manager GUI

## Français

`ratio_spoof_manager.py` est une interface Tkinter pour le moteur en ligne de commande `ratio-spoof`.

Fonctionnalités : journal intégré, validation des unités, port configurable, émulation qBittorrent, prévention des lancements multiples et arrêt contrôlé du moteur. Des builds autonomes sont publiés pour Windows, Linux et macOS.

### Lancer depuis les sources

Python 3.11 ou plus récent est recommandé. Placez une version Windows de `ratio-spoof.exe` à l’emplacement de votre choix, lancez l’interface puis sélectionnez ce moteur avec **Chemin personnalisé**.

```powershell
python .\gui\ratio_spoof_manager.py
```

### Compiler l’exécutable autonome

Depuis la racine du dépôt :

```powershell
python -m pip install -r .\gui\requirements-build.txt
.\gui\build.ps1 -RatioSpoofExecutable .\ratio-spoof.exe
```

Le résultat Windows est écrit dans `dist\RatioSpoofManager-Windows-x86_64.exe`.

Sous Linux ou macOS :

```bash
python -m pip install -r ./gui/requirements-build.txt
chmod +x ./gui/build.sh ./ratio-spoof
./gui/build.sh ./ratio-spoof
```

## English

`ratio_spoof_manager.py` is a Tkinter interface for the `ratio-spoof` command-line engine.

## Run from source

Python 3.11 or newer is recommended. Start the interface, then select a Windows build of `ratio-spoof.exe` using **Custom path**.

```powershell
python .\gui\ratio_spoof_manager.py
```

The interface can also use a custom engine path selected at runtime.

## Build the standalone executable

From the repository root:

```powershell
python -m pip install -r .\gui\requirements-build.txt
.\gui\build.ps1 -RatioSpoofExecutable .\ratio-spoof.exe
```

The Windows build is written to `dist\RatioSpoofManager-Windows-x86_64.exe`. Linux and macOS builds use `gui/build.sh`. The engine is bundled inside the manager and copied to the platform's application-data directory when first launched.

## Accepted values

- Downloaded/uploaded amounts: `%`, `b`, `kb`, `mb`, `gb`, or `tb`
- Download/upload speeds: `kbps` or `mbps`

Common input mistakes such as `100 mbps` and `100mpbs` are normalized automatically.
