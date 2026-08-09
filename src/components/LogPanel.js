export class LogPanel {
  constructor(container, options) {
    this.container = container;
    this.session = options.session;
    this.icons = options.icons || {};
    this.filter = 'all';

    this.render();
  }

  render() {
    const logs = this.session.logs || [];
    const filtered = this.filterLogs(logs);

    this.container.innerHTML = `
      <div class="log-container">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <div style="font-size: 12px; font-weight: 600; color: var(--text-secondary);">
            ${this.icons.document || ''} Journal — ${this.getTorrentName(this.session.config.torrent_path)}
          </div>
          <div class="log-filters">
            <button class="log-filter ${this.filter === 'all' ? 'active' : ''}" data-filter="all">Tout</button>
            <button class="log-filter ${this.filter === 'info' ? 'active' : ''}" data-filter="info">Info</button>
            <button class="log-filter ${this.filter === 'tracker' ? 'active' : ''}" data-filter="tracker">Tracker</button>
            <button class="log-filter ${this.filter === 'error' ? 'active' : ''}" data-filter="error">Erreurs</button>
          </div>
        </div>
        <div class="log-entries">
          ${filtered.length === 0 
            ? '<div style="color: var(--text-muted); font-size: 12px; padding: 20px; text-align: center;">Aucun log</div>'
            : filtered.map(log => this.renderLogEntry(log)).join('')
          }
        </div>
      </div>
    `;

    // Filter events
    this.container.querySelectorAll('.log-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        this.filter = btn.dataset.filter;
        this.render();
      });
    });

    // Auto-scroll to bottom
    const entries = this.container.querySelector('.log-entries');
    if (entries) {
      entries.scrollTop = entries.scrollHeight;
    }
  }

  filterLogs(logs) {
    if (this.filter === 'all') return logs;
    return logs.filter(log => {
      if (this.filter === 'info') return log.level === 'info' || log.level === 'debug';
      if (this.filter === 'tracker') return log.level === 'tracker';
      if (this.filter === 'error') return log.level === 'error' || log.level === 'warn';
      return true;
    });
  }

  renderLogEntry(log) {
    const time = new Date(log.timestamp).toLocaleTimeString('fr-FR', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });

    return `
      <div class="log-entry">
        <span class="log-timestamp">${time}</span>
        <span class="log-level ${log.level}">${log.level}</span>
        <span class="log-message">${this.escapeHtml(log.message)}</span>
      </div>
    `;
  }

  getTorrentName(path) {
    if (!path) return 'Unknown';
    return path.split(/[\\/]/).pop() || 'Unknown';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
