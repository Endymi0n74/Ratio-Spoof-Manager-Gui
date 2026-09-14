use tauri::{
    ipc::{Invoke, InvokeResolver},
    Runtime,
};

/// Encapsule le gestionnaire de commandes dans un garde-fou de panique.
///
/// Pourquoi c'est nécessaire : le dispatch IPC arrive depuis le rappel
/// `WebMessageReceived` de WebView2 — une limite `extern "system"`, où une
/// panique ne peut pas se dérouler normalement (unwind) et aborte le processus
/// (0xc0000409, fastfail). C'est ainsi que l'application entière disparaissait
/// d'un simple clic sur « Arrêter » quand le code de la commande paniquait.
///
/// Le garde-fou attrape la panique au plus près du dispatch : la commande en
/// défaut échoue avec un message d'erreur affiché par l'interface, les autres
/// commandes et l'application continuent. Quand la panique a lieu avant le
/// dispatch (commande inconnue, ACL refusée), la requête est répondue en
/// erreur ici, car personne d'autre ne le fera.
///
/// `AssertUnwindSafe` : `Invoke` n'est pas `UnwindSafe` (les `Arc` internes de
/// Tauri pourraient être observés dans un état incohérent après une panique) ;
/// c'est assumé, car la panique termine le flot normal — la commande est
/// perdue, jamais réutilisée, et seule la réponse d'erreur construite ici
/// survit.
pub fn guarded_invoke_handler<R: Runtime>(
    handler: impl Fn(Invoke<R>) -> bool + Send + Sync + 'static,
) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    move |invoke: Invoke<R>| {
        let command = invoke.message.command().to_string();
        let resolver: InvokeResolver<R> = invoke.resolver.clone();

        let result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| handler(invoke)));

        match result {
            Ok(handled) => handled,
            Err(panic) => {
                let detail = panic_message(&panic);
                eprintln!("commande « {command} » : panique dans le dispatch IPC : {detail}");
                // La commande a paniqué avant d'avoir répondu : le frontend
                // attend toujours. Un échec explicite vaut mieux qu'un
                // processus entier qui disparaît sous ses yeux.
                resolver.reject(format!(
                    "Erreur interne (la commande « {command} » a planté) : {detail}"
                ));
                true
            }
        }
    }
}

/// Premier message d'une panique : `Box<dyn Any>` peut contenir un
/// `&'static str`, un `String` ou n'importe quoi d'autre.
fn panic_message(panic: &Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = panic.downcast_ref::<&'static str>() {
        (*s).to_string()
    } else if let Some(s) = panic.downcast_ref::<String>() {
        s.clone()
    } else {
        "cause inconnue".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panic_message_extracts_the_common_payloads() {
        let static_str: Box<dyn std::any::Any + Send> = Box::new("texte statique");
        assert_eq!(panic_message(&static_str), "texte statique");
        let owned: Box<dyn std::any::Any + Send> = Box::new(String::from("chaîne possédée"));
        assert_eq!(panic_message(&owned), "chaîne possédée");
        let other: Box<dyn std::any::Any + Send> = Box::new(42_u32);
        assert_eq!(panic_message(&other), "cause inconnue");
    }
}
