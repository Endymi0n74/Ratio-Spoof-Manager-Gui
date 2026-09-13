import { SpeedChart } from './SpeedChart.js';

export class SessionCard {
  constructor(session, options) {
    this.session = session;
    this.icons = options.icons || {};
    this.onSelect = options.onSelect;
    this.onStop = options.onStop;
    this.onDelete = options.onDelete;
    this.onPause = options.onPause;
    this.onResume = options.onResume;
    this.isSelected = options.isSelected || false;
    this.lazyChart = options.lazyChart || false;
    this.speedHistory = [];
    this.chart = null;
    this._isVisible = false;
    this._lastSpeed = null;
    this._lastStatus = null;
    this._lastUpload = null;
    this._lastRatio = null;
    this._lastProgress = null;
    this._lastTime = null;

    this.element = this.createElement();
    this.attachCardEvents();
    this.attachActionEvents();
  }

  createElement() {
    const s = this.session;
    const card = document.createElement('div');
    card.className = 'session-card';
    card.dataset.sessionId = s.id;
    if (this.isSelected) card.classList.add('selected');

    card.innerHTML = this.renderHTML(s);

    if (!this.lazyChart) {
      this.initChart(s);
    }

    return card;
  }

  initChart(s) {
    const chartContainer = this.element.querySelector('.session-chart');
    if (chartContainer && !this.chart) {
      this.chart = new SpeedChart(chartContainer, { height: 50, color: '#22c55e' });
      this.pushSpeed(s.current_upload_speed ?? s.upload_speed ?? s.speed ?? 0);
    }
  }

  renderHTML(s) {
    const statusClass = this.getStatusClass(s.status);
    const statusText = this.getStatusText(s.status);
    const uploadedMb = s.total_uploaded_mb ?? s.uploaded_mb ?? s.uploaded ?? 0;
    const uploadSpeed = s.current_upload_speed ?? s.upload_speed ?? s.speed ?? 0;
    const downloadedMb = s.total_downloaded_mb ?? s.downloaded_mb ?? s.downloaded ?? 1;
    const ratio = s.ratio ?? (downloadedMb > 0 ? uploadedMb / downloadedMb : 0);
    const progress = s.progress_percent ?? s.progress ?? s.downloaded_percent ?? 0;
    const elapsed = s.elapsed_seconds ?? s.elapsed ?? s.uptime ?? 0;

    return `
      <div class="session-card-header">
        <div class="session-card-info">
          <div class="session-status-dot ${statusClass}"></div>
          <div>
            <div class="session-name" title="${s.config?.torrent_path || ''}">${this.getTorrentName(s.config?.torrent_path)}</div>
            <div class="session-meta">${s.config?.client || '?'} &middot; port ${s.config?.port || '?'} &middot; ${statusText}</div>
          </div>
        </div>
        <div class="session-actions">
          ${this.renderActions(s.status)}
        </div>
      </div>

      <div class="session-metrics">
        <div class="session-metric">
          <div class="session-metric-label">Upload</div>
          <div class="session-metric-value" data-stat="upload">${this.formatSize(uploadedMb)}</div>
        </div>
        <div class="session-metric">
          <div class="session-metric-label">Vitesse UL</div>
          <div class="session-metric-value success" data-stat="speed">${this.formatSpeed(uploadSpeed)}</div>
        </div>
        <div class="session-metric">
          <div class="session-metric-label">Ratio</div>
          <div class="session-metric-value" data-stat="ratio">${ratio.toFixed(1)}</div>
        </div>
        <div class="session-metric">
          <div class="session-metric-label">Temps</div>
          <div class="session-metric-value" data-stat="time">${this.formatTime(elapsed)}</div>
        </div>
      </div>

      <div class="session-chart-wrap">
        <div class="session-chart"></div>
      </div>

      <div class="session-progress">
        <div class="session-progress-bar" data-stat="progress" style="width: ${Math.min(progress, 100)}%"></div>
      </div>
    `;
  }

  attachCardEvents() {
    this.element.addEventListener('click', (e) => {
      if (!e.target.closest('.session-actions') && !e.target.closest('button')) {
        this.onSelect?.(this.session.id);
      }
    });
  }

