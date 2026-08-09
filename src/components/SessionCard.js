export class SessionCard {
  constructor(session, options) {
    this.session = session;
    this.icons = options.icons || {};
    this.onSelect = options.onSelect;
    this.onStop = options.onStop;
    this.onPause = options.onPause;
    this.onResume = options.onResume;
    this.isSelected = options.isSelected || false;

    this.element = this.createElement();
  }

  createElement() {
    const s = this.session;

    const card = document.createElement('div');
    card.className = 'session-card';
    card.dataset.sessionId = s.id;
    if (this.isSelected) card.classList.add('selected');

    card.innerHTML = this.renderHTML(s);
    this.attachEvents(card, s);

    return card;
  }

  renderHTML(s) {
    const statusClass = this.getStatusClass(s.status);
    const statusText = this.getStatusText(s.status);

    return `
      <div class="session-card-header">
        <div class="session-card-info">
          <div class="session-status-dot ${statusClass}"></div>
          <div>
            <div class="session-name" title="${s.config.torrent_path}">${this.getTorrentName(s.config.torrent_path)}</div>
            <div class="session-meta">${s.config.client} &middot; port ${s.config.port} &middot; ${statusText}</div>
          </div>
        </div>
        <div class="session-actions">
          ${this.renderActions(s.status)}
        </div>
      </div>

      <div class="session-metrics">
        <div class="session-metric">
          <div class="session-metric-label">Upload</div>
          <div class="session-metric-value" data-stat="upload">${this.formatSize(s.total_uploaded_mb)}</div>
        </div>
        <div class="session-metric">
          <div class="session-metric-label">Vitesse UL</div>
          <div class="session-metric-value success" data-stat="speed">${this.formatSpeed(s.current_upload_speed)}</div>
        </div>
        <div class="session-metric">
          <div class="session-metric-label">Ratio</div>
          <div class="session-metric-value" data-stat="ratio">${s.ratio.toFixed(1)}</div>
        </div>
      </div>

      <div class="session-progress">
        <div class="session-progress-bar" data-stat="progress" style="width: ${Math.min(s.progress_percent || 0, 100)}%"></div>
      </div>
    `;
  }

  attachEvents(card, s) {
    card.addEventListener('click', (e) => {
      if (!e.target.closest('.session-actions') && !e.target.closest('button')) {
        this.onSelect?.(s.id);
      }
    });

    card.querySelector('.btn-stop')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onStop?.(s.id);
    });
    card.querySelector('.btn-pause')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onPause?.(s.id);
    });
    card.querySelector('.btn-resume')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onResume?.(s.id);
    });
  }

  // Met a jour la card en place sans la recreer
  update(session) {
    this.session = session;
    const s = session;

    // Status dot
    const dot = this.element.querySelector('.session-status-dot');
    if (dot) {
      dot.className = `session-status-dot ${this.getStatusClass(s.status)}`;
    }

    // Meta texte
    const meta = this.element.querySelector('.session-meta');
    if (meta) {
      meta.innerHTML = `${s.config.client} &middot; port ${s.config.port} &middot; ${this.getStatusText(s.status)}`;
    }

    // Actions
    const actions = this.element.querySelector('.session-actions');
    if (actions) {
      actions.innerHTML = this.renderActions(s.status);
      this.attachEvents(this.element, s);
    }

    // Stats
    const uploadEl = this.element.querySelector('[data-stat="upload"]');
    if (uploadEl) uploadEl.textContent = this.formatSize(s.total_uploaded_mb);

    const speedEl = this.element.querySelector('[data-stat="speed"]');
    if (speedEl) speedEl.textContent = this.formatSpeed(s.current_upload_speed);

    const ratioEl = this.element.querySelector('[data-stat="ratio"]');
    if (ratioEl) ratioEl.textContent = s.ratio.toFixed(1);

    // Progress bar
    const progressEl = this.element.querySelector('[data-stat="progress"]');
    if (progressEl) progressEl.style.width = `${Math.min(s.progress_percent || 0, 100)}%`;
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
        <button class="btn-icon danger btn-stop" title="Supprimer">&#10005;</button>
      `;
    }
  }

  getTorrentName(path) {
    if (!path) return 'Unknown';
    return path.replace(/\\/g, '/').split('/').pop() || 'Unknown';
  }

  formatSize(mb) {
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    if (mb >= 1) return `${mb.toFixed(0)} MB`;
    return `${(mb * 1024).toFixed(0)} KB`;
  }

  formatSpeed(kbps) {
    if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} MB/s`;
    if (kbps > 0) return `${kbps.toFixed(0)} KB/s`;
    return '—';
  }
}
