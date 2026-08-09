import { invoke } from '@tauri-apps/api/core';
import { NewSessionForm } from './components/NewSessionForm.js';
import { SessionCard } from './components/SessionCard.js';
import { LogPanel } from './components/LogPanel.js';
import { Toast } from './components/Toast.js';

// Icons as SVG strings
const ICONS = {
  upload: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M11.3636 3.36358C11.7151 3.01211 12.2849 3.01211 12.6364 3.36358L17.0808 7.80802C17.4323 8.1595 17.4323 8.72934 17.0808 9.08082C16.7293 9.43229 16.1595 9.43229 15.808 9.08082L12.9 6.17277V14.6666C12.9 15.1637 12.497 15.5666 12 15.5666C11.5029 15.5666 11.1 15.1637 11.1 14.6666V6.17277L8.19193 9.08082C7.84046 9.43229 7.27061 9.43229 6.91914 9.08082C6.56766 8.72934 6.56766 8.1595 6.91914 7.80802L11.3636 3.36358Z" fill="currentColor"/></svg>`,
  download: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2.90002C12.4971 2.90002 12.9 3.30297 12.9 3.80002V12.2939L15.8081 9.38585C16.1595 9.03438 16.7294 9.03438 17.0808 9.38585C17.4323 9.73732 17.4323 10.3072 17.0808 10.6586L12.6364 15.1031C12.4676 15.2719 12.2387 15.3667 12 15.3667C11.7613 15.3667 11.5324 15.2719 11.3636 15.1031L6.91917 10.6586C6.5677 10.3072 6.5677 9.73732 6.91917 9.38585C7.27064 9.03438 7.84049 9.03438 8.19196 9.38585L11.1 12.2939V3.80002C11.1 3.30297 11.503 2.90002 12 2.90002Z" fill="currentColor"/></svg>`,
  play: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M7.76253 3.10547C8.25778 3.10552 8.74424 3.23849 9.17073 3.49023L19.533 9.60742C20.8536 10.3869 21.2923 12.0901 20.5174 13.4121C20.2785 13.8195 19.9398 14.1604 19.533 14.4004L9.16975 20.5156C7.84722 21.2958 6.14596 20.8511 5.36995 19.5273C5.11962 19.1003 4.9872 18.6142 4.98714 18.1191V5.88672C4.98717 4.3537 6.22731 3.10547 7.76253 3.10547Z" fill="currentColor"/></svg>`,
  stop: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.78027 8.90405C7.5 9.45411 7.5 10.1742 7.5 11.6144V12.3856C7.5 13.8258 7.5 14.5459 7.78027 15.096C8.02681 15.5798 8.42019 15.9732 8.90405 16.2197C9.45411 16.5 10.1742 16.5 11.6144 16.5H12.3856C13.8258 16.5 14.5459 16.5 15.096 16.2197C15.5798 15.9732 15.9732 15.5798 16.2197 15.096C16.5 14.5459 16.5 13.8258 16.5 12.3856V11.6144C16.5 10.1742 16.5 9.45411 16.2197 8.90405C15.9732 8.42019 15.5798 8.02681 15.096 7.78027C14.5459 7.5 13.8258 7.5 12.3856 7.5H11.6144C10.1742 7.5 9.45411 7.5 8.90405 7.78027C8.42019 8.02681 8.02681 8.42019 7.78027 8.90405Z" fill="currentColor"/></svg>`,
  pause: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="7" y="4" width="3" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="3" height="16" rx="1" fill="currentColor"/></svg>`,
  check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M19.3027 5.9053C19.6542 5.55397 20.2247 5.55388 20.5761 5.9053C20.9273 6.25675 20.9273 6.82734 20.5761 7.17874L9.65911 18.0948C9.30773 18.4461 8.73814 18.446 8.38665 18.0948L3.42376 13.1328C3.0726 12.7814 3.07263 12.2118 3.42376 11.8604C3.77524 11.509 4.34575 11.5089 4.6972 11.8604L9.02239 16.1856L19.3027 5.9053Z" fill="currentColor"/></svg>`,
  error: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V15H13V17ZM13 13H11V7H13V13Z" fill="currentColor"/></svg>`,
  close: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M17.9542 4.77253C18.3056 4.42106 18.8761 4.42106 19.2276 4.77253C19.579 5.12401 19.579 5.69452 19.2276 6.04597L13.2735 12.0001L19.2276 17.9542C19.5791 18.3056 19.5791 18.8761 19.2276 19.2276C18.8761 19.5791 18.3056 19.5791 17.9542 19.2276L12.0001 13.2735L6.04595 19.2276C5.69451 19.5791 5.12399 19.579 4.77252 19.2276C4.42104 18.8761 4.42104 18.3056 4.77252 17.9542L10.7266 12.0001L4.77252 6.04597C4.42104 5.6945 4.42104 5.124 4.77252 4.77253C5.12399 4.42107 5.69448 4.42106 6.04595 4.77253L12.0001 10.7266L17.9542 4.77253Z" fill="currentColor"/></svg>`,
  document: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15.4795 15.4971C15.9765 15.4971 16.3799 15.9004 16.3799 16.3975C16.3799 16.8945 15.9765 17.297 15.4795 17.297H8.51953C8.02249 17.297 7.61914 16.8945 7.61914 16.3975C7.61914 15.9004 8.02249 15.4971 8.51953 15.4971H15.4795ZM15.4795 11.0986C15.9765 11.0986 16.3799 11.502 16.3799 11.999C16.3799 12.4961 15.9765 12.8994 15.4795 12.8994H8.51953C8.02249 12.8994 7.61914 12.4961 7.61914 11.999C7.61914 11.502 8.02249 11.0986 8.51953 11.0986H15.4795ZM15.4795 6.7002C15.9765 6.7002 16.3799 7.10355 16.3799 7.60059C16.3799 8.09763 15.9765 8.50098 15.4795 8.50098H8.51953C8.02249 8.50098 7.61914 8.09763 7.61914 7.60059C7.61914 7.10355 8.02249 6.7002 8.51953 6.7002H15.4795Z" fill="currentColor"/></svg>`,
  folder: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9.2373 3.7002C10.4169 3.7002 11.5297 4.24779 12.249 5.18262L12.4424 5.43359H18C20.0987 5.43359 21.7998 7.13473 21.7998 9.2334V16.2334C21.7998 18.3321 20.0987 20.0332 18 20.0332H6C3.90133 20.0332 2.2002 18.3321 2.2002 16.2334V9.2334C2.2002 7.13473 3.90133 5.43359 6 5.43359H6.03125L6.22559 5.18262C6.94489 4.24779 8.05769 3.7002 9.2373 3.7002Z" fill="currentColor"/></svg>`,
  chart: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 3.08496C4.55224 3.08496 4.99993 3.53273 5 4.08496V18.0361H19.9941L20.0967 18.041C20.6008 18.0851 20.9941 18.5106 20.9941 19.0254C20.9941 19.5402 20.6008 19.9657 20.0967 20.0098L20 20.0146H4C3.44772 20.0146 3 19.5669 3 19.0146V4.08496C3 3.53273 3.44772 3.08496 4 3.08496ZM18.5 6.5C18.7761 6.5 19 6.72386 19 7V13.5C19 13.7761 18.7761 14 18.5 14C18.2239 14 18 13.7761 18 13.5V7C18 6.72386 18.2239 6.5 18.5 6.5ZM15.5 8.5C15.7761 8.5 16 8.72386 16 9V13.5C16 13.7761 15.7761 14 15.5 14C15.2239 14 15 13.7761 15 13.5V9C15 8.72386 15.2239 8.5 15.5 8.5ZM12.5 10.5C12.7761 10.5 13 10.7239 13 11V13.5C13 13.7761 12.7761 14 12.5 14C12.2239 14 12 13.7761 12 13.5V11C12 10.7239 12.2239 10.5 12.5 10.5Z" fill="currentColor"/></svg>`,
  bolt: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" fill="currentColor"/></svg>`,
  add: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12.0684 2.03418C12.5654 2.03421 12.9687 2.43755 12.9688 2.93457V11.0996H21.0654C21.5625 11.0996 21.9658 11.503 21.9658 12C21.9658 12.497 21.5625 12.9004 21.0654 12.9004H12.9688V21.0654C12.9687 21.5624 12.5654 21.9658 12.0684 21.9658C11.5713 21.9658 11.168 21.5625 11.168 21.0654V12.9004H2.93457C2.43751 12.9004 2.03418 12.4971 2.03418 12C2.03418 11.5029 2.43751 11.0996 2.93457 11.0996H11.168V2.93457C11.168 2.43753 11.5713 2.03418 12.0684 2.03418Z" fill="currentColor"/></svg>`,
};

