import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox


COLORS = {
    "bg": "#0B1020",
    "panel": "#121A2F",
    "panel_alt": "#18233D",
    "border": "#263553",
    "text": "#F4F7FF",
    "muted": "#91A0BB",
    "accent": "#7C9CFF",
    "accent_hover": "#96AEFF",
    "green": "#70E1B2",
    "danger": "#FF7E91",
    "input": "#0E162A",
}

APP_VERSION = "1.2.1"
AMOUNT_PATTERN = re.compile(r"^\d+(?:[.,]\d+)?(?:%|b|kb|mb|gb|tb)$", re.IGNORECASE)
SPEED_PATTERN = re.compile(r"^\d+(?:[.,]\d+)?(?:kbps|mbps)$", re.IGNORECASE)
ANSI_ESCAPE_PATTERN = re.compile(r"\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")
ANSI_SCREEN_RESET_PATTERN = re.compile(r"\x1b(?:c|\[(?:2J|H|f))")
SUPPORTED_CLIENTS = ("qbit-4.0.3", "qbit-4.3.3")
IS_WINDOWS = sys.platform == "win32"
IS_MACOS = sys.platform == "darwin"
ENGINE_FILENAME = "ratio-spoof.exe" if IS_WINDOWS else "ratio-spoof"
UI_FONT = "Segoe UI" if IS_WINDOWS else ("SF Pro Display" if IS_MACOS else "DejaVu Sans")
MONO_FONT = "Cascadia Mono" if IS_WINDOWS else ("Menlo" if IS_MACOS else "DejaVu Sans Mono")


def normalize_parameter(value: str) -> str:
    normalized = re.sub(r"\s+", "", value).lower().replace(",", ".")
    return normalized.replace("mpbs", "mbps").replace("kpbs", "kbps")


def parse_terminal_output(content: str) -> tuple[bool, str]:
    """Translate terminal refresh output into an update suitable for a Tk text box."""
    resets_screen = bool(ANSI_SCREEN_RESET_PATTERN.search(content))
    clean_content = ANSI_ESCAPE_PATTERN.sub("", content).replace("\r", "")
    return resets_screen, clean_content