  attachActionEvents() {
    this.element.querySelector('.btn-stop')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onStop?.(this.session.id);
    });
    this.element.querySelector('.btn-delete')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onDelete?.(this.session.id);
    });
    this.element.querySelector('.btn-pause')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onPause?.(this.session.id);
    });
    this.element.querySelector('.btn-resume')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onResume?.(this.session.id);
    });
  }

  pushSpeed(kbps) {
    this.speedHistory.push(kbps || 0);
    if (this.speedHistory.length > 60) this.speedHistory.shift();
    if (this.chart) {
      this.chart.data = this.speedHistory;
      this.chart.draw();
    }
  }

  update(session) {
    this.session = session;
    const s = session;

    const uploadedMb = s.total_uploaded_mb ?? s.uploaded_mb ?? s.uploaded ?? 0;
    const uploadSpeed = s.current_upload_speed ?? s.upload_speed ?? s.speed ?? 0;
    const downloadedMb = s.total_downloaded_mb ?? s.downloaded_mb ?? s.downloaded ?? 1;
    const ratio = s.ratio ?? (downloadedMb > 0 ? uploadedMb / downloadedMb : 0);
    const progress = s.progress_percent ?? s.progress ?? s.downloaded_percent ?? 0;
    const elapsed = s.elapsed_seconds ?? s.elapsed ?? s.uptime ?? 0;

    if (this._lastStatus !== s.status) {
      this._lastStatus = s.status;
      const dot = this.element.querySelector('.session-status-dot');
      if (dot) dot.className = 'session-status-dot ' + this.getStatusClass(s.status);

      const meta = this.element.querySelector('.session-meta');
      if (meta) meta.innerHTML = (s.config?.client || '?') + ' &middot; port ' + (s.config?.port || '?') + ' &middot; ' + this.getStatusText(s.status);

      const actions = this.element.querySelector('.session-actions');
      if (actions) {
        actions.innerHTML = this.renderActions(s.status);
        this.attachActionEvents();
      }
    }

    if (this._lastUpload !== uploadedMb) {
      this._lastUpload = uploadedMb;
      const uploadEl = this.element.querySelector('[data-stat="upload"]');
      if (uploadEl) uploadEl.textContent = this.formatSize(uploadedMb);
    }

    if (this._lastSpeed === null || Math.abs((this._lastSpeed || 0) - uploadSpeed) > 0.1) {
      this._lastSpeed = uploadSpeed;
      const speedEl = this.element.querySelector('[data-stat="speed"]');
      if (speedEl) speedEl.textContent = this.formatSpeed(uploadSpeed);
      if (this._isVisible || this.chart) {
        this.pushSpeed(uploadSpeed);
      }
    }

    if (this._lastRatio !== ratio) {
      this._lastRatio = ratio;
      const ratioEl = this.element.querySelector('[data-stat="ratio"]');
      if (ratioEl) ratioEl.textContent = ratio.toFixed(1);
    }

    if (this._lastProgress !== progress) {
      this._lastProgress = progress;
      const progressEl = this.element.querySelector('[data-stat="progress"]');
      if (progressEl) progressEl.style.width = Math.min(progress, 100) + '%';
    }

    if (this._lastTime !== elapsed) {
      this._lastTime = elapsed;
      const timeEl = this.element.querySelector('[data-stat="time"]');
      if (timeEl) timeEl.textContent = this.formatTime(elapsed);
    }
  }

  setSelected(isSelected) {
    this.isSelected = isSelected;
    this.element.classList.toggle('selected', isSelected);
  }

  getStatusClass(status) {
    const map = { running: 'running', paused: 'paused', stopped: 'stopped', error: 'error' };
    return map[status] || 'stopped';
  }

  getStatusText(status) {
    const map = {
      running: 'En cours',
      paused: 'En pause',
      stopped: 'Arrete',
      starting: 'Demarrage...',
      error: 'Erreur'
    };
    return map[status] || status;
  }

  renderActions(status) {
    if (status === 'running') {
      return `
        <button class="btn-icon btn-pause" title="Pause">${this.icons.pause || '&#10074;&#10074;'}</button>
        <button class="btn-icon danger btn-stop" title="Arreter">${this.icons.stop || '&#9632;'}</button>
      `;
    } else if (status === 'paused') {
      return `
        <button class="btn-icon btn-resume" title="Reprendre">${this.icons.play || '&#9654;'}</button>
        <button class="btn-icon danger btn-stop" title="Arreter">${this.icons.stop || '&#9632;'}</button>
      `;
    } else {
      return `
        <button class="btn-icon danger btn-delete" title="Supprimer">&#10005;</button>
      `;
    }
  }

    getTorrentName(path) {
    if (!path) return 'Unknown';
    const idx = path.lastIndexOf('/');
    const idx2 = path.lastIndexOf('\\');
    const lastSep = Math.max(idx, idx2);
    return lastSep >= 0 ? path.slice(lastSep + 1) : path;
  }

  formatSize(mb) {
    if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
    if (mb >= 1) return mb.toFixed(0) + ' MB';
    return (mb * 1024).toFixed(0) + ' KB';
  }

  formatSpeed(kbps) {
    if (kbps >= 1000) return (kbps / 1000).toFixed(1) + ' MB/s';
    if (kbps > 0) return kbps.toFixed(0) + ' KB/s';
    return '—';
  }

  formatTime(seconds) {
    if (!seconds || seconds <= 0) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const sec = Math.floor(seconds % 60);
    if (h > 0) return h + 'h' + m.toString().padStart(2, '0');
    return m + 'm' + sec.toString().padStart(2, '0') + 's';
  }
}
