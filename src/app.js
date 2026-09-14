import { invoke } from '@tauri-apps/api/core';
import { NewSessionForm } from './components/NewSessionForm.js';
import { SessionCard } from './components/SessionCard.js';
import { LogPanel } from './components/LogPanel.js';
import { Toast } from './components/Toast.js';
import { SpeedChart } from './components/SpeedChart.js';

const ICONS = {
  upload: `<svg width='16' height='16' viewBox='0 0 24 24' fill='none'><path fill-rule='evenodd' clip-rule='evenodd' d='M11.3636 3.36358C11.7151 3.01211 12.2849 3.01211 12.6364 3.36358L17.0808 7.80802C17.4323 8.1595 17.4323 8.72934 17.0808 9.08082C16.7293 9.43229 16.1595 9.43229 15.808 9.08082L12.9 6.17277V14.6666C12.9 15.1637 12.497 15.5666 12 15.5666C11.5029 15.5666 11.1 15.1637 11.1 14.6666V6.17277L8.19193 9.08082C7.84046 9.43229 7.27061 9.43229 6.91914 9.08082C6.56766 8.72934 6.56766 8.1595 6.91914 7.80802L11.3636 3.36358Z' fill='currentColor'/></svg>`,
  download: `<svg width='16' height='16' viewBox='0 0 24 24' fill='none'><path fill-rule='evenodd' clip-rule='evenodd' d='M12 2.90002C12.4971 2.90002 12.9 3.30297 12.9 3.80002V12.2939L15.8081 9.38585C16.1595 9.03438 16.7294 9.03438 17.0808 9.38585C17.4323 9.73732 17.4323 10.3072 17.0808 10.6586L12.6364 15.1031C12.4676 15.2719 12.2387 15.3667 12 15.3667C11.7613 15.3667 11.5324 15.2719 11.3636 15.1031L6.91917 10.6586C6.5677 10.3072 6.5677 9.73732 6.91917 9.38585C7.27064 9.03438 7.84049 9.03438 8.19196 9.38585L11.1 12.2939V3.80002C11.1 3.30297 11.503 2.90002 12 2.90002Z' fill='currentColor'/></svg>`,
  play: `<svg width='16' height='16' viewBox='0 0 24 24' fill='none'><path d='M7.76253 3.10547C8.25778 3.10552 8.74424 3.23849 9.17073 3.49023L19.533 9.60742C20.8536 10.3869 21.2923 12.0901 20.5174 13.4121C20.2785 13.8195 19.9398 14.1604 19.533 14.4004L9.16975 20.5156C7.84722 21.2958 6.14596 20.8511 5.36995 19.5273C5.11962 19.1003 4.9872 18.6142 4.98714 18.1191V5.88672C4.98717 4.3537 6.22731 3.10547 7.76253 3.10547Z' fill='currentColor'/></svg>`,
  stop: `<svg width='16' height='16' viewBox='0 0 24 24' fill='none'><path fill-rule='evenodd' clip-rule='evenodd' d='M7.78027 8.90405C7.5 9.45411 7.5 10.1742 7.5 11.6144V12.3856C7.5 13.8258 7.5 14.5459 7.78027 15.096C8.02681 15.5798 8.42019 15.9732 8.90405 16.2197C9.45411 16.5 10.1742 16.5 11.6144 16.5H12.3856C13.8258 16.5 14.5459 16.5 15.096 16.2197C15.5798 15.9732 15.9732 15.5798 16.2197 15.096C16.5 14.5459 16.5 13.8258 16.5 12.3856V11.6144C16.5 10.1742 16.5 9.45411 16.2197 8.90405C15.9732 8.42019 15.5798 8.02681 15.096 7.78027C14.5459 7.5 13.8258 7.5 12.3856 7.5H11.6144C10.1742 7.5 9.45411 7.5 8.90405 7.78027C8.42019 8.02681 8.02681 8.42019 7.78027 8.90405Z' fill='currentColor'/></svg>`,
  pause: `<svg width='16' height='16' viewBox='0 0 24 24' fill='none'><rect x='7' y='4' width='3' height='16' rx='1' fill='currentColor'/><rect x='14' y='4' width='3' height='16' rx='1' fill='currentColor'/></svg>`,
  add: `<svg width='16' height='16' viewBox='0 0 24 24' fill='none'><path d='M12.0684 2.03418C12.5654 2.03421 12.9687 2.43755 12.9688 2.93457V11.0996H21.0654C21.5625 11.0996 21.9658 11.503 21.9658 12C21.9658 12.497 21.5625 12.9004 21.0654 12.9004H12.9688V21.0654C12.9687 21.5624 12.5654 21.9658 12.0684 21.9658C11.5713 21.9658 11.168 21.5625 11.168 21.0654V12.9004H2.93457C2.43751 12.9004 2.03418 12.4971 2.03418 12C2.03418 11.5029 2.43751 11.0996 2.93457 11.0996H11.168V2.93457C11.168 2.43753 11.5713 2.03418 12.0684 2.03418Z' fill='currentColor'/></svg>`,
};