def resource_path(name: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / name


def app_data_folder() -> Path:
    if IS_WINDOWS:
        return Path(os.getenv("LOCALAPPDATA", os.getenv("APPDATA", Path.home()))) / "RatioSpoofManager"
    if IS_MACOS:
        return Path.home() / "Library" / "Application Support" / "RatioSpoofManager"
    return Path(os.getenv("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "RatioSpoofManager"


def settings_path() -> Path:
    folder = app_data_folder()
    folder.mkdir(parents=True, exist_ok=True)
    return folder / "settings.json"


def install_embedded_engine() -> Path:
    """Copy the bundled engine out of PyInstaller's temporary extraction folder."""
    bundled = resource_path(ENGINE_FILENAME)
    folder = app_data_folder() / "engine"
    installed = folder / ENGINE_FILENAME
    try:
        folder.mkdir(parents=True, exist_ok=True)
        if not bundled.exists():
            return installed if installed.exists() else bundled
        if not installed.exists() or installed.stat().st_size != bundled.stat().st_size:
            shutil.copy2(bundled, installed)
        if not IS_WINDOWS:
            installed.chmod(installed.stat().st_mode | 0o111)
        return installed
    except OSError:
        return bundled


class ModernRatioSpoofManager:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title(f"Ratio Spoof Manager {APP_VERSION}")
        self.root.geometry("760x800")
        self.root.minsize(700, 760)
        self.root.configure(bg=COLORS["bg"])
        try:
            self.root_icon = tk.PhotoImage(file=resource_path("assets/app-icon.png"))
            self.root.iconphoto(True, self.root_icon)
        except tk.TclError:
            pass

        self.exe_path = tk.StringVar()
        self.torrent_path = tk.StringVar()
        self.downloaded = tk.StringVar(value="100%")
        self.dl_speed = tk.StringVar(value="10mbps")
        self.uploaded = tk.StringVar(value="50%")
        self.ul_speed = tk.StringVar(value="5mbps")
        self.port = tk.StringVar(value="8999")
        self.client = tk.StringVar(value=SUPPORTED_CLIENTS[0])
        self.use_embedded = tk.BooleanVar(value=True)
        self.status = tk.StringVar(value="Prêt à configurer")
        self.status_color = COLORS["muted"]
        self.process = None
        self.log_panel = None
        self.log_text = None

        self.embedded_exe = install_embedded_engine()
        self._load_settings()
        self._build()
        self._toggle_source()
        self.root.protocol("WM_DELETE_WINDOW", self._close)

    def _build(self):
        self.container = tk.Frame(self.root, bg=COLORS["bg"])
        self.container.pack(fill="both", expand=True)
        self.container.grid_rowconfigure(0, weight=1)
        self.container.grid_columnconfigure(0, weight=1, minsize=700)
        shell = tk.Frame(self.container, bg=COLORS["bg"])
        shell.grid(row=0, column=0, sticky="nsew", padx=34, pady=10)

        header = tk.Frame(shell, bg=COLORS["bg"])
        header.pack(fill="x", pady=(0, 8))
        try:
            self.header_icon = tk.PhotoImage(file=resource_path("assets/app-icon.png")).subsample(19, 19)
            icon = tk.Label(header, image=self.header_icon, bg=COLORS["bg"])
        except tk.TclError:
            icon = tk.Label(header, text="↗", font=(UI_FONT, 24, "bold"), bg=COLORS["accent"],
                            fg=COLORS["bg"], width=2, height=1)
        icon.pack(side="left", padx=(0, 14))
        titles = tk.Frame(header, bg=COLORS["bg"])
        titles.pack(side="left")
        tk.Label(titles, text="Ratio Spoof Manager", font=(UI_FONT, 23, "bold"),
                 bg=COLORS["bg"], fg=COLORS["text"]).pack(anchor="w")
        tk.Label(titles, text="Configurez puis lancez votre session en quelques secondes",
                 font=(UI_FONT, 10), bg=COLORS["bg"], fg=COLORS["muted"]).pack(anchor="w", pady=(3, 0))
        tk.Label(header, text=f"v{APP_VERSION}", font=(UI_FONT, 9, "bold"), bg=COLORS["panel_alt"],
                 fg=COLORS["accent"], padx=10, pady=5).pack(side="right", anchor="n")

        self._section_label(shell, "01", "SOURCE DU PROGRAMME")
        source_card = self._card(shell)
        source_card.pack(fill="x", pady=(4, 8))

        switch_row = tk.Frame(source_card, bg=COLORS["panel"])
        switch_row.pack(fill="x", padx=18, pady=(8, 6))
        self.embedded_btn = self._segmented_button(switch_row, "Version intégrée", True)
        self.embedded_btn.pack(side="left", fill="x", expand=True)
        self.custom_btn = self._segmented_button(switch_row, "Chemin personnalisé", False)
        self.custom_btn.pack(side="left", fill="x", expand=True, padx=(8, 0))

        self.exe_row, self.exe_entry = self._file_row(
            source_card, self.exe_path, f"Sélectionner {ENGINE_FILENAME}", self._browse_exe, "PARCOURIR"
        )
        self.exe_row.pack(fill="x", padx=18, pady=(0, 8))

        self._section_label(shell, "02", "FICHIER TORRENT")
        torrent_card = self._card(shell)
        torrent_card.pack(fill="x", pady=(4, 8))
        torrent_row, _ = self._file_row(
            torrent_card, self.torrent_path, "Sélectionner un fichier .torrent", self._browse_torrent, "CHOISIR"
        )
        torrent_row.pack(fill="x", padx=18, pady=8)

        self._section_label(shell, "03", "PARAMÈTRES DE TRANSFERT")
        metrics = self._card(shell)
        metrics.pack(fill="x", pady=(4, 8))
        grid = tk.Frame(metrics, bg=COLORS["panel"])
        grid.pack(fill="x", padx=18, pady=8)
        grid.columnconfigure((0, 1), weight=1, uniform="metric")
        self._metric(grid, 0, 0, "TÉLÉCHARGÉ", self.downloaded, "ex. 100%")
        self._metric(grid, 0, 1, "VITESSE DESCENDANTE", self.dl_speed, "ex. 10mbps")
        self._metric(grid, 1, 0, "UPLOADÉ", self.uploaded, "ex. 50%")
        self._metric(grid, 1, 1, "VITESSE MONTANTE", self.ul_speed, "ex. 5mbps")

        self._section_label(shell, "04", "OPTIONS DU CLIENT")
        options = self._card(shell)
        options.pack(fill="x", pady=(4, 8))
        option_grid = tk.Frame(options, bg=COLORS["panel"])
        option_grid.pack(fill="x", padx=18, pady=8)
        option_grid.columnconfigure((0, 1), weight=1, uniform="option")
        self._metric(option_grid, 0, 0, "PORT D'ÉCOUTE", self.port, "1 à 65535")
        client_box = tk.Frame(option_grid, bg=COLORS["panel"])
        client_box.grid(row=0, column=1, sticky="ew", padx=(8, 0))
        tk.Label(client_box, text="ÉMULATION CLIENT", font=(UI_FONT, 8, "bold"),
                 bg=COLORS["panel"], fg=COLORS["muted"]).pack(anchor="w", pady=(0, 6))
        client_menu = tk.OptionMenu(client_box, self.client, *SUPPORTED_CLIENTS)
        client_menu.configure(font=(UI_FONT, 10, "bold"), bg=COLORS["input"], fg=COLORS["text"],
                              activebackground=COLORS["border"], activeforeground=COLORS["text"],
                              relief="flat", bd=0, highlightthickness=0)
        client_menu["menu"].configure(bg=COLORS["panel_alt"], fg=COLORS["text"],
                                      activebackground=COLORS["accent"], activeforeground=COLORS["bg"])
        client_menu.pack(fill="x", ipady=4)

        footer = tk.Frame(shell, bg=COLORS["bg"])
        footer.pack(fill="x", pady=(2, 0))
        self.status_label = tk.Label(footer, textvariable=self.status, font=(UI_FONT, 10),
                                     bg=COLORS["bg"], fg=self.status_color)
        self.status_label.pack(side="left")
        self.launch_btn = tk.Button(
            footer, text="LANCER  →", command=self._launch, font=(UI_FONT, 12, "bold"),
            bg=COLORS["accent"], fg="#081126", activebackground=COLORS["accent_hover"],
            activeforeground="#081126", bd=0, padx=30, pady=13, cursor="hand2"
        )
        self.launch_btn.pack(side="right")
        self.launch_btn.bind("<Enter>", lambda _e: self.launch_btn.configure(bg=COLORS["accent_hover"]))
        self.launch_btn.bind("<Leave>", lambda _e: self.launch_btn.configure(bg=COLORS["accent"]))

    def _section_label(self, parent, number, title):
        row = tk.Frame(parent, bg=COLORS["bg"])
        row.pack(fill="x")
        tk.Label(row, text=number, font=(UI_FONT, 9, "bold"), bg=COLORS["bg"],
                 fg=COLORS["accent"]).pack(side="left")
        tk.Label(row, text=title, font=(UI_FONT, 9, "bold"), bg=COLORS["bg"],
                 fg=COLORS["muted"]).pack(side="left", padx=(9, 0))

    def _card(self, parent):
        return tk.Frame(parent, bg=COLORS["panel"], highlightthickness=1,
                        highlightbackground=COLORS["border"], highlightcolor=COLORS["border"])

    def _segmented_button(self, parent, text, embedded):
        return tk.Button(parent, text=text, command=lambda: self._set_source(embedded),
                         font=(UI_FONT, 10, "bold"), bd=0, pady=9, cursor="hand2")

    def _set_source(self, embedded):
        self.use_embedded.set(embedded)
        self._toggle_source()

    def _toggle_source(self):
        embedded = self.use_embedded.get()
        active = dict(bg=COLORS["accent"], fg="#081126", activebackground=COLORS["accent_hover"])
        idle = dict(bg=COLORS["panel_alt"], fg=COLORS["muted"], activebackground=COLORS["panel_alt"])
        self.embedded_btn.configure(**(active if embedded else idle))
        self.custom_btn.configure(**(idle if embedded else active))
        if embedded:
            self.exe_path.set(str(self.embedded_exe))
            self.exe_entry.configure(state="disabled", disabledbackground=COLORS["input"],
                                     disabledforeground=COLORS["muted"])
        else:
            self.exe_entry.configure(state="normal")

    def _file_row(self, parent, variable, placeholder, command, button_text):
        row = tk.Frame(parent, bg=COLORS["panel"])
        entry = tk.Entry(row, textvariable=variable, font=(UI_FONT, 10), bg=COLORS["input"],
                         fg=COLORS["text"], insertbackground=COLORS["text"], relief="flat", bd=0)
        entry.pack(side="left", fill="x", expand=True, ipady=10, padx=(0, 10))
        if not variable.get():
            entry.insert(0, "")
        button = tk.Button(row, text=button_text, command=command, font=(UI_FONT, 9, "bold"),
                           bg=COLORS["panel_alt"], fg=COLORS["text"], activebackground=COLORS["border"],
                           activeforeground=COLORS["text"], bd=0, padx=15, pady=10, cursor="hand2")
        button.pack(side="right")
        return row, entry

    def _metric(self, parent, row, column, label, variable, hint):
        box = tk.Frame(parent, bg=COLORS["panel"])
        box.grid(row=row, column=column, sticky="ew", padx=(0 if column == 0 else 8, 8 if column == 0 else 0),
                 pady=(0 if row == 0 else 12, 0))
        tk.Label(box, text=label, font=(UI_FONT, 8, "bold"), bg=COLORS["panel"],
                 fg=COLORS["muted"]).pack(anchor="w", pady=(0, 6))
        tk.Entry(box, textvariable=variable, font=(UI_FONT, 11, "bold"), bg=COLORS["input"],
                 fg=COLORS["text"], insertbackground=COLORS["text"], relief="flat", bd=0).pack(fill="x", ipady=9)
        tk.Label(box, text=hint, font=(UI_FONT, 8), bg=COLORS["panel"],
                 fg=COLORS["muted"]).pack(anchor="w", pady=(4, 0))

    def _browse_exe(self):
        filters = [("Exécutable", "*.exe")] if IS_WINDOWS else [("Tous les fichiers", "*")]
        path = filedialog.askopenfilename(title=f"Choisir {ENGINE_FILENAME}", filetypes=filters)
        if path:
            self.exe_path.set(path)

    def _browse_torrent(self):
        path = filedialog.askopenfilename(title="Choisir le fichier .torrent", filetypes=[("Torrent", "*.torrent")])
        if path:
            self.torrent_path.set(path)
            self._set_status("Torrent sélectionné", COLORS["green"])

    def _set_status(self, text, color):
        self.status.set(text)
        self.status_label.configure(fg=color)

    def _validate(self):
        exe = self.embedded_exe if self.use_embedded.get() else Path(self.exe_path.get().strip())
        torrent = Path(self.torrent_path.get().strip())
        if not exe.is_file():
            return None, None, f"Le programme {ENGINE_FILENAME} est introuvable."
        if not torrent.is_file() or torrent.suffix.lower() != ".torrent":
            return None, None, "Sélectionnez un fichier .torrent valide."
        fields = [self.downloaded, self.dl_speed, self.uploaded, self.ul_speed]
        if any(not field.get().strip() for field in fields):
            return None, None, "Tous les paramètres de transfert sont obligatoires."
        self._normalize_parameters()
        if not AMOUNT_PATTERN.fullmatch(self.downloaded.get()) or not AMOUNT_PATTERN.fullmatch(self.uploaded.get()):
            return None, None, "Les quantités doivent utiliser %, b, kb, mb, gb ou tb (ex. 100%)."
        if not SPEED_PATTERN.fullmatch(self.dl_speed.get()) or not SPEED_PATTERN.fullmatch(self.ul_speed.get()):
            return None, None, "Les vitesses doivent utiliser kbps ou mbps, sans espace (ex. 100mbps)."
        try:
            port = int(self.port.get())
        except ValueError:
            return None, None, "Le port doit être un nombre compris entre 1 et 65535."
        if not 1 <= port <= 65535:
            return None, None, "Le port doit être compris entre 1 et 65535."
        if self.client.get() not in SUPPORTED_CLIENTS:
            return None, None, "Sélectionnez une émulation client prise en charge."
        return exe, torrent, None

    def _normalize_parameters(self):
        for variable in (self.downloaded, self.dl_speed, self.uploaded, self.ul_speed):
            variable.set(normalize_parameter(variable.get()))

    def _launch(self):
        if self.process and self.process.poll() is None:
            self._set_status("Un moteur est déjà en cours d’exécution", COLORS["danger"])
            if self.log_panel:
                self.log_panel.focus_set()
            return
        exe, torrent, error = self._validate()
        if error:
            self._set_status(error, COLORS["danger"])
            messagebox.showerror("Configuration incomplète", error)
            return
        recap = (
            f"Torrent : {torrent.name}\n\n"
            f"Téléchargé : {self.downloaded.get()}  •  {self.dl_speed.get()}\n"
            f"Uploadé : {self.uploaded.get()}  •  {self.ul_speed.get()}\n"
            f"Client : {self.client.get()}  •  Port : {self.port.get()}"
        )
        if not messagebox.askyesno("Confirmer le lancement", recap + "\n\nLancer maintenant ?"):
            return
        args = [str(exe), "-t", str(torrent), "-d", self.downloaded.get().strip(),
                "-ds", self.dl_speed.get().strip(), "-u", self.uploaded.get().strip(),
                "-us", self.ul_speed.get().strip(), "-p", self.port.get().strip(),
                "-c", self.client.get()]
        try:
            self._open_log_panel(torrent.name)
            platform_options = (
                {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}
                if IS_WINDOWS
                else {"start_new_session": True}
            )
            self.process = subprocess.Popen(
                args,
                cwd=str(exe.parent),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                **platform_options,
            )
            self._save_settings()
            self._append_log("Commande lancée. En attente du moteur…\n")
            self._set_status("Moteur en cours d’exécution", COLORS["green"])
            self.launch_btn.configure(state="disabled", text="EN COURS…")
            threading.Thread(target=self._monitor_process, daemon=True).start()
        except Exception as exc:
            self._set_status("Échec du lancement", COLORS["danger"])
            messagebox.showerror("Erreur de lancement", str(exc))

    def _open_log_panel(self, torrent_name):
        if self.log_panel and self.log_panel.winfo_exists():
            self.log_panel.destroy()
        self.root.geometry("1260x800")
        self.root.minsize(1050, 760)
        self.container.grid_columnconfigure(1, weight=1, minsize=450)
        self.log_panel = tk.Frame(self.container, bg=COLORS["panel"], highlightthickness=1,
                                  highlightbackground=COLORS["border"])
        self.log_panel.grid(row=0, column=1, sticky="nsew", padx=(0, 24), pady=18)
        head = tk.Frame(self.log_panel, bg=COLORS["panel"])
        head.pack(fill="x", padx=22, pady=(20, 12))
        tk.Label(head, text="Journal d’exécution", font=(UI_FONT, 17, "bold"),
                 bg=COLORS["panel"], fg=COLORS["text"]).pack(anchor="w")
        tk.Label(head, text=torrent_name, font=(UI_FONT, 9), bg=COLORS["panel"],
                 fg=COLORS["muted"]).pack(anchor="w", pady=(3, 0))
        self.log_text = tk.Text(self.log_panel, bg=COLORS["input"], fg=COLORS["text"],
                                insertbackground=COLORS["text"], relief="flat", bd=0,
                                font=(MONO_FONT, 10), padx=14, pady=14, wrap="word")
        self.log_text.pack(fill="both", expand=True, padx=22)
        controls = tk.Frame(self.log_panel, bg=COLORS["panel"])
        controls.pack(fill="x", padx=22, pady=16)
        tk.Button(controls, text="ARRÊTER LE MOTEUR", command=self._stop_process,
                  font=(UI_FONT, 9, "bold"), bg=COLORS["panel_alt"], fg=COLORS["danger"],
                  activebackground=COLORS["border"], activeforeground=COLORS["danger"],
                  bd=0, padx=16, pady=9, cursor="hand2").pack(side="left")
        tk.Button(controls, text="MASQUER LE JOURNAL", command=self._hide_log_panel,
                  font=(UI_FONT, 9, "bold"), bg=COLORS["accent"], fg="#081126",
                  activebackground=COLORS["accent_hover"], bd=0, padx=16, pady=9,
                  cursor="hand2").pack(side="right")

    def _hide_log_panel(self):
        if self.log_panel and self.log_panel.winfo_exists():
            self.log_panel.destroy()
        self.log_panel = None
        self.log_text = None
        self.container.grid_columnconfigure(1, weight=0, minsize=0)
        self.root.minsize(700, 760)
        self.root.geometry("760x800")

    def _append_log(self, content):
        if self.log_text and self.log_text.winfo_exists():
            resets_screen, clean_content = parse_terminal_output(content)
            if resets_screen:
                self.log_text.delete("1.0", "end")
            self.log_text.insert("end", clean_content)
            self.log_text.see("end")

    def _monitor_process(self):
        process = self.process
        try:
            for line in process.stdout:
                self.root.after(0, self._append_log, line)
            code = process.wait()
            self.root.after(0, self._process_finished, code)
        except Exception as exc:
            self.root.after(0, self._append_log, f"\nErreur de lecture : {exc}\n")

    def _process_finished(self, code):
        self.process = None
        self.launch_btn.configure(state="normal", text="LANCER  →")
        self._append_log(f"\nLe moteur s’est arrêté avec le code {code}.\n")
        if code == 0:
            self._set_status("Moteur arrêté", COLORS["muted"])
        else:
            self._set_status(f"Le moteur a quitté avec l’erreur {code}", COLORS["danger"])

    def _stop_process(self):
        if self.process and self.process.poll() is None:
            if IS_WINDOWS:
                self.process.terminate()
            else:
                os.killpg(self.process.pid, signal.SIGTERM)
            self._append_log("\nArrêt demandé…\n")

    def _load_settings(self):
        try:
            data = json.loads(settings_path().read_text(encoding="utf-8"))
            self.exe_path.set(data.get("exe_path", ""))
            self.downloaded.set(data.get("downloaded", "100%"))
            self.dl_speed.set(data.get("dl_speed", "10mbps"))
            self.uploaded.set(data.get("uploaded", "50%"))
            self.ul_speed.set(data.get("ul_speed", "5mbps"))
            self.port.set(str(data.get("port", "8999")))
            self.client.set(data.get("client", SUPPORTED_CLIENTS[0]))
            self.use_embedded.set(bool(data.get("use_embedded", True)))
        except (OSError, ValueError, TypeError):
            pass

    def _save_settings(self):
        data = {"exe_path": self.exe_path.get(), "downloaded": self.downloaded.get(),
                "dl_speed": self.dl_speed.get(), "uploaded": self.uploaded.get(),
                "ul_speed": self.ul_speed.get(), "port": self.port.get(),
                "client": self.client.get(), "use_embedded": self.use_embedded.get()}
        try:
            settings_path().write_text(json.dumps(data, indent=2), encoding="utf-8")
        except OSError:
            pass

    def _close(self):
        if self.process and self.process.poll() is None:
            should_stop = messagebox.askyesno(
                "Moteur actif",
                "Le moteur est encore en cours d’exécution.\n\n"
                "Voulez-vous l’arrêter et quitter ?\n"
                "Choisissez Non pour garder l’application ouverte.",
            )
            if not should_stop:
                return
            self._stop_process()
        self._save_settings()
        self.root.destroy()


if __name__ == "__main__":
    app_root = tk.Tk()
    ModernRatioSpoofManager(app_root)
    app_root.mainloop()
