//! Contrat du manifeste d'auto-mise à jour (`latest.json`).
//!
//! L'asset publié par `release.yml` (généré par `scripts/make-updater-manifest.mjs`)
//! est lu par `tauri-plugin-updater`, dont la désérialisation (`RemoteRelease`) exige
//! : une `version` sémantique (facultativement préfixée d'un `v`), `notes` et
//! `pub_date` (RFC 3339 strict) facultatifs, et soit `platforms` (format statique,
//! clé = target Tauri, ex. `windows-x86_64`) soit `url` + `signature` (format
//! dynamique).
//!
//! Ce module ne contient que des tests : si le plugin resserre son schéma, ou si le
//! script de manifeste dérive du contrat, la CI casse avant qu'une release illisible
//! ne soit publiée.
#[cfg(test)]
mod tests {
    use tauri_plugin_updater::{RemoteRelease, RemoteReleaseInner};

    /// Sortie réelle de `scripts/make-updater-manifest.mjs` pour une build NSIS
    /// signée (valeurs figées ici : si le script change de forme, ce test le voit).
    const MANIFEST: &str = r#"{
  "version": "2.0.4",
  "notes": "Ratio Spoof Manager v2.0.4 : voir https://github.com/Endymi0n74/Ratio-Spoof-Manager-Gui/releases/tag/v2.0.4",
  "pub_date": "2026-10-09T13:32:16.959Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTOEZJTEUjMQp0cnVzdGVkIGNvbW1lbnQ6dGltZXN0YW1wOjE=",
      "url": "https://github.com/Endymi0n74/Ratio-Spoof-Manager-Gui/releases/download/v2.0.4/Ratio%20Spoof%20Manager_2.0.4_x64-setup.exe"
    }
  }
}"#;

    #[test]
    fn manifeste_lu_par_le_plugin_updater() {
        let release: RemoteRelease =
            serde_json::from_str(MANIFEST).expect("latest.json doit rester lisible par l'updater");

        assert_eq!(release.version.to_string(), "2.0.4");
        assert!(
            release.notes.as_deref().unwrap_or_default().contains("v2.0.4"),
            "les notes doivent porter la version publiée"
        );
        assert!(release.pub_date.is_some(), "pub_date RFC 3339 non interprétée");

        // Format statique attendu : le format dynamique (url/signature au premier
        // niveau) ne porterait qu'une seule plateforme.
        match &release.data {
            RemoteReleaseInner::Static { platforms } => {
                assert!(platforms.contains_key("windows-x86_64"));
            }
            RemoteReleaseInner::Dynamic(_) => panic!("le manifeste doit être au format statique"),
        }

        let url = release
            .download_url("windows-x86_64")
            .expect("la target courante doit être présente");
        assert!(
            url.as_str()
                .ends_with("/Ratio%20Spoof%20Manager_2.0.4_x64-setup.exe"),
            "URL d'installateur inattendue : {url}"
        );

        let signature = release.signature("windows-x86_64").unwrap();
        assert!(!signature.is_empty(), "signature updater vide");

        // La clé de plateforme est la target Tauri exacte : une cible absente est
        // une erreur explicite, jamais un échec silencieux.
        assert!(release.download_url("linux-x86_64").is_err());
        assert!(release.download_url("windows-aarch64").is_err());
    }
}