async function notify(title, body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
      return;
    }
    if ('Notification' in window && Notification.permission !== 'denied') {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') new Notification(title, { body });
    }
  } catch (e) {}
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function sessionHash(s) {
  return s.status + '|' + (s.total_uploaded_mb || 0).toFixed(2) + '|' + (s.current_upload_speed || 0).toFixed(2) + '|' + (s.ratio || 0).toFixed(2) + '|' + (s.progress_percent || 0).toFixed(2) + '|' + (s.logs ? s.logs.length : 0) + '|' + (s.elapsed_seconds || 0);
}

class App {
  constructor() {
    this.sessions = [];
    this.settings = null;
    this.presets = [];
    this.customPresets = [];
    this.pollingInterval = null;
    this.selectedSessionId = null;
    this.dragCounter = 0;
    this.searchQuery = '';
    this.autoRestartEnabled = true;
    this.restartAttempts = new Map();
    this.sessionConfigs = new Map();
    this.ratioAlerts = new Set();
    this.miniMode = false;
    this.globalChart = null;
    this.sessionCards = new Map();
    this.logPanel = null;
    this.newSessionForm = null;
    this._sessionHashes = new Map();
    this._lastBackendUpdate = null;
    this._isBackground = false;
    this._backgroundInterval = 30000;
    this._intersectionObserver = null;
    this.init();
  }

  async init() {
    await this.loadSettings();
    await this.loadPresets();
    this.loadCustomPresets();
    this.loadTheme();
    this.loadPersistedSessions();
    this.render();
    this.setupResizer();
    this.setupDragDrop();
    this.setupKeyboardShortcuts();
    this.setupVisibilityPolling();
    this.setupLazyCharts();
    this.startPolling();
    this.setupGlobalEvents();
    this.requestNotificationPermission();
    // Identité du binaire (version + commit) : remplie dès que le backend
    // répond ; le bandeau garde sa valeur de repli en attendant.
    this.loadBuildInfo();
  }

  loadPersistedSessions() {
    try {
      const raw = localStorage.getItem('rsm_persisted_sessions');
      if (raw) {
        const persisted = JSON.parse(raw);
        if (persisted.sessions && persisted.timestamp) {
          const age = Date.now() - persisted.timestamp;
          if (age < 24 * 60 * 60 * 1000) {
            // Les moteurs ne survivent pas à l'application (job « kill on close »
            // + arrêt à la fermeture) : une session restaurée ne peut pas être
            // encore vivante. La restaurer « En cours » créait des fantômes qui
            // tournaient pour toujours et refusaient de se supprimer.
            this.sessions = persisted.sessions.map(s => ({
              ...s,
              status: typeof s.status === 'string' && s.status !== 'stopped' ? 'stopped' : s.status,
            }));
            this._lastBackendUpdate = persisted.lastBackendUpdate;
          }
        }
      }
    } catch (e) {}
  }

  persistSessions() {
    try {
      const stripped = this.sessions.map(s => ({
        id: s.id,
        config: s.config,
        status: s.status,
        created_at: s.created_at,
        total_uploaded_mb: s.total_uploaded_mb || 0,
        total_downloaded_mb: s.total_downloaded_mb || 0,
        current_upload_speed: s.current_upload_speed || 0,
        ratio: s.ratio || 0,
        progress_percent: s.progress_percent || 0,
        elapsed_seconds: s.elapsed_seconds || 0,
      }));
      localStorage.setItem('rsm_persisted_sessions', JSON.stringify({
        sessions: stripped,
        timestamp: Date.now(),
        lastBackendUpdate: this._lastBackendUpdate,
      }));
    } catch (e) {}
  }

