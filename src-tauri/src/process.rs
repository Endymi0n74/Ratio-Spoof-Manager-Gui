use anyhow::{anyhow, bail, Result};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

#[cfg(windows)]
use std::sync::OnceLock;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

pub struct ProcessHandle {
    pub child: Child,
    pub output_rx: mpsc::Receiver<String>,
    /// Message à porter au journal de la session quand la garantie « aucun
    /// moteur ne survit à un crash de l'application » n'a pas pu être mise en
    /// place. L'échec n'est visible nulle part ailleurs : l'application tourne
    /// normalement, seule la protection manque.
    pub job_warning: Option<String>,
}

impl ProcessHandle {
    pub async fn spawn(
        executable: &str,
        args: Vec<String>,
        cwd: Option<&str>,
    ) -> Result<Self> {
        let mut cmd = Command::new(executable);
        cmd.args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }        // Filet de sécurité : si la tâche qui l'a lancé est annulée (arrêt demandé
        // pendant le démarrage, arrêt du runtime), le moteur est tué au lieu d'être
        // abandonné vivant — l'ancien code le laissait annoncer au tracker en
        // orphelin.
        cmd.kill_on_drop(true);

        #[cfg(windows)]
        {
            // CREATE_NO_WINDOW : pas de console visible pour le moteur.
            // CREATE_NEW_PROCESS_GROUP : il devient chef de son propre groupe de
            // processus, ce qui permet de lui adresser CTRL_BREAK_EVENT par son pid.
            cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
        }

        #[cfg(unix)]
        {
            // Même intention : un groupe dédié, que l'on pourra signaler via -pid.
            cmd.process_group(0);
        }

        let mut child = cmd.spawn()?;

        // Ne pas se contenter d'un `eprintln!` : dans une application GUI cette
        // sortie n'est jamais lue. L'avertissement remonte donc à l'appelant,
        // qui l'inscrit dans le journal de la session.
        let job_warning = join_kill_on_close_job(&mut child);

        let (output_tx, output_rx) = mpsc::channel(100);

        if let Some(stdout) = child.stdout.take() {
            let tx = output_tx.clone();
            tokio::spawn(async move {
                let reader = BufReader::new(stdout);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = tx.send(line).await;
                }
            });
        }

        if let Some(stderr) = child.stderr.take() {
            let tx = output_tx;
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = tx.send(line).await;
                }
            });
        }

        Ok(ProcessHandle {
            child,
            output_rx,
            job_warning,
        })
    }

    /// Pid du moteur, utilisé pour lui adresser les signaux d'arrêt.
    pub fn pid(&self) -> Option<u32> {
        self.child.id()
    }
}

// ---------------------------------------------------------------------------
// Arrêt du moteur
// ---------------------------------------------------------------------------

/// Délai laissé au moteur pour annoncer son arrêt au tracker avant d'être tué de
/// force — même valeur que `STOP_GRACE_PERIOD_SECONDS` du GUI Python.
pub const STOP_GRACE_PERIOD: Duration = Duration::from_secs(10);

/// Délai accordé aux moteurs à la fermeture de l'application. Plus court :
/// l'annonce finale ne doit pas retenir l'utilisateur, et le moteur abandonne
/// vite quand le tracker est injoignable (`fireAnnounce` sans reprise).
pub const SHUTDOWN_GRACE_PERIOD: Duration = Duration::from_secs(3);

/// Rattache le moteur au job Windows « kill on close ».
///
/// C'est le complément de `shutdown` : celui-ci gère la fermeture volontaire,
/// mais rien de notre code ne s'exécute si l'application est tuée brutalement
/// (crash, `TerminateProcess` d'un IDE, fin de session). Le job, lui, est tenu
/// par le système : dès que le processus de l'application disparaît, Windows
/// ferme le handle du job et tue tous les moteurs qu'il contient.
///
/// Renvoie le message à journaliser si la garantie n'a pas pu être obtenue, et
/// `None` quand le moteur est effectivement protégé.
#[cfg(windows)]
fn join_kill_on_close_job(child: &mut Child) -> Option<String> {
    let job = match engine_job() {
        Ok(job) => job,
        Err(detail) => return Some(orphan_protection_warning(detail)),
    };

    // Moteur déjà sorti : plus rien à protéger, ce n'est pas un échec.
    let handle = child.raw_handle()?;

    match job.assign(handle) {
        Ok(()) => None,
        Err(e) => Some(orphan_protection_warning(&e.to_string())),
    }
}