class App {
  constructor() {
    this.sessions = [];
    this.settings = null;
    this.presets = [];
    this.pollingInterval = null;
    this.selectedSessionId = null;

    this.init();
  }

  async init() {
    await this.loadSettings();
    await this.loadPresets();
    this.render();
    this.startPolling();
    this.setupGlobalEvents();
  }

  async loadSettings() {
    try {
      const res = await invoke('get_settings');
      if (res.success) {
        this.settings = res.data;
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  }

  async loadPresets() {
    try {
      const res = await invoke('get_presets');
      if (res.success) {
        this.presets = res.data;
      }
    } catch (e) {
      console.error('Failed to load presets:', e);
    }
  }

  render() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <header class="app-header">
        <div class="app-header-left">
          <div class="app-logo">RSM</div>
          <div>
            <span class="app-title">Ratio Spoof Manager</span>
            <span class="app-version">v2.0.0</span>
          </div>
        </div>
        <div class="app-header-right">
          <button class="btn btn-secondary" id="btn-settings">
            <span>Paramètres</span>
          </button>
        </div>
      </header>

      <div class="stats-bar">
        <div class="stat-card">
          <div class="stat-label">${ICONS.play} Sessions actives</div>
          <div class="stat-value" id="stat-active">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">${ICONS.upload} Upload total</div>
          <div class="stat-value success" id="stat-upload">0 <span class="stat-unit">GB</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">${ICONS.download} Download total</div>
          <div class="stat-value" id="stat-download">0 <span class="stat-unit">GB</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">${ICONS.chart} Ratio moyen</div>
          <div class="stat-value success" id="stat-ratio">0.0</div>
        </div>
      </div>

      <div class="main-content">
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">${ICONS.add} Nouvelle session</div>
          </div>
          <div class="panel-body" id="new-session-container"></div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">${ICONS.play} Sessions actives</div>
            <span style="font-size: 12px; color: var(--text-muted);" id="session-count">0 torrents</span>
          </div>
          <div class="panel-body">
            <div id="sessions-container"></div>
            <div id="log-panel-container" style="margin-top: 12px; border-top: 1px solid var(--border); padding-top: 12px;"></div>
          </div>
        </div>
      </div>
    `;

    // Render new session form
    const formContainer = document.getElementById('new-session-container');
    this.newSessionForm = new NewSessionForm(formContainer, {
      presets: this.presets,
      settings: this.settings,
      onLaunch: (config) => this.handleLaunch(config),
      icons: ICONS,
    });

    // Render sessions list
    this.renderSessions();

    // Setup settings button
    document.getElementById('btn-settings')?.addEventListener('click', () => {
      Toast.info('Paramètres — à implémenter');
    });
  }

  renderSessions() {
    const container = document.getElementById('sessions-container');
    const countEl = document.getElementById('session-count');

    if (countEl) {
      countEl.textContent = `${this.sessions.length} torrent${this.sessions.length > 1 ? 's' : ''}`;
    }

    if (this.sessions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">${ICONS.play}</div>
          <div class="empty-state-title">Aucune session active</div>
          <div class="empty-state-text">Créez une nouvelle session pour commencer</div>
        </div>
      `;
      return;
    }

    container.innerHTML = '<div class="sessions-list"></div>';
    const list = container.querySelector('.sessions-list');

    this.sessions.forEach(session => {
      const card = new SessionCard(session, {
        icons: ICONS,
        onSelect: (id) => this.selectSession(id),
        onStop: (id) => this.handleStop(id),
        onPause: (id) => this.handlePause(id),
        onResume: (id) => this.handleResume(id),
        isSelected: session.id === this.selectedSessionId,
      });
      list.appendChild(card.element);
    });

    // Render log panel for selected session
    const logContainer = document.getElementById('log-panel-container');
    if (this.selectedSessionId) {
      const session = this.sessions.find(s => s.id === this.selectedSessionId);
      if (session) {
        this.logPanel = new LogPanel(logContainer, {
          session,
          icons: ICONS,
        });
      }
    } else {
      logContainer.innerHTML = '';
    }
  }

