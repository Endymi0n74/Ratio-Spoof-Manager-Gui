# Ratio Spoof Manager GUI

`ratio_spoof_manager.py` is a Tkinter interface for the `ratio-spoof` command-line engine.

## Run from source

Python 3.11 or newer is recommended. Place a Windows build of `ratio-spoof.exe` beside the script, then run:

```powershell
python .\ratio_spoof_manager.py
```

The interface can also use a custom engine path selected at runtime.

## Build the standalone executable

From the repository root:

```powershell
python -m pip install -r .\gui\requirements-build.txt
.\gui\build.ps1 -RatioSpoofExecutable .\ratio-spoof.exe
```

The resulting file is written to `dist\RatioSpoofManager-Modern.exe`. The engine is bundled inside the manager and copied to `%LOCALAPPDATA%\RatioSpoofManager\engine` when first launched.

## Accepted values

- Downloaded/uploaded amounts: `%`, `b`, `kb`, `mb`, `gb`, or `tb`
- Download/upload speeds: `kbps` or `mbps`

Common input mistakes such as `100 mbps` and `100mpbs` are normalized automatically.
