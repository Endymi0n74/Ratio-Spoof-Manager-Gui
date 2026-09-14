use std::process::Command;

/// Interroge git depuis le dossier du crate. `None` quand git est absent ou que
/// la commande échoue (archive de sources sans `.git`, conteneur minimal) : la
/// valeur de repli est alors explicitement « inconnu », jamais du vide.
fn git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8(out.stdout).ok()?;
    let text = text.trim().to_string();
    (!text.is_empty()).then_some(text)
}

fn main() {
    // L'identité de la livraison est figée dans le binaire : la fenêtre
    // « A propos » peut dire d'où vient l'exécutable qui tourne, sans dépôt git
    // sur la machine de l'utilisateur (et sans se fier au front, qui peut être
    // reconstruit indépendamment).
    let commit = git(&["rev-parse", "--short=7", "HEAD"]).unwrap_or_else(|| "inconnu".into());
    let date = git(&["show", "-s", "--format=%cs", "HEAD"]).unwrap_or_else(|| "inconnue".into());
    let dirty = git(&["status", "--porcelain"]).is_some_and(|status| !status.is_empty());

    println!("cargo:rustc-env=RSM_COMMIT={commit}");
    println!("cargo:rustc-env=RSM_COMMIT_DATE={date}");
    println!("cargo:rustc-env=RSM_DIRTY={}", if dirty { "1" } else { "0" });

    // Sans ces déclarations, le commit resterait figé jusqu'à la prochaine
    // édition de source : cargo ne relance le script que sur ses dépendances.
    // HEAD couvre le changement de branche, refs/heads couvre les commits.
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/refs/heads");
    // Le script tauri-build s'appuie sur ces fichiers : on les redéclare pour ne
    // pas perdre ses redéclenchements en imprimant les nôtres.
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=capabilities");
    println!("cargo:rerun-if-changed=src");

    tauri_build::build()
}
