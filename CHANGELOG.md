# Changelog

## 1.2.2 - 2026-08-01

- handle the Windows form-feed emitted by `cls` so the live journal refreshes in place;
- publish Windows as an unpacked portable application inside a ZIP archive;
- disable UPX for the Windows build to reduce antivirus false positives.

## 1.2.1 - 2026-08-01

- render terminal refreshes in place instead of duplicating the engine status block;
- remove ANSI terminal control sequences from the integrated execution journal.

## 1.2.0 - 2026-08-01

- add native packaged releases for Windows, Linux, and macOS;
- use platform-specific application-data directories and engine names;
- add portable process-group shutdown, fonts, icons, and file pickers;
- publish all platform artifacts and SHA-256 checksums from one tagged workflow.

## 1.1.0 - 2026-08-01

- integrate the execution log into the main window;
- add configurable port and qBittorrent emulation;
- prevent simultaneous engine launches;
- add controlled shutdown while the engine is active;
- add application version, icon, validation tests, and bilingual documentation;
- add automated Windows builds and tagged GitHub releases.

## 1.0.0 - 2026-08-01

- first public Windows GUI release.
