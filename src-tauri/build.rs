// Ce script ne fait plus qu'une chose.
//
// Il interrogeait git pour figer le commit et sa date dans le binaire
// (« traçabilité de livraison », 14/09/2026). Cette information a été
// retirée de la fenêtre « A propos » le 10/10/2026 : le commit n'apportait
// rien d'utile à l'utilisateur, et son « état des sources » était de surcroît
// faux sur le runner Windows (core.autocrlf signale un fichier au contenu
// identique). La version, elle, reste exposée par `CARGO_PKG_VERSION`, que le
// crate lit sans aucune requête git.
//
// Le fichier est conservé plutôt que supprimé : `tauri_build::build()` doit
// s'appeler, et le script sert aussi de point de redémarrage pour cargo.

fn main() {
    tauri_build::build()
}
