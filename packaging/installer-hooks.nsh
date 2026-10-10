; Hooks NSIS du Ratio Spoof Manager.
;
; Pourquoi ce fichier existe
; -----------------------
; Le script d'installation par defaut de Tauri 2 cree un raccourci bureau
; dans deux cas seulement :
;
;   1. installation manuelle, via la case a cocher de la page de fin ;
;   2. installation silencieuse ou passive, c'est-a-dire **l'auto-update**.
;
; Mais la fonction `CreateOrUpdateDesktopShortcut` commence par :
;
;   ${If} $UpdateMode = 1
;   ${OrIf} $NoShortcutMode = 1
;     Return
;   ${EndIf}
;
; Or l'updater de Tauri lance l'installateur avec le drapeau `/UPDATE`
; (verifie dans `tauri-plugin-updater-2.13.2/src/updater.rs`). Consequence :
; une mise a jour automatique **supprime le raccourci bureau** au lieu de le
; creer. L'utilisateur qui avait le raccourci le perd a chaque mise a jour,
; et celui qui ne l'avait jamais eu ne l'obtient pas.
;
; Ce hook recree le raccourci apres l'installation, y compris en mode
; `/UPDATE`, en reutilisant la fonction du script principal (meme cible, meme
; AppUserModelID).
;
; Il ne touche qu'a l'installation : le desinstalleur supprime deja le
; raccourci (`Delete "$DESKTOP\${PRODUCTNAME}.lnk"`), donc rien ne traine
; apres une desinstallation.

!macro NSIS_HOOK_POSTINSTALL
  ; `CreateOrUpdateDesktopShortcut` existe dans le script principal et respecte
  ; deja le mode Wix. On ne redefinit pas la fonction : on l'appelle.
  ;
  ; Le garde `$WixMode` n'est pas teste ici volontairement : lors d'une
  ; migration depuis une installation Wix, le script principal appelle deja
  ; cette fonction pour le menu Demarrer ; le raccourci bureau doit suivre le
  ; meme sort, et la fonction appelee gere elle-meme le raccourci de l'ancien
  ; nom de binaire (`$OldMainBinaryName`).
  Call CreateOrUpdateDesktopShortcut
!macroend