/// Hors Windows, il n'existe pas d'équivalent du job « kill on close » : l'arrêt
/// explicite (`SIGTERM`, puis `SIGKILL` après le délai de grâce) reste le seul
/// filet, et il ne couvre pas un crash de l'application.
#[cfg(not(windows))]
fn join_kill_on_close_job(_child: &mut Child) -> Option<String> {
    None
}

/// Message inscrit dans le journal de la session quand la garantie
/// « aucun moteur ne survit à l'application » est perdue.
fn orphan_protection_warning(detail: &str) -> String {
    format!(
        "Protection anti-orphelin inactive : {detail}. Si l'application est tuée brutalement, ce \
         moteur continuera d'annoncer au tracker ; l'arrêt par le bouton Arrêter ou Ctrl+Q reste \
         effectif."
    )
}

/// Le job est créé une fois pour toutes et son handle n'est jamais fermé : c'est
/// précisément sa fermeture — par le système, à la mort de l'application — qui
/// libère les moteurs, et non notre code.
///
/// L'échec éventuel est mémorisé avec le job, pour être rejoué à l'identique
/// dans le journal de **chaque** session, pas seulement de la première.
#[cfg(windows)]
fn engine_job() -> std::result::Result<&'static win::Job, &'static str> {
    static JOB: OnceLock<std::result::Result<win::Job, String>> = OnceLock::new();

    match JOB.get_or_init(|| win::Job::kill_on_close().map_err(|e| e.to_string())) {
        Ok(job) => Ok(job),
        Err(message) => Err(message.as_str()),
    }
}

/// Demande au moteur de s'arrêter proprement.
///
/// Sur Windows, l'équivalent de `SIGTERM` est `CTRL_BREAK_EVENT`, que Go traduit
/// en `os.Interrupt` : le moteur exécute alors son annonce finale « stopped »
/// auprès du tracker. `TerminateProcess` (ce que fait `Child::kill`) ne lui en
/// laisse pas le temps, et laisse un orphelin si le `Child` est simplement
/// abandonné.
///
/// L'événement ne peut être adressé qu'à un groupe de processus de la console de
/// l'appelant ; le moteur tourne dans la sienne (`CREATE_NO_WINDOW`), donc
/// l'appelant doit d'abord s'y attacher.
#[cfg(windows)]
pub fn request_graceful_stop(pid: u32) -> Result<()> {
    win::send_ctrl_break(pid)
        .map_err(|e| anyhow!("impossible d'envoyer CTRL_BREAK_EVENT au moteur (pid {pid}) : {e}"))
}

#[cfg(unix)]
pub fn request_graceful_stop(pid: u32) -> Result<()> {
    unix::signal_group(pid, unix::SIGTERM)
        .map_err(|e| anyhow!("impossible d'envoyer SIGTERM au moteur (pid {pid}) : {e}"))
}

/// Tue le moteur sans ménagement, quand il n'a pas réagi dans le délai de grâce.
#[cfg(windows)]
pub fn force_kill(pid: u32) -> Result<()> {
    win::terminate(pid).map_err(|e| anyhow!("impossible de tuer le moteur (pid {pid}) : {e}"))
}

#[cfg(unix)]
pub fn force_kill(pid: u32) -> Result<()> {
    unix::signal_group(pid, unix::SIGKILL)
        .map_err(|e| anyhow!("impossible de tuer le moteur (pid {pid}) : {e}"))
}

/// Appels système Windows nécessaires à l'arrêt : les déclarer ici évite
/// d'ajouter une dépendance pour cinq fonctions.
#[cfg(windows)]
mod win {
    use std::ffi::c_void;
    use std::io;

