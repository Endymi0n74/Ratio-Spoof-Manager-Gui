import { invoke } from '@tauri-apps/api/core';
import { NewSessionForm } from './components/NewSessionForm.js';
import { SessionCard } from './components/SessionCard.js';
import { LogPanel } from './components/LogPanel.js';
import { Toast } from './components/Toast.js';

const ICONS = {
  upload: <svg width='16' height='16' viewBox='0 0 24 24' fill='none'><path fill-rule='evenodd' clip-rule='evenodd' d='M11.3636 3.36358C11.7151 3.01211 12.2849 3.01211 12.6364 3.36358L17.0808 7.80802C17.4323 8.1595 17.4323 8.72934 17.0808 9.08082C16.7293 9.43229 16.1595 9.43229 15.808 9.08082L12.9 6.17277V14.6666C12.9 15.1637 12.497 15.5666 12 15.5666C11.5029 15.5666 11.1 15.1637 11.1 14.6666V6.17277L8.19193 9.08082C7.84046 9.43229 7.27061 9.43229 6.91914 9.08082C6.56766 8.72934 6.56766 8.1595 6.91914 7.80802L11.3636 3.36358Z' fill='currentColor'/></svg>,
  download: <svg width='16' height='16' viewBox='0 0 24 24' fill='none'><path fill-rule='evenodd' clip-rule='evenodd' d='M12 2.90002C12.4971 2.90002 12.9 3.30297 12.9 3.80002V12.2939L15.8081 9.38585C16.1595 9.03438 16.7294 9.03438 17.0808 9.38585C17.4323 9.73732 17.4323 10.3072 17.0808 10.6586L12.6364 15.1031C12.4676 15.2719 12.2387 15.3667 12 15.3667C11.7613 15.3667 11.5324 15.2719 11.3636 15.1031L6.91917 10.6586C6.5677 10.3072 6.5677 9.73732 6.91917 9.38585C7.27064 9.03438 7.84049 9.03438 8.19196 9.38585L11.1 12.2939V3.80002C11.1 3.30297 11.503 2.90002 12 2.90002Z' fill='currentColor'/></svg>,
  play: <svg width='16' height='16' viewBox='0 0 24 24' fill='none'><path d='M7.76253 3.10547C8.25778 3.10552 8.74424 3.23849 9.17073 3.49023L19.533 9.60742C20.8536 10.3869 21.2923 12.0901 20.5174 13.4121C20.2785 13.8195 19.9398 14.1604 19.533 14.4004L9.16975 20.5156C7.84722 21.2958 6.14596 20.8511 5.36995 19.5273C5.11962 19.1003 4.9872 18.6142 4.98714 18.1191V5.88672C4.98717 4.3537 6.22731 3.10547 7.76253 3.10547Z' fill='currentColor'/></svg>,
  stop: <svg width='16' height='16' viewBox='0 0 24 24' fill='none'><path fill-rule='evenodd' clip-rule='evenodd' d='M7.78027 8.90405C7.5 9.45411 7.5 10.1742 7.5 11.6144V12.3856C7.5 13.8258 7.5 14.5459 7.78027 15.096C8.02681 15.5798 8.42019 15.9732 8.90405 16.2197C9.45411 16.5 10.1742 16.5 11.6144 16.5H12.3856C13.8258 16.5 14.5459 16.5 15.096 16.2197C15.5798 15.9732 15.9732 15.5798 16.2197 15.096C16.5 14.5459 16.5 13.8258 16.5 12.3856V11.6144C16.5 10.1742 16.5 9.45411 16.2197 8.90405C15.9732 8.42019 15.5798 8.02681 15.096 7.78027C14.5459 7.5 13.8258 7.5 12.3856 7.5H11.6144C10.1742 7.5 9.45411 7.5 8.90405 7.78027C8.42019 8.02681 8.02681 8.42019 7.78027 8.90405Z' fill='currentColor'/></svg>,
  pause: <svg width='16' height='16' viewBox='0 0 24 24' fill='none'><rect x='7' y='4' width='3' height='16' rx='1' fill='currentColor'/><rect x='14' y='4' width='3' height='16' rx='1' fill='currentColor'/></svg>,
  add: <svg width='16' height='16' viewBox='0 0 24 24' fill='none'><path d='M12.0684 2.03418C12.5654 2.03421 12.9687 2.43755 12.9688 2.93457V11.0996H21.0654C21.5625 11.0996 21.9658 11.503 21.9658 12C21.9658 12.497 21.5625 12.9004 21.0654 12.9004H12.9688V21.0654C12.9687 21.5624 12.5654 21.9658 12.0684 21.9658C11.5713 21.9658 11.168 21.5625 11.168 21.0654V12.9004H2.93457C2.43751 12.9004 2.03418 12.4971 2.03418 12C2.03418 11.5029 2.43751 11.0996 2.93457 11.0996H11.168V2.93457C11.168 2.43753 11.5713 2.03418 12.0684 2.03418Z' fill='currentColor'/></svg>,
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
      if (res.success) this.settings = res.data;
    } catch (e) { console.error('Failed to load settings:', e); }
  }

  async loadPresets() {
    try {
      const res = await invoke('get_presets');
      if (res.success) this.presets = res.data;
    } catch (e) { console.error('Failed to load presets:', e); }
  }

  render() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <header class='app-header'>
        <div class='app-header-left'>
          <div class='app-logo'>RSM</div>
          <div>
            <span class='app-title'>Ratio Spoof Manager</span>
            <span class='app-version'>v2.0.1</span>
          </div>
        </div>
        <div class='app-header-right'>
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
      <div class='main-content'>
        <div class='panel'>
          <div class='panel-header'>
            <div class='panel-title'>Nouvelle session</div>
          </div>
          <div class='panel-body' id='new-session-container'></div>
        </div>
        <div class='panel'>
          <div class='panel-header'>
            <div class='panel-title'>Sessions actives</div>
            <span style='font-size: 12px; color: var(--text-muted);' id='session-count'>0 torrents</span>
          </div>
          <div class='panel-body'>
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
    `;

    const formContainer = document.getElementById('new-session-container');
    this.newSessionForm = new NewSessionForm(formContainer, {
      presets: this.presets,
      settings: this.settings,
      onLaunch: (config) => this.handleLaunch(config),
      icons: ICONS,
    });

    this.renderSessions();
    this.renderLogPanel();

    document.getElementById('btn-settings')?.addEventListener('click', () => {
      Toast.info('Parametres - a implementer');
    });
  }

  renderSessions() {
    const container = document.getElementById('sessions-container');
    const countEl = document.getElementById('session-count');
    if (countEl) countEl.textContent = `${this.sessions.length} torrent${this.sessions.length !== 1 ? 's' : ''}`;

    if (this.sessions.length === 0) {
      container.innerHTML = `
        <div class='empty-state'>
          <div class='empty-state-icon'></div>
          <div class='empty-state-title'>Aucune session active</div>
          <div class='empty-state-text'>Creez une nouvelle session pour commencer</div>
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
      this.logPanel = null;
      container.innerHTML = `<div class='empty-state' style='padding: 20px;'><div class='empty-state-text'>Lancez une session pour voir les logs</div></div>`;
      return;
    }

    if (nameEl) nameEl.textContent = this.getTorrentName(session.config.torrent_path);

    if (this.logPanel && this.logPanel.session && this.logPanel.session.id === session.id) {
      this.logPanel.update(session);
    } else {
      this.logPanel = new LogPanel(container, { session, icons: ICONS });
    }
  }

  getTorrentName(path) {
    if (!path) return 'Unknown';
    return path.split(/[\\\\/]/).pop() || 'Unknown';
  }

  async handleLaunch(config) {
    try {
      const res = await invoke('launch_session', { req: config });
      if (res.success) {
        Toast.success('Session lancee avec succes');
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
        Toast.success('Session arretee');
        if (this.selectedSessionId === id) this.selectedSessionId = null;
        await this.refreshSessions();
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
      const res = await invoke('get_sessions');
      if (res.success) {
        this.sessions = res.data;
        this.updateStats();
        this.renderSessions();
        this.renderLogPanel();
      }
    } catch (e) { console.error('Failed to refresh sessions:', e); }
  }

  updateStats() {
    const active = this.sessions.filter(s => s.status === 'running').length;
    const totalUpload = this.sessions.reduce((sum, s) => sum + s.total_uploaded_mb, 0) / 1024;
    const totalDownload = this.sessions.reduce((sum, s) => sum + s.total_downloaded_mb, 0) / 1024;
    const ratios = this.sessions.map(s => s.ratio).filter(r => r > 0);
    const avgRatio = ratios.length > 0 ? (ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(1) : '0.0';

    document.getElementById('stat-active').textContent = active;
    document.getElementById('stat-upload').innerHTML = `${totalUpload.toFixed(1)} <span class='stat-unit'>GB</span>`;
    document.getElementById('stat-download').innerHTML = `${totalDownload.toFixed(1)} <span class='stat-unit'>GB</span>`;
    document.getElementById('stat-ratio').textContent = avgRatio;
  }

  startPolling() {
    this.pollingInterval = setInterval(() => this.refreshSessions(), 2000);
  }

  setupGlobalEvents() {
    window.addEventListener('beforeunload', (e) => {
      const active = this.sessions.filter(s => s.status === 'running').length;
      if (active > 0) { e.preventDefault(); e.returnValue = ''; }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
