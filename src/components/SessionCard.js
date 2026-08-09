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
    const statusClass = this.getStatusClass(s.status);
    const statusText = this.getStatusText(s.status);

    const card = document.createElement('div');
    card.className = 'session-card';
    if (this.isSelected) {
      card.style.borderColor = 'var(--accent)';
      card.style.background = 'rgba(59, 130, 246, 0.03)';
    }

    card.innerHTML = `
      <div class="session-card-header">
        <div class="session-card-info">
          <div class="session-status-dot ${statusClass}"></div>
          <div>
            <div class="session-name" title="${s.config.torrent_path}">${this.getTorrentName(s.config.torrent_path)}</div>
            <div class="session-meta">${s.config.client} · port ${s.config.port} · ${statusText}</div>
          </div>
        </div>
        <div class="session-actions">
          ${this.renderActions(s.status)}
        </div>
      </div>

      <div class="session-metrics">
        <div class="session-metric">
          <div class="session-metric-label">Upload</div>
          <div class="session-metric-value">${this.formatSize(s.total_uploaded_mb)}</div>
        </div>
        <div class="session-metric">
          <div class="session-metric-label">Vitesse UL</div>
          <div class="session-metric-value success">${this.formatSpeed(s.current_upload_speed)}</div>
        </div>
        <div class="session-metric">
          <div class="session-metric-label">Ratio</div>
          <div class="session-metric-value">${s.ratio.toFixed(1)}</div>
        </div>
      </div>

      <div class="session-progress">
        <div class="session-progress-bar" style="width: ${Math.min(s.progress_percent, 100)}%"></div>
      </div>
    `;

    // Click to select
    card.addEventListener('click', (e) => {
      if (!e.target.closest('.session-actions') && !e.target.closest('button')) {
        this.onSelect?.(s.id);
      }
    });

    // Action buttons
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

    return card;
  }

  getStatusClass(status) {
    switch (status) {
      case 'running': return 'running';
      case 'paused': return 'paused';
      case 'stopped': return 'stopped';
      case 'error': return 'error';
      default: return 'stopped';
    }
  }

  getStatusText(status) {
    switch (status) {
      case 'running': return 'En cours';
      case 'paused': return 'En pause';
      case 'stopped': return 'Arrêté';
      case 'starting': return 'Démarrage...';
      case 'error': return 'Erreur';
      default: return status;
    }
  }

  renderActions(status) {
    if (status === 'running') {
      return `
        <button class="btn-icon" title="Pause">${this.icons.pause || '⏸'}</button>
        <button class="btn-icon danger btn-stop" title="Arrêter">${this.icons.stop || '⏹'}</button>
      `;
    } else if (status === 'paused') {
      return `
        <button class="btn-icon btn-resume" title="Reprendre">${this.icons.play || '▶'}</button>
        <button class="btn-icon danger btn-stop" title="Arrêter">${this.icons.stop || '⏹'}</button>
      `;
    } else {
      return `
        <button class="btn-icon danger btn-stop" title="Supprimer">${this.icons.close || '✕'}</button>
      `;
    }
  }

  getTorrentName(path) {
    if (!path) return 'Unknown';
    return path.split(/[\\/]/).pop() || 'Unknown';
  }

  formatSize(mb) {
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)} GB`;
    } else if (mb >= 1) {
      return `${mb.toFixed(0)} MB`;
    } else {
      return `${(mb * 1024).toFixed(0)} KB`;
    }
  }

  formatSpeed(kbps) {
    if (kbps >= 1000) {
      return `${(kbps / 1000).toFixed(1)} MB/s`;
    } else if (kbps > 0) {
      return `${kbps.toFixed(0)} KB/s`;
    } else {
      return '—';
    }
  }
}