    #[link(name = "kernel32")]
    extern "system" {
        fn AttachConsole(process_id: u32) -> i32;
        fn FreeConsole() -> i32;
        fn GenerateConsoleCtrlEvent(ctrl_event: u32, process_group_id: u32) -> i32;
        fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> *mut c_void;
        fn TerminateProcess(process: *mut c_void, exit_code: u32) -> i32;
        fn CloseHandle(object: *mut c_void) -> i32;
        fn CreateJobObjectW(attributes: *mut c_void, name: *const u16) -> *mut c_void;
        fn SetInformationJobObject(
            job: *mut c_void,
            info_class: i32,
            info: *mut c_void,
            info_length: u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: *mut c_void, process: *mut c_void) -> i32;
        #[cfg(test)]
        fn IsProcessInJob(process: *mut c_void, job: *mut c_void, result: *mut i32) -> i32;
    }

    const CTRL_BREAK_EVENT: u32 = 1;
    const PROCESS_TERMINATE: u32 = 0x0001;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;

    /// Envoie `CTRL_BREAK_EVENT` au groupe de processus `pid`.
    ///
    /// Le moteur étant seul dans sa console, l'appelant doit s'y attacher pour
    /// que l'événement l'atteigne — vérifié à l'essai : sans cela l'appel
    /// système renvoie succès mais rien n'arrive au moteur. Quand l'application a
    /// déjà une console (exécution depuis un terminal), `AttachConsole` échoue
    /// par accès refusé et il faut d'abord s'en détacher.
    pub fn send_ctrl_break(pid: u32) -> io::Result<()> {
        unsafe {
            if AttachConsole(pid) == 0 {
                FreeConsole();
                if AttachConsole(pid) == 0 {
                    return Err(io::Error::last_os_error());
                }
            }

            let sent = GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, pid);
            let error = io::Error::last_os_error();
            // On ressort de la console du moteur : l'application n'a rien à y faire
            // et ne doit pas y rester attachée.
            FreeConsole();

            if sent == 0 {
                return Err(error);
            }
            Ok(())
        }
    }

    pub fn terminate(pid: u32) -> io::Result<()> {
        unsafe {
            let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if handle.is_null() {
                return Err(io::Error::last_os_error());
            }
            let killed = TerminateProcess(handle, 1);
            let error = io::Error::last_os_error();
            CloseHandle(handle);
            if killed == 0 {
                return Err(error);
            }
            Ok(())
        }
    }

    // Structures de `JOBOBJECT_EXTENDED_LIMIT_INFORMATION`, au layout C : c'est ce
    // que le noyau lit, donc les champs doivent être exactement à leur place.
    #[repr(C)]
    #[derive(Default)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    #[derive(Default)]
    struct JobBasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    #[derive(Default)]
    pub struct JobExtendedLimitInformation {
        basic_limit_information: JobBasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    /// Job Windows : tous les processus qui y sont rattachés sont tués quand son
    /// dernier handle est fermé.
    pub struct Job(*mut c_void);

    // Un handle de noyau est utilisable depuis n'importe quel thread du processus ;
    // le type ne fait que le porter.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn kill_on_close() -> io::Result<Job> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
                if handle.is_null() {
                    return Err(io::Error::last_os_error());
                }

                let mut limits = JobExtendedLimitInformation::default();
                limits.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let applied = SetInformationJobObject(
                    handle,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                    &mut limits as *mut JobExtendedLimitInformation as *mut c_void,
                    std::mem::size_of::<JobExtendedLimitInformation>() as u32,
                );
                if applied == 0 {
                    let error = io::Error::last_os_error();
                    CloseHandle(handle);
                    return Err(error);
                }

                Ok(Job(handle))
            }
        }

        pub fn assign(&self, process: *mut c_void) -> io::Result<()> {
            if unsafe { AssignProcessToJobObject(self.0, process) } == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }

        /// Ce processus est-il bien membre du job ? (vérification, pas pilotage —
        /// seul le test du chemin de lancement s'en sert)
        #[cfg(test)]
        pub fn contains(&self, process: *mut c_void) -> io::Result<bool> {
            let mut member = 0i32;
            if unsafe { IsProcessInJob(process, self.0, &mut member) } == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(member != 0)
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // Fermer le handle tue tous les membres : c'est exactement l'effet
            // recherché quand le processus de l'application disparaît, et jamais
            // souhaité pendant son fonctionnement — le job vit donc jusqu'à la
            // fin du processus.
            unsafe { CloseHandle(self.0) };
        }
    }
}