  setupVisibilityPolling() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this._isBackground = true;
        this.restartPolling();
      } else {
        this._isBackground = false;
        this.restartPolling();
        this.refreshSessions();
      }
    });
  }

  startPolling() {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    const foreground = Math.max(1, (this.settings?.polling_interval_sec || 2)) * 1000;
    const interval = this._isBackground ? this._backgroundInterval : foreground;
    this.pollingInterval = setInterval(() => this.refreshSessions(), interval);
  }

  restartPolling() {
    if (this.pollingInterval) { clearInterval(this.pollingInterval); this.pollingInterval = null; }
    this.startPolling();
  }

  setupLazyCharts() {
    this._intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const card = entry.target.closest('.session-card');
        if (!card) return;
        const id = card.dataset.sessionId;
        const sessionCard = this.sessionCards.get(id);
        if (!sessionCard) return;
        if (entry.isIntersecting) {
          if (!sessionCard.chart) sessionCard.initChart(sessionCard.session);
          sessionCard._isVisible = true;
        } else {
          sessionCard._isVisible = false;
        }
      });
    }, { root: document.getElementById('sessions-container'), rootMargin: '100px' });
  }

  render() {
    const app = document.getElementById('app');
    const isLight = document.documentElement.classList.contains('light');
    app.innerHTML = `
      <header class='app-header'>
        <div class='app-header-left'>
          <div class='app-logo'>RSM</div>
          <div>
            <span class='app-title'>Ratio Spoof Manager</span>
            <span class='app-version' id='app-version'>v2.0.3</span>
          </div>
        </div>
        <div class='app-header-right'>
          <button class='btn btn-secondary' id='btn-mini' title='Mini mode'>□</button>
          <button class='btn btn-secondary' id='btn-tray' title='Minimiser'>_</button>
          <button class='btn btn-secondary' id='btn-about' title='A propos du binaire'>A propos</button>
          <button class='btn btn-secondary' id='btn-settings'>Parametres</button>
        </div>
      </header>
      <div class='stats-bar'>
        <div class='stat-card'>
          <div class='stat-label'>Sessions actives</div>
          <div class='stat-value' id='stat-active'>0</div>
        </div>
        <div class='stat-card'>
          <div class='stat-label'>Upload total</div>
          <div class='stat-value success' id='stat-upload'>0 <span class='stat-unit'>GB</span></div>
        </div>
        <div class='stat-card'>
          <div class='stat-label'>Download total</div>
          <div class='stat-value' id='stat-download'>0 <span class='stat-unit'>GB</span></div>
        </div>
        <div class='stat-card'>
          <div class='stat-label'>Ratio moyen</div>
          <div class='stat-value success' id='stat-ratio'>0.0</div>
        </div>
      </div>
      <div class='global-chart-wrap' id='global-chart-wrap'>
        <div class='global-chart-label'>Upload global (24h)</div>
        <div class='global-chart' id='global-chart'></div>
      </div>
      <div class='main-content'>
        <div class='panel panel-left'>
          <div class='panel-header'>
            <div class='panel-title'>Nouvelle session</div>
          </div>
          <div class='panel-body' id='new-session-container'></div>
        </div>
        <div class='resizer' id='resizer'></div>
        <div class='panel panel-right'>
          <div class='panel-header'>
            <div class='panel-title'>Sessions actives</div>
            <span style='font-size: 12px; color: var(--text-muted);' id='session-count'>0 torrents</span>
          </div>
          <div class='panel-body'>
            <div class='session-search'>
              <input type='text' class='form-input' id='session-search' placeholder='Rechercher une session...' autocomplete='off'>
            </div>
            <div id='sessions-container'></div>
          </div>
        </div>
      </div>
      <div class='log-panel-wrapper'>
        <div class='panel' style='border-radius: 12px 12px 0 0;'>
          <div class='panel-header'>
            <div class='panel-title'>Journal</div>
            <span style='font-size: 12px; color: var(--text-muted);' id='log-session-name'>Aucune session</span>
          </div>
          <div class='panel-body' id='log-panel-container' style='max-height: 220px; min-height: 120px;'></div>
        </div>
      </div>
      <div class='drag-overlay' id='drag-overlay'>
        <div class='drag-overlay-content'>
          <div class='drag-overlay-icon'>${ICONS.upload}</div>
          <div class='drag-overlay-text'>Deposer le fichier ici</div>
          <div class='drag-overlay-hint'>Fichiers .torrent uniquement</div>
        </div>
      </div>
      <div class='modal-overlay' id='settings-modal'>
        <div class='modal'>
          <div class='modal-header'>
            <div class='modal-title'>Parametres</div>
            <button class='modal-close' id='modal-close'>&times;</button>
          </div>
          <div class='modal-body' id='modal-body'>
            <div style='display: flex; flex-direction: column; gap: 12px;'>
              <div class='theme-toggle' id='theme-toggle'>
                <span class='theme-toggle-icon' id='theme-icon'>${isLight ? '&#9728;' : '&#9790;'}</span>
                <span class='theme-toggle-text'>Theme</span>
                <span class='theme-toggle-value' id='theme-value'>${isLight ? 'Clair' : 'Sombre'}</span>
                <div class='switch ${isLight ? 'active' : ''}' id='theme-switch'></div>
              </div>
              <div class='form-group'>
                <label class='form-label'>Client par defaut</label>
                <select class='form-select' id='setting-client'>
                  <option value='qbit-4.0.3'>qBittorrent 4.0.3</option>
                  <option value='qbit-4.3.3'>qBittorrent 4.3.3</option>
                </select>
              </div>
              <div class='form-row'>
                <div class='form-group'>
                  <label class='form-label'>Port par defaut</label>
                  <input type='text' class='form-input' id='setting-port' value='8999'>
                </div>
                <div class='form-group'>
                  <label class='form-label'>Polling (sec)</label>
                  <input type='text' class='form-input' id='setting-polling' value='2'>
                </div>
              </div>
              <div class='form-group'>
                <label class='form-label'>Alerte ratio cible</label>
                <input type='text' class='form-input' id='setting-ratio-target' value='2.0' placeholder='ex: 2.0'>
              </div>
              <div class='form-group'>
                <label class='form-label' style='display: flex; align-items: center; gap: 10px; cursor: pointer;'>
                  <div class='switch ${this.autoRestartEnabled ? 'active' : ''}' id='auto-restart-switch'></div>
                  <span>Redemarrage auto en cas de crash</span>
                </label>
              </div>
              <div class='form-group'>
                <label class='form-label'>Presets personnalises</label>
                <div id='custom-presets-list' style='display: flex; flex-direction: column; gap: 6px;'></div>
              </div>
            </div>
          </div>
          <div class='modal-footer'>
            <button class='btn btn-secondary' id='modal-cancel'>Annuler</button>
            <button class='btn btn-primary' id='modal-save'>Enregistrer</button>
          </div>
        </div>
      </div>
      <div class='modal-overlay' id='about-modal'>
        <div class='modal'>
          <div class='modal-header'>
            <div class='modal-title'>A propos</div>
            <button class='modal-close' id='about-close'>&times;</button>
          </div>
          <div class='modal-body'>
            <div class='about-grid'>
              <div class='about-row'>
                <span class='about-label'>Version</span>
                <span class='about-value' id='about-version'>inconnue</span>
              </div>
              <div class='about-row'>
                <span class='about-label'>Commit</span>
                <span class='about-value about-mono' id='about-commit'>inconnu</span>
              </div>
              <div class='about-row'>
                <span class='about-label'>Date du commit</span>
                <span class='about-value' id='about-date'>inconnue</span>
              </div>
              <div class='about-row'>
                <span class='about-label'>Etat des sources</span>
                <span class='about-value' id='about-state'>inconnu</span>
              </div>
            </div>
            <p class='about-hint'>
              Ces informations sont figees dans l'executable au moment de la compilation :
              elles identifient la livraison qui tourne, independamment du depot present sur
              cette machine. Le commit est selectionnable pour etre copie.
            </p>
          </div>
          <div class='modal-footer'>
            <button class='btn btn-primary' id='about-ok'>Fermer</button>
          </div>
        </div>
      </div>
    `;

    const formContainer = document.getElementById('new-session-container');
    this.newSessionForm = new NewSessionForm(formContainer, {
      presets: [...this.presets, ...this.customPresets],
      settings: this.settings,
      onLaunch: (config) => this.handleLaunch(config),
      icons: ICONS,
      onSavePreset: (preset) => this.savePreset(preset),
    });

    this.renderSessions();
    this.renderLogPanel();
    this.initGlobalChart();
    this.setupModalEvents();
    this.setupSearch();
    this.setupTrayButton();
    this.setupMiniButton();
    document.getElementById('btn-settings')?.addEventListener('click', () => this.openSettings());
    this.setupAboutModal();
  }

  initGlobalChart() {
    const container = document.getElementById('global-chart');
    if (!container) return;
    this.globalChart = new SpeedChart(container, { height: 60, color: '#3b82f6', maxPoints: 120 });
  }

  savePreset(preset) {
    this.customPresets.push(preset);
    this.saveCustomPresets();
    this.newSessionForm.presets = [...this.presets, ...this.customPresets];
    this.newSessionForm.renderPresets();
    Toast.success('Preset sauvegarde');
  }

  setupMiniButton() {
    const btn = document.getElementById('btn-mini');
    if (!btn) return;
    btn.addEventListener('click', () => {
      this.miniMode = !this.miniMode;
      document.body.classList.toggle('mini-mode', this.miniMode);
      btn.textContent = this.miniMode ? '▭' : '□';
      btn.title = this.miniMode ? 'Mode normal' : 'Mini mode';
    });
  }

  setupTrayButton() {
    const btn = document.getElementById('btn-tray');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      try { await invoke('minimize_window'); }
      catch (e) { console.error('Minimize failed:', e); }
    });
  }

  setupSearch() {
    const input = document.getElementById('session-search');
    if (!input) return;
    const debounced = debounce((val) => {
      this.searchQuery = val.trim().toLowerCase();
      this.renderSessions();
    }, 200);
    input.addEventListener('input', (e) => debounced(e.target.value));
  }

  setupResizer() {
    const resizer = document.getElementById('resizer');
    const leftPanel = document.querySelector('.panel-left');
    const mainContent = document.querySelector('.main-content');
    if (!resizer || !leftPanel || !mainContent) return;
    let isResizing = false;
    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      resizer.classList.add('resizing');
      e.preventDefault();
    });
    const onMouseMove = (e) => {
      if (!isResizing) return;
      const rect = mainContent.getBoundingClientRect();
      const clamped = Math.max(220, Math.min(520, e.clientX - rect.left));
      leftPanel.style.flex = '0 0 ' + clamped + 'px';
    };
    const onMouseUp = () => {
      if (!isResizing) return;
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      resizer.classList.remove('resizing');
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  setupDragDrop() {
    const overlay = document.getElementById('drag-overlay');
    if (!overlay) return;
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      document.body.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
    });
    document.body.addEventListener('dragenter', () => { this.dragCounter++; overlay.classList.add('active'); });
    document.body.addEventListener('dragleave', () => { this.dragCounter--; if (this.dragCounter === 0) overlay.classList.remove('active'); });
    document.body.addEventListener('drop', (e) => {
      this.dragCounter = 0;
      overlay.classList.remove('active');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file.name.endsWith('.torrent')) {
          this.newSessionForm?.setTorrent(file.path || file.name);
          Toast.success('Torrent "' + file.name + '" charge');
        } else {
          Toast.error('Format non supporte. Utilisez un fichier .torrent');
        }
      }
    });
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        const dropZone = document.getElementById('drop-zone');
        if (dropZone) { dropZone.scrollIntoView({ behavior: 'smooth', block: 'center' }); dropZone.style.borderColor = 'var(--accent)'; setTimeout(() => dropZone.style.borderColor = '', 800); }
      }
      if (e.ctrlKey && e.key === ',') { e.preventDefault(); this.openSettings(); }
      if (e.key === 'Escape') {
        document.getElementById('settings-modal')?.classList.remove('active');
        document.getElementById('about-modal')?.classList.remove('active');
      }
      if (e.ctrlKey && e.key === 'q') { e.preventDefault(); this.quitApp(); }
      if (e.ctrlKey && e.key === 'f') { e.preventDefault(); document.getElementById('session-search')?.focus(); }
      if (e.ctrlKey && e.key === 'm') { e.preventDefault(); document.getElementById('btn-mini')?.click(); }
    });
  }

  async quitApp() {
    const active = this.sessions.filter(s => s.status === 'running').length;
    if (active > 0) { if (!confirm(active + ' session(s) en cours. Quitter quand meme ?')) return; }
    try { await invoke('quit_app'); } catch (e) { window.close(); }
  }

  setupModalEvents() {
    const modal = document.getElementById('settings-modal');
    const closeBtn = document.getElementById('modal-close');
    const cancelBtn = document.getElementById('modal-cancel');
    const saveBtn = document.getElementById('modal-save');
    const themeToggle = document.getElementById('theme-toggle');
    const autoRestartSwitch = document.getElementById('auto-restart-switch');
    const close = () => modal.classList.remove('active');
    closeBtn?.addEventListener('click', close);
    cancelBtn?.addEventListener('click', close);
    modal?.addEventListener('click', (e) => { if (e.target === modal) close(); });
    themeToggle?.addEventListener('click', () => {
      const isLight = document.documentElement.classList.toggle('light');
      const switchEl = document.getElementById('theme-switch');
      const valueEl = document.getElementById('theme-value');
      const iconEl = document.getElementById('theme-icon');
      if (isLight) { switchEl?.classList.add('active'); if (valueEl) valueEl.textContent = 'Clair'; if (iconEl) iconEl.innerHTML = '&#9728;'; }
      else { switchEl?.classList.remove('active'); if (valueEl) valueEl.textContent = 'Sombre'; if (iconEl) iconEl.innerHTML = '&#9790;'; }
      this.saveTheme();
    });
    autoRestartSwitch?.addEventListener('click', () => {
      this.autoRestartEnabled = !this.autoRestartEnabled;
      autoRestartSwitch.classList.toggle('active', this.autoRestartEnabled);
    });
    saveBtn?.addEventListener('click', async () => {
      const port = document.getElementById('setting-port')?.value;
      const client = document.getElementById('setting-client')?.value;
      const polling = parseFloat(document.getElementById('setting-polling')?.value) || 2;
      const ratioTarget = parseFloat(document.getElementById('setting-ratio-target')?.value) || 2.0;
      const newSettings = {
        default_port: port,
        default_client: client,
        polling_interval_sec: polling,
        ratio_target: ratioTarget,
        auto_restart: this.autoRestartEnabled,
        theme: document.documentElement.classList.contains('light') ? 'light' : 'dark',
      };
      this.settings = { ...this.settings, ...newSettings };
      this.restartPolling();
      try { await invoke('save_settings', { settings: newSettings }); Toast.success('Parametres enregistres'); }
      catch (e) { Toast.info('Parametres appliques (non persistes)'); }
      close();
    });
  }

  openSettings() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    const portEl = document.getElementById('setting-port');
    const clientEl = document.getElementById('setting-client');
    const pollingEl = document.getElementById('setting-polling');
    const ratioEl = document.getElementById('setting-ratio-target');
    const restartSwitch = document.getElementById('auto-restart-switch');
    const presetsList = document.getElementById('custom-presets-list');
    if (portEl && this.settings?.default_port) portEl.value = this.settings.default_port;
    if (clientEl && this.settings?.default_client) clientEl.value = this.settings.default_client;
    if (pollingEl && this.settings?.polling_interval_sec) pollingEl.value = this.settings.polling_interval_sec;
    if (ratioEl && this.settings?.ratio_target) ratioEl.value = this.settings.ratio_target;
    if (restartSwitch) restartSwitch.classList.toggle('active', this.autoRestartEnabled);
    if (presetsList) {
      if (this.customPresets.length === 0) {
        presetsList.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">Aucun preset personnalise</span>';
      } else {
        presetsList.innerHTML = this.customPresets.map((p, i) =>
          '<div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-tertiary); padding: 8px 12px; border-radius: var(--radius);">' +
            '<span style="font-size: 12px; font-weight: 500;">' + p.name + '</span>' +
            '<button class="btn-icon danger" data-preset-idx="' + i + '" style="width: 22px; height: 22px; font-size: 10px;">&#10005;</button>' +
          '</div>'
        ).join('');
        presetsList.querySelectorAll('button[data-preset-idx]').forEach(btn => {
          btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.presetIdx);
            this.customPresets.splice(idx, 1);
            this.saveCustomPresets();
            this.openSettings();
            this.newSessionForm.presets = [...this.presets, ...this.customPresets];
            this.newSessionForm.renderPresets();
          });
        });
      }
    }
    modal.classList.add('active');
  }

  renderSessions() {
    const container = document.getElementById('sessions-container');
    const countEl = document.getElementById('session-count');
    let displaySessions = this.sessions;
    if (this.searchQuery) {
      displaySessions = this.sessions.filter(s => {
        const name = this.getTorrentName(s.config?.torrent_path).toLowerCase();
        return name.includes(this.searchQuery);
      });
    }
    if (countEl) countEl.textContent = displaySessions.length + ' torrent' + (displaySessions.length !== 1 ? 's' : '');
    if (displaySessions.length === 0) {
      this.sessionCards?.forEach((card) => {
        if (this._intersectionObserver) {
          const chartWrap = card.element.querySelector('.session-chart-wrap');
          if (chartWrap) this._intersectionObserver.unobserve(chartWrap);
        }
        card.element.remove();
      });
      this.sessionCards?.clear();
      this._sessionHashes.clear();
      if (container) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-title">Aucune session active</div><div class="empty-state-text">' + (this.searchQuery ? 'Aucun resultat pour cette recherche' : 'Creez une nouvelle session pour commencer') + '</div></div>';
      }
      return;
    }
    let list = container.querySelector('.sessions-list');
    if (!list) {
      container.innerHTML = '<div class="sessions-list" style="position: relative;"></div>';
      list = container.querySelector('.sessions-list');
    }
    const currentIds = new Set();
    if (!this.sessionCards) this.sessionCards = new Map();
    displaySessions.forEach(session => {
      currentIds.add(session.id);
      const existing = this.sessionCards.get(session.id);
      if (existing) {
        const newHash = sessionHash(session);
        const oldHash = this._sessionHashes.get(session.id);
        if (newHash !== oldHash) {
          existing.update(session);
          this._sessionHashes.set(session.id, newHash);
        }
        existing.setSelected(session.id === this.selectedSessionId);
      } else {
        const card = new SessionCard(session, {
          icons: ICONS,
          onSelect: (id) => this.selectSession(id),
          onStop: (id) => this.handleStop(id),
          onDelete: (id) => this.handleDelete(id),
          onPause: (id) => this.handlePause(id),
          onResume: (id) => this.handleResume(id),
          isSelected: session.id === this.selectedSessionId,
          lazyChart: true,
        });
        this.sessionCards.set(session.id, card);
        this._sessionHashes.set(session.id, sessionHash(session));
        list.appendChild(card.element);
        if (this._intersectionObserver && card.element) {
          const chartWrap = card.element.querySelector('.session-chart-wrap');
          if (chartWrap) this._intersectionObserver.observe(chartWrap);
        }
      }
    });
    this.sessionCards.forEach((card, id) => {
      if (!currentIds.has(id)) {
        if (this._intersectionObserver && card.element) {
          const chartWrap = card.element.querySelector('.session-chart-wrap');
          if (chartWrap) this._intersectionObserver.unobserve(chartWrap);
        }
        card.element.remove();
        this.sessionCards.delete(id);
        this._sessionHashes.delete(id);
      }
    });
  }

  renderLogPanel() {
    const container = document.getElementById('log-panel-container');
    const nameEl = document.getElementById('log-session-name');
    if (!container) return;
    const session = this.selectedSessionId
      ? this.sessions.find(s => s.id === this.selectedSessionId)
      : this.sessions[0];
    if (!session) {
      if (nameEl) nameEl.textContent = 'Aucune session';
      if (this.logPanel) {
        this.logPanel = null;
        container.innerHTML = '<div class="empty-state" style="padding: 20px;"><div class="empty-state-text">Lancez une session pour voir les logs</div></div>';
      }
      return;
    }
    if (nameEl) nameEl.textContent = this.getTorrentName(session.config?.torrent_path);
    if (this.logPanel && this.logPanel.session && this.logPanel.session.id === session.id) {
      this.logPanel.update(session);
    } else {
      this.logPanel = new LogPanel(container, { session, icons: ICONS });
    }
  }

  getTorrentName(path) {
    if (!path) return 'Unknown';
    const idx = path.lastIndexOf('/');
    const idx2 = path.lastIndexOf('\\');
    const lastSep = Math.max(idx, idx2);
    return lastSep >= 0 ? path.slice(lastSep + 1) : path;
  }

  async handleLaunch(config) {
    this.sessionConfigs.set(config.torrent_path, config);
    this.restartAttempts.set(config.torrent_path, 0);
    try {
      const res = await invoke('launch_session', { req: config });
      if (res.success) {
        Toast.success('Session lancee avec succes');
        await notify('RSM', 'Session lancee : ' + this.getTorrentName(config.torrent_path));
        await this.refreshSessions();
      } else {
        Toast.error(res.error || 'Echec du lancement');
      }
    } catch (e) {
      Toast.error(e.message || 'Erreur de lancement');
    }
  }

  async handleStop(id) {
    try {
      const res = await invoke('stop_session', { id });
      if (res.success) {
        // La carte reste affichée en « Arrete » : supprimer est une action
        // distincte (bouton ✕). Pas de notification ici, l'état de la carte
        // suffit et un arrêt en deux temps ne doit pas empiler les toasts.
        await this.refreshSessions();
      }
    } catch (e) { Toast.error(e.message); }
  }

  async handleDelete(id) {
    try {
      const res = await invoke('delete_session', { id });
      if (res.success) {
        if (this.selectedSessionId === id) this.selectedSessionId = null;
        // Retrait immédiat de la carte : sans cela elle resterait affichée
        // jusqu'au prochain rafraîchissement, et un backend qui ne connaît plus
        // la session ne la renverra jamais.
        const card = this.sessionCards.get(id);
        if (card) {
          if (this._intersectionObserver) {
            const chartWrap = card.element.querySelector('.session-chart-wrap');
            if (chartWrap) this._intersectionObserver.unobserve(chartWrap);
          }
          card.element.remove();
          this.sessionCards.delete(id);
          this._sessionHashes.delete(id);
        }
        this.sessions = this.sessions.filter(s => s.id !== id);
        this.updateStats();
        this.persistSessions();
        this.renderSessions();
        if (this.selectedSessionId === null) this.renderLogPanel();
        Toast.info('Session supprimee');
      } else {
        Toast.error(res.error || 'Echec de la suppression');
      }
    } catch (e) { Toast.error(e.message); }
  }

  async handlePause(id) {
    try { await invoke('pause_session', { id }); await this.refreshSessions(); }
    catch (e) { Toast.error(e.message); }
  }

  async handleResume(id) {
    try { await invoke('resume_session', { id }); await this.refreshSessions(); }
    catch (e) { Toast.error(e.message); }
  }

  selectSession(id) {
    this.selectedSessionId = id;
    this.renderSessions();
    this.renderLogPanel();
  }

  async refreshSessions() {
    try {
      let res;
      if (this._lastBackendUpdate) {
        try {
          res = await invoke('get_sessions_since', { since: this._lastBackendUpdate });
        } catch (e) {
          res = await invoke('get_sessions');
        }
      } else {
        res = await invoke('get_sessions');
      }
      if (res.success) {
        const prevSessions = this.sessions;
        const newData = res.data;
        if (newData.length > 0) {
          // Garder le plus récent des last_update pour ne jamais rater de mise à jour
          let latest = null;
          for (const s of newData) {
            const ts = s.last_update ? Date.parse(s.last_update) : 0;
            if (!latest || ts > latest) latest = ts;
          }
          this._lastBackendUpdate = latest ? new Date(latest).toISOString() : new Date().toISOString();
        }
        // Fusion delta : la liste ne renvoie que les sessions modifiées, donc
        // on conserve celles absentes de la réponse. Une session supprimée ne
        // peut pas ressusciter : handleDelete la retire aussi de this.sessions.
        const merged = new Map(prevSessions.map(s => [s.id, s]));
        for (const s of newData) {
          merged.set(s.id, s);
        }
        this.sessions = Array.from(merged.values());
        this.persistSessions();
        this.updateStats();
        this.renderSessions();
        this.checkRatioAlerts();
        this.updateGlobalChart();
        if (this.autoRestartEnabled) this.checkAutoRestart(prevSessions);
        const shouldUpdateLog = !this.selectedSessionId
          || prevSessions.length !== this.sessions.length
          || (prevSessions.find(s => s.id === this.selectedSessionId)?.logs?.length || 0)
             !== (this.sessions.find(s => s.id === this.selectedSessionId)?.logs?.length || 0);
        if (shouldUpdateLog) this.renderLogPanel();
      }
    } catch (e) { console.error('Failed to refresh sessions:', e); }
  }

  checkRatioAlerts() {
    const target = this.settings?.ratio_target || 2.0;
    this.sessions.forEach(s => {
      if (s.status === 'running' && s.ratio >= target && !this.ratioAlerts.has(s.id)) {
        this.ratioAlerts.add(s.id);
        Toast.success('Ratio cible atteint ! ' + this.getTorrentName(s.config?.torrent_path) + ' : ' + s.ratio.toFixed(1));
        notify('RSM', 'Ratio cible atteint : ' + this.getTorrentName(s.config?.torrent_path));
      }
    });
  }

  updateGlobalChart() {
    if (!this.globalChart) return;
    const totalSpeed = this.sessions.reduce((sum, s) => sum + (s.current_upload_speed || 0), 0);
    this.globalChart.push(totalSpeed);
  }

  checkAutoRestart(prevSessions) {
    prevSessions.forEach(prev => {
      const current = this.sessions.find(s => s.id === prev.id);
      const wasRunning = prev.status === 'running' || prev.status === 'starting';
      const isCrashed = current && current.status === 'error';
      const isMissing = !current;
      if (wasRunning && (isCrashed || isMissing)) {
        const config = this.sessionConfigs.get(prev.config?.torrent_path);
        if (config) {
          const attempts = this.restartAttempts.get(prev.config?.torrent_path) || 0;
          if (attempts < 3) {
            this.restartAttempts.set(prev.config?.torrent_path, attempts + 1);
            Toast.warning('Redemarrage auto (' + (attempts + 1) + '/3) : ' + this.getTorrentName(prev.config?.torrent_path));
            notify('RSM', 'Redemarrage auto : ' + this.getTorrentName(prev.config?.torrent_path));
            setTimeout(() => this.handleLaunch(config), 2000);
          } else {
            Toast.error('Arret apres 3 echecs : ' + this.getTorrentName(prev.config?.torrent_path));
            notify('RSM', 'Session arretee apres 3 echecs');
          }
        }
      }
    });
  }

  updateStats() {
    const active = this.sessions.filter(s => s.status === 'running').length;
    const totalUploadMb = this.sessions.reduce((sum, s) => sum + (s.total_uploaded_mb || 0), 0);
    const totalDownloadMb = this.sessions.reduce((sum, s) => sum + (s.total_downloaded_mb || 0), 0);
    const { value: upVal, unit: upUnit } = this.formatSizeDynamic(totalUploadMb);
    const { value: dlVal, unit: dlUnit } = this.formatSizeDynamic(totalDownloadMb);
    const ratios = this.sessions.map(s => s.ratio).filter(r => r > 0);
    const avgRatio = ratios.length > 0 ? (ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(1) : '0.0';
    document.getElementById('stat-active').textContent = active;
    document.getElementById('stat-upload').innerHTML = upVal + " <span class='stat-unit'>" + upUnit + '</span>';
    document.getElementById('stat-download').innerHTML = dlVal + " <span class='stat-unit'>" + dlUnit + '</span>';
    document.getElementById('stat-ratio').textContent = avgRatio;
  }

  formatSizeDynamic(mb) {
    if (mb >= 1024 * 1024) return { value: (mb / 1024 / 1024).toFixed(1), unit: 'TB' };
    if (mb >= 1024) return { value: (mb / 1024).toFixed(1), unit: 'GB' };
    if (mb >= 1) return { value: mb.toFixed(0), unit: 'MB' };
    return { value: (mb * 1024).toFixed(0), unit: 'KB' };
  }

  setupGlobalEvents() {
    window.addEventListener('beforeunload', (e) => {
      const active = this.sessions.filter(s => s.status === 'running').length;
      if (active > 0) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  async requestNotificationPermission() {
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } catch (e) {}
  }

  // Identité du binaire : la version vient du crate, le commit est fige dans
  // l'executable a la compilation (src-tauri/build.rs). Le bandeau et la fenetre
  // « A propos » decrivent donc la livraison reellement executee, pas l'etat du
  // depot local (qui peut etre en avance ou en retard sur le binaire).
  async loadBuildInfo() {
    try {
      const res = await invoke('get_build_info');
      if (res.success && res.data) this.applyBuildInfo(res.data);
    } catch (e) {
      console.error('Informations de build indisponibles :', e);
    }
  }

  applyBuildInfo(info) {
    this.buildInfo = info;
    const version = 'v' + (info.version || '?');
    const versionEl = document.getElementById('app-version');
    if (versionEl) versionEl.textContent = version;
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    set('about-version', version);
    set('about-commit', info.commit + (info.dirty ? ' + modifications locales' : ''));
    set('about-date', info.commit_date || 'inconnue');
    set('about-state', info.dirty ? 'Modifications locales non commitees' : 'Propre (identique au commit)');
  }

  setupAboutModal() {
    const modal = document.getElementById('about-modal');
    if (!modal) return;
    const close = () => modal.classList.remove('active');
    document.getElementById('about-close')?.addEventListener('click', close);
    document.getElementById('about-ok')?.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.getElementById('btn-about')?.addEventListener('click', () => modal.classList.add('active'));
  }

  async loadSettings() {
    try {
      const res = await invoke('get_settings');
      if (res.success) this.settings = res.data;
    } catch (e) { console.error(e); }
  }

  async loadPresets() {
    try {
      const res = await invoke('get_presets');
      if (res.success) this.presets = res.data;
    } catch (e) { console.error(e); }
  }

  loadCustomPresets() {
    try {
      const raw = localStorage.getItem('rsm_custom_presets');
      if (raw) this.customPresets = JSON.parse(raw);
    } catch (e) { this.customPresets = []; }
  }

  saveCustomPresets() {
    localStorage.setItem('rsm_custom_presets', JSON.stringify(this.customPresets));
  }

  loadTheme() {
    const saved = localStorage.getItem('rsm_theme');
    if (saved === 'light') document.documentElement.classList.add('light');
    else if (saved === 'dark') document.documentElement.classList.remove('light');
  }

  saveTheme() {
    localStorage.setItem('rsm_theme', document.documentElement.classList.contains('light') ? 'light' : 'dark');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