  async handleLaunch(config) {
    try {
      const res = await invoke('launch_session', { req: config });
      if (res.success) {
        Toast.success('Session lancée avec succès');
        await this.refreshSessions();
      } else {
        Toast.error(res.error || 'Échec du lancement');
      }
    } catch (e) {
      Toast.error(e.message || 'Erreur de lancement');
    }
  }

  async handleStop(id) {
    try {
      const res = await invoke('stop_session', { id });
      if (res.success) {
        Toast.success('Session arrêtée');
        if (this.selectedSessionId === id) {
          this.selectedSessionId = null;
        }
        await this.refreshSessions();
      }
    } catch (e) {
      Toast.error(e.message);
    }
  }

  async handlePause(id) {
    try {
      await invoke('pause_session', { id });
      await this.refreshSessions();
    } catch (e) {
      Toast.error(e.message);
    }
  }

  async handleResume(id) {
    try {
      await invoke('resume_session', { id });
      await this.refreshSessions();
    } catch (e) {
      Toast.error(e.message);
    }
  }

  selectSession(id) {
    this.selectedSessionId = id;
    this.renderSessions();
  }

  async refreshSessions() {
    try {
      const res = await invoke('get_sessions');
      if (res.success) {
        this.sessions = res.data;
        this.updateStats();
        this.renderSessions();
      }
    } catch (e) {
      console.error('Failed to refresh sessions:', e);
    }
  }

  updateStats() {
    const active = this.sessions.filter(s => s.status === 'running').length;
    const totalUpload = this.sessions.reduce((sum, s) => sum + s.total_uploaded_mb, 0) / 1024;
    const totalDownload = this.sessions.reduce((sum, s) => sum + s.total_downloaded_mb, 0) / 1024;
    const ratios = this.sessions.map(s => s.ratio).filter(r => r > 0);
    const avgRatio = ratios.length > 0 ? (ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(1) : '0.0';

    document.getElementById('stat-active').textContent = active;
    document.getElementById('stat-upload').innerHTML = `${totalUpload.toFixed(1)} <span class="stat-unit">GB</span>`;
    document.getElementById('stat-download').innerHTML = `${totalDownload.toFixed(1)} <span class="stat-unit">GB</span>`;
    document.getElementById('stat-ratio').textContent = avgRatio;
  }

  startPolling() {
    this.pollingInterval = setInterval(() => this.refreshSessions(), 2000);
  }

  setupGlobalEvents() {
    // Handle beforeunload to warn about active sessions
    window.addEventListener('beforeunload', (e) => {
      const active = this.sessions.filter(s => s.status === 'running').length;
      if (active > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