/// Équivalents POSIX, déclarés directement : le crate ne dépend plus de `nix`
/// (absent de `Cargo.toml`, ce qui cassait silencieusement les builds non
/// Windows).
#[cfg(unix)]
mod unix {
    use std::io;

    extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }

    pub const SIGTERM: i32 = 15;
    pub const SIGKILL: i32 = 9;

    /// Signale tout le groupe du moteur : il en est le chef (voir `spawn`), donc
    /// un pid négatif l'atteint lui et ses éventuels enfants.
    pub fn signal_group(pid: u32, signal: i32) -> io::Result<()> {
        if unsafe { kill(-(pid as i32), signal) } == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
}

/// Nom du moteur, sans suffixe de cible ni extension.
pub const ENGINE_NAME: &str = "ratio-spoof";

/// Début du nom d'un sidecar suffixé par la cible (`ratio-spoof-<target-triple>`).
const ENGINE_PREFIX: &str = "ratio-spoof-";

/// Le front envoie un nom nu (ex. « ratio-spoof ») quand l'utilisateur choisit
/// le moteur embarqué ; tout ce qui contient un séparateur est un chemin.
fn is_bare_name(requested: &str) -> bool {
    !requested.is_empty() && !requested.contains('/') && !requested.contains('\\')
}

/// Dossiers pouvant contenir le sidecar, du plus probable au moins probable.
fn engine_search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            // Installation : Tauri dépose les binaires externes à côté de
            // l'exécutable, et les ressources du bundle sous `binaries/`.
            dirs.push(parent.to_path_buf());
            dirs.push(parent.join("binaries"));
            // macOS : l'exécutable vit dans Contents/MacOS, les ressources
            // dans Contents/Resources.
            dirs.push(parent.join("../Resources/binaries"));
        }
    }

    // Développement : le sidecar est dans le dépôt, à côté du crate.
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"));
    dirs.push(PathBuf::from("src-tauri").join("binaries"));

    dirs
}

/// Cherche le moteur dans un dossier : d'abord le nom exact, puis le nom
/// suffixé par la cible de compilation (`ratio-spoof-<target-triple>.exe`).
fn find_engine_in(dir: &Path) -> Option<PathBuf> {
    let suffix = std::env::consts::EXE_SUFFIX;

    let exact = dir.join(format!("{ENGINE_NAME}{suffix}"));
    if exact.is_file() {
        return Some(exact);
    }

    let mut matches: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        // L'application elle-même s'appelle `ratio-spoof-manager.exe` dans le
        // paquet portable : la lancer comme moteur ouvrirait une seconde fenêtre
        // de l'interface au lieu de démarrer un torrent.
        .filter(|path| !is_current_executable(path))
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(is_engine_file_name)
        })
        .collect();
    matches.sort();
    matches.into_iter().next()
}

/// Vrai si `name` a la forme d'un sidecar publié : `ratio-spoof-<target-triple>[.exe]`.
///
/// Cette contrainte de forme est ce qui distingue le moteur de l'application :
/// `ratio-spoof-manager.exe` commence comme un sidecar, mais `manager` n'a pas la
/// forme d'un triplet de cible (au moins trois composants).
fn is_engine_file_name(name: &str) -> bool {
    let suffix = std::env::consts::EXE_SUFFIX;
    let Some(rest) = name.strip_prefix(ENGINE_PREFIX) else {
        return false;
    };
    let Some(stem) = rest.strip_suffix(suffix) else {
        return false;
    };

    let parts: Vec<&str> = stem.split('-').collect();
    parts.len() >= 3
        && parts.iter().all(|part| {
            !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        })
}

/// Le moteur ne peut pas être l'application en train de tourner.
fn is_current_executable(path: &Path) -> bool {
    let Ok(current) = std::env::current_exe() else {
        return false;
    };
    if current == path {
        return true;
    }
    match (std::fs::canonicalize(&current), std::fs::canonicalize(path)) {
        (Ok(current), Ok(candidate)) => current == candidate,
        _ => false,
    }
}

/// Dernier recours : le moteur est-il installé dans le `PATH` ?
fn find_engine_in_path() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| find_engine_in(&dir))
}

