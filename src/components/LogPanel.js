export class LogPanel {
  constructor(container, options) {
    this.container = container;
    this.session = options.session;
    this.icons = options.icons || {};
    this.filter = 'all';
    this.renderedCount = 0;
    this.entriesContainer = null;
    this.render();
  }

  render() {
    const logs = this.session.logs || [];
    this.renderedCount = logs.length;

    this.container.innerHTML = `
      <div class="log-container">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <div style="font-size: 12px; font-weight: 600; color: var(--text-secondary);">
            Journal
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button class="btn btn-secondary" id="btn-export-logs" style="padding: 4px 10px; font-size: 11px;">
              Exporter
            </button>
            <div class="log-filters">
              <button class="log-filter ${this.filter === 'all' ? 'active' : ''}" data-filter="all">Tout</button>
              <button class="log-filter ${this.filter === 'info' ? 'active' : ''}" data-filter="info">Info</button>
              <button class="log-filter ${this.filter === 'tracker' ? 'active' : ''}" data-filter="tracker">Tracker</button>
              <button class="log-filter ${this.filter === 'error' ? 'active' : ''}" data-filter="error">Erreurs</button>
            </div>
          </div>
        </div>
        <div class="log-entries" id="log-entries-container"></div>
      </div>
    `;

    this.entriesContainer = this.container.querySelector('#log-entries-container');
    this.renderEntries(logs);

    this.container.querySelectorAll('.log-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        this.filter = btn.dataset.filter;
        this.renderedCount = 0;
        this.render();
      });
    });

    document.getElementById('btn-export-logs')?.addEventListener('click', () => this.exportLogs());
  }

  exportLogs() {
    const logs = this.session.logs || [];
    if (logs.length === 0) {
      alert('Aucun log a exporter');
      return;
    }

    const lines = logs.map(log => {
      const time = new Date(log.timestamp).toLocaleString('fr-FR');
      return `[${time}] [${log.level.toUpperCase()}] ${log.message}`;
    }).join('\n');

    const blob = new Blob([lines], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${this.session.id}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  update(session) {
    this.session = session;
    const logs = session.logs || [];
    const newLogs = logs.slice(this.renderedCount);

    if (newLogs.length === 0) return;

    const filtered = this.filterLogs(newLogs);
    if (filtered.length === 0) {
      this.renderedCount = logs.length;
      return;
    }

    const fragment = document.createDocumentFragment();
    filtered.forEach(log => {
      const el = document.createElement('div');
      el.innerHTML = this.renderLogEntry(log);
      fragment.appendChild(el.firstElementChild);
    });

    this.entriesContainer.appendChild(fragment);
    this.renderedCount = logs.length;
    this.scrollToBottom();
  }

  renderEntries(logs) {
    if (!this.entriesContainer) return;
    const filtered = this.filterLogs(logs);

    if (filtered.length === 0) {
      this.entriesContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; padding: 20px; text-align: center;">Aucun log</div>';
      return;
    }

    this.entriesContainer.innerHTML = filtered.map(log => this.renderLogEntry(log)).join('');
    this.scrollToBottom();
  }

  renderLogEntry(log) {
    const time = new Date(log.timestamp).toLocaleTimeString('fr-FR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    return `
      <div class="log-entry">
        <span class="log-timestamp">${time}</span>
        <span class="log-level ${log.level}">${log.level}</span>
        <span class="log-message">${this.escapeHtml(log.message)}</span>
      </div>
    `;
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

  scrollToBottom() {
    if (this.entriesContainer) {
      this.entriesContainer.scrollTop = this.entriesContainer.scrollHeight;
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