/// Résout le chemin du moteur à lancer.
///
/// - un chemin explicite (choisi via « Chemin personnalisé ») doit exister ;
/// - un nom nu désigne le moteur embarqué : on cherche le sidecar dans le
///   bundle (à côté de l'exécutable, puis dans ses ressources), dans le dépôt
///   pendant le développement, et seulement en dernier recours dans le `PATH`.
pub fn resolve_engine_path(requested: &str) -> Result<PathBuf> {
    let requested = requested.trim();

    if requested.is_empty() {
        bail!("aucun moteur sélectionné : choisissez le moteur embarqué ou un chemin personnalisé");
    }

    if !is_bare_name(requested) {
        let candidate = PathBuf::from(requested);
        if candidate.is_file() {
            return Ok(candidate);
        }
        bail!(
            "moteur introuvable : {} (fichier inexistant)",
            candidate.display()
        );
    }

    let dirs = engine_search_dirs();
    for dir in &dirs {
        if let Some(found) = find_engine_in(dir) {
            return Ok(found);
        }
    }
    if let Some(found) = find_engine_in_path() {
        return Ok(found);
    }

    // Détail complet côté stderr (console de développement), message compact
    // côté interface car la liste des emplacements serait illisible en toast.
    let searched = dirs
        .iter()
        .map(|dir| dir.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    eprintln!(
        "moteur embarqué « {requested} » introuvable ; emplacements essayés : {searched}, puis le PATH"
    );
    bail!(
        "moteur embarqué « {requested} » introuvable : aucun sidecar à côté de l'application, dans ses ressources, ni dans le dépôt. Récupérez-le avec « npm run engine:fetch » ou choisissez « Chemin personnalisé »."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_names_are_detected() {
        assert!(is_bare_name("ratio-spoof"));
        assert!(is_bare_name("ratio-spoof.exe"));
        assert!(!is_bare_name(r"C:\tools\ratio-spoof.exe"));
        assert!(!is_bare_name("./ratio-spoof"));
        assert!(!is_bare_name(""));
    }

    #[test]
    fn missing_explicit_path_is_rejected() {
        let err = resolve_engine_path(r"C:\definitely\not\here\ratio-spoof.exe")
            .expect_err("un chemin inexistant doit être refusé");
        assert!(err.to_string().contains("moteur introuvable"));
    }

    #[test]
    fn empty_selection_is_rejected() {
        assert!(resolve_engine_path("   ").is_err());
    }

    /// L'avertissement doit nommer ce qui est perdu, sinon il ne sert à rien dans
    /// un journal : l'utilisateur doit comprendre que la seule garantie disparue
    /// concerne un arrêt brutal de l'application.
    #[test]
    fn orphan_protection_warning_explains_the_lost_guarantee() {
        let msg = orphan_protection_warning("job Windows indisponible (accès refusé)");
        assert!(msg.contains("Protection anti-orphelin inactive"), "{msg}");
        assert!(msg.contains("job Windows indisponible (accès refusé)"), "{msg}");
        assert!(msg.contains("tuée brutalement"), "{msg}");
    }

    #[test]
    fn embedded_engine_is_found_in_the_repository() {
        // bin/ est le dossier `src-tauri/binaries`, où vit le sidecar du dépôt.
        let found = resolve_engine_path(ENGINE_NAME)
            .expect("le sidecar embarqué doit être trouvé dans le dépôt");
        assert!(found.is_file(), "{} devrait exister", found.display());

        let name = found
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        assert!(name.starts_with(ENGINE_NAME));
        assert_ne!(
            name,
            format!("{ENGINE_NAME}-manager{}", std::env::consts::EXE_SUFFIX),
            "l'application ne doit jamais être résolue comme moteur"
        );
    }

    #[test]
    fn engine_file_names_must_look_like_a_target_triple() {
        let suffix = std::env::consts::EXE_SUFFIX;

        assert!(is_engine_file_name(&format!(
            "{ENGINE_NAME}-x86_64-pc-windows-msvc{suffix}"
        )));
        assert!(is_engine_file_name(&format!(
            "{ENGINE_NAME}-aarch64-apple-darwin{suffix}"
        )));

        assert!(!is_engine_file_name(&format!("{ENGINE_NAME}-manager{suffix}")));
        assert!(!is_engine_file_name(&format!("{ENGINE_NAME}{suffix}")));
        assert!(!is_engine_file_name(
            "ratio-spoof-manager-v2.0.0-windows-x64-portable.zip"
        ));
        assert!(!is_engine_file_name(ENGINE_NAME));
    }

    #[test]
    fn current_executable_is_recognised_by_path() {
        let exe = std::env::current_exe().expect("chemin du binaire de test");
        assert!(is_current_executable(&exe));
        assert!(!is_current_executable(Path::new(
            "nowhere/ratio-spoof-x86_64-pc-windows-msvc.exe"
        )));
    }

    /// Dossier de sonde isolé : on ne veut pas d'un dossier partagé entre tests
    /// qui tournent en parallèle.
    fn temp_probe_dir(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("dossier de sonde");
        dir
    }

    /// Le paquet portable place l'application et son moteur dans le même dossier,
    /// et l'exécutable s'appelle `ratio-spoof-manager.exe` : il commence donc par
    /// `ratio-spoof-`. Le prendre pour le moteur revient à lancer une seconde
    /// instance de l'interface — une nouvelle fenêtre au lieu d'un torrent.
    #[test]
    fn application_binary_is_not_mistaken_for_the_engine() {
        let dir = temp_probe_dir("rsm-engine-resolution");
        let suffix = std::env::consts::EXE_SUFFIX;

        let app = dir.join(format!("{ENGINE_NAME}-manager{suffix}"));
        std::fs::write(&app, b"l'application, pas le moteur").expect("faux exécutable");
        assert_eq!(
            find_engine_in(&dir),
            None,
            "l'application ne doit jamais être résolue comme moteur"
        );

        let sidecar = dir.join(format!("{ENGINE_NAME}-x86_64-pc-windows-msvc{suffix}"));
        std::fs::write(&sidecar, b"le moteur").expect("faux sidecar");
        assert_eq!(
            find_engine_in(&dir),
            Some(sidecar.clone()),
            "le sidecar suffixé par la cible doit être choisi"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Lance un processus témoin qui ne se termine pas tout seul, avec les mêmes
    /// drapeaux que le moteur (groupe de processus dédié, sans console visible).
    fn spawn_idle_child() -> std::process::Child {
        use std::process::{Command as StdCommand, Stdio};

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let mut cmd = StdCommand::new("cmd");
            cmd.args(["/C", "ping -n 60 127.0.0.1 > NUL"]);
            cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
            cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
            cmd.spawn().expect("processus témoin")
        }

        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            let mut cmd = StdCommand::new("sleep");
            cmd.arg("60");
            cmd.process_group(0);
            cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
            cmd.spawn().expect("processus témoin")
        }
    }

    fn wait_for_exit(child: &mut std::process::Child, timeout: std::time::Duration) -> bool {
        let deadline = std::time::Instant::now() + timeout;
        while std::time::Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        false
    }

    /// Le rattachement doit avoir lieu dans le vrai chemin de lancement — pas
    /// seulement dans le test du job ci-dessous.
    #[cfg(windows)]
    #[tokio::test]
    async fn spawned_engine_is_attached_to_the_kill_on_close_job() {
        let exe = std::env::current_exe().expect("chemin du binaire de test");
        let args = vec![
            "--ignored".to_string(),
            "--exact".to_string(),
            "process::tests::signal_witness".to_string(),
        ];

        let proc_handle = ProcessHandle::spawn(&exe.to_string_lossy(), args, None)
            .await
            .expect("lancement du témoin");

        let job = engine_job().expect("job disponible");
        let child = proc_handle.child.raw_handle().expect("handle du témoin");
        assert!(
            job.contains(child).expect("IsProcessInJob"),
            "le moteur lancé doit être rattaché au job qui le tuera si l'application meurt"
        );

        // Un moteur protégé ne doit rien ajouter au journal : l'avertissement est
        // réservé à la perte réelle de la garantie.
        assert!(
            proc_handle.job_warning.is_none(),
            "aucun avertissement attendu quand le rattachement réussit : {:?}",
            proc_handle.job_warning
        );

        // `kill_on_drop` fait le ménage : le témoin ne doit pas rester vivant.
        drop(proc_handle);
    }

    /// Le moteur ne doit pas survivre à la disparition brutale de l'application.
    /// Un crash ne peut pas être simulé depuis le test, mais la fermeture du job
    /// — ce que fait le système quand le processus meurt — l'est parfaitement.
    #[cfg(windows)]
    #[test]
    fn closing_the_job_kills_assigned_processes() {
        use std::os::windows::io::AsRawHandle;
        use std::time::Duration;

        // Le noyau lit cette structure telle quelle : un champ décalé ferait
        // silencieusement échouer la configuration du job.
        #[cfg(target_pointer_width = "64")]
        assert_eq!(
            std::mem::size_of::<win::JobExtendedLimitInformation>(),
            144,
            "layout de JOBOBJECT_EXTENDED_LIMIT_INFORMATION"
        );

        let job = win::Job::kill_on_close().expect("création du job");
        let mut child = spawn_idle_child();
        job.assign(child.as_raw_handle())
            .expect("rattachement du témoin au job");
        assert!(
            matches!(child.try_wait(), Ok(None)),
            "le témoin doit tourner avant la fermeture du job"
        );

        drop(job);

        let exited = wait_for_exit(&mut child, Duration::from_secs(5));
        if !exited {
            let _ = child.kill();
        }
        assert!(exited, "fermer le job doit tuer les processus rattachés");
    }

    #[test]
    fn force_kill_terminates_the_child() {
        let mut child = spawn_idle_child();
        force_kill(child.id()).expect("l'arrêt forcé doit aboutir");
        let exited = wait_for_exit(&mut child, std::time::Duration::from_secs(5));
        if !exited {
            let _ = child.kill();
        }
        assert!(exited, "le moteur doit être tué par la force");
    }

    /// Témoin du test d'arrêt : un processus qui attend bien plus longtemps que
    /// la fenêtre d'observation. Jamais exécuté par `cargo test` (ignoré) : il
    /// n'est lancé que par `graceful_stop_reaches_a_child_in_its_own_console`.
    ///
    /// Un binaire système ne convient pas comme témoin : `ping`, `cmd` et
    /// compagnie installent leur propre handler de console et avalent
    /// `CTRL_BREAK_EVENT` (vérifié à l'essai). Un binaire Rust n'en installe
    /// aucun, donc le handler par défaut de Windows doit le terminer.
    #[ignore = "lancé comme témoin par le test d'arrêt propre"]
    #[test]
    fn signal_witness() {
        std::thread::sleep(std::time::Duration::from_secs(20));
    }

    /// Le cœur de la correction : le moteur doit recevoir un vrai signal d'arrêt,
    /// pas seulement voir sa tâche de lecture annulée en le laissant orphelin.
    #[cfg(windows)]
    #[test]
    fn graceful_stop_reaches_a_child_in_its_own_console() {
        use std::process::Command as StdCommand;
        use std::process::Stdio;
        use std::time::Duration;

        let exe = std::env::current_exe().expect("chemin du binaire de test");
        let mut cmd = StdCommand::new(exe);
        cmd.args([
            "--ignored",
            "--exact",
            "process::tests::signal_witness",
        ]);
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
        }
        cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        let mut child = cmd.spawn().expect("témoin");
        let pid = child.id();

        // Le témoin doit être en vie avant l'envoi, sinon le test ne prouverait
        // rien de sa sortie.
        std::thread::sleep(Duration::from_millis(700));
        assert!(
            matches!(child.try_wait(), Ok(None)),
            "le témoin doit tourner avant l'envoi du signal"
        );

        match request_graceful_stop(pid) {
            Ok(()) => {
                let exited = wait_for_exit(&mut child, Duration::from_secs(5));
                if !exited {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                assert!(exited, "CTRL_BREAK_EVENT doit terminer le processus témoin");
            }
            Err(e) => {
                // Environnement sans console à rejoindre (session non
                // interactive) : l'envoi est impossible, on le dit et on
                // n'échoue pas pour autant.
                eprintln!("CTRL_BREAK_EVENT non envoyé dans cet environnement : {e}");
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}
