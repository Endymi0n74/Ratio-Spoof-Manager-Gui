import { open } from '@tauri-apps/plugin-dialog';
import { Toast } from './Toast.js';

// Seuls les clients supportes par le backend ratio-spoof
const SUPPORTED_CLIENTS = [
  { id: 'qbit-4.0.3', name: 'qBittorrent 4.0.3' },
  { id: 'qbit-4.3.3', name: 'qBittorrent 4.3.3' },
  { id: 'custom',     name: 'ID personnalise...' },
];

export class NewSessionForm {
  constructor(container, options) {
    this.container = container;
    this.presets = options.presets || [];
    this.settings = options.settings || {};
    this.onLaunch = options.onLaunch;
    this.icons = options.icons || {};
    this.torrentPath = '';
    this.selectedPreset = null;
    this.validationState = {};
    this.useEmbeddedEngine = true;

    this.render();
    this.attachEvents();
  }

  render() {
    const clientOptions = SUPPORTED_CLIENTS.map(c =>
      `<option value="${c.id}" ${this.settings?.default_client === c.id ? 'selected' : ''}>${c.name}</option>`
    ).join('');

    this.container.innerHTML = `
      <div class="presets-bar" id="presets-bar"></div>

      <div class="drop-zone" id="drop-zone">
        <div class="drop-zone-icon">${this.icons.upload || ''}</div>
        <div class="drop-zone-text">Deposez un fichier .torrent</div>
        <div class="drop-zone-hint">ou cliquez pour parcourir</div>
      </div>

      <div class="file-chip hidden" id="file-chip">
        <span class="file-chip-icon">${this.icons.folder || ''}</span>
        <span class="file-chip-name" id="file-chip-name"></span>
        <button class="file-chip-remove" id="file-chip-remove">${this.icons.close || '&times;'}</button>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Telecharge</label>
          <input type="text" class="form-input" id="field-dl" value="${this.settings?.default_downloaded || '100%'}" placeholder="ex: 100%">
          <div class="validation-feedback" id="feedback-dl"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Vitesse DL</label>
          <input type="text" class="form-input" id="field-dl-speed" value="${this.settings?.default_dl_speed || '0kbps'}" placeholder="ex: 10mbps">
          <div class="validation-feedback" id="feedback-dl-speed"></div>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Uploade</label>
          <input type="text" class="form-input" id="field-ul" value="${this.settings?.default_uploaded || '0%'}" placeholder="ex: 50%">
          <div class="validation-feedback" id="feedback-ul"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Vitesse UL</label>
          <input type="text" class="form-input" id="field-ul-speed" value="${this.settings?.default_ul_speed || '5mbps'}" placeholder="ex: 5mbps">
          <div class="validation-feedback" id="feedback-ul-speed"></div>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Port</label>
          <input type="text" class="form-input" id="field-port" value="${this.settings?.default_port || '8999'}" placeholder="1-65535">
          <div class="validation-feedback" id="feedback-port"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Client</label>
          <select class="form-select" id="field-client">
            ${clientOptions}
          </select>
          <input type="text" class="form-input hidden mt-3" id="field-client-custom" placeholder="Peer ID (ex: QB4650)">
        </div>
      </div>

      <div class="form-group mt-3">
        <label class="form-label">Moteur</label>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary" id="btn-embedded" style="flex: 1;">Integre</button>
          <button class="btn btn-secondary" id="btn-custom" style="flex: 1;">Personnalise</button>
        </div>
        <input type="text" class="form-input mt-3 hidden" id="field-engine" placeholder="Chemin vers ratio-spoof" readonly>
      </div>

      <button class="btn btn-primary w-full mt-3" id="btn-launch" style="margin-top: 16px;">
        ${this.icons.play || ''} Lancer la session
      </button>
    `;

    this.renderPresets();
  }

  renderPresets() {
    const bar = document.getElementById('presets-bar');
    if (!bar) return;

    bar.innerHTML = this.presets.map(p => `
      <button class="preset-btn" data-preset="${p.id}" title="${p.description || ''}">
        ${p.name}
      </button>
    `).join('');
  }

  attachEvents() {
    document.getElementById('presets-bar')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('preset-btn')) {
        this.applyPreset(e.target.dataset.preset);
      }
    });

    const dropZone = document.getElementById('drop-zone');
    dropZone?.addEventListener('click', () => this.pickTorrent());
    dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files.length > 0 && files[0].name.endsWith('.torrent')) {
        this.setTorrent(files[0].path || files[0].name);
      }
    });

    document.getElementById('file-chip-remove')?.addEventListener('click', () => this.clearTorrent());

    ['dl', 'dl-speed', 'ul', 'ul-speed', 'port'].forEach(field => {
      const el = document.getElementById(`field-${field}`);
      if (el) el.addEventListener('input', () => this.validateField(field));
    });

    document.getElementById('field-client')?.addEventListener('change', (e) => {
      const customInput = document.getElementById('field-client-custom');
      customInput?.classList.toggle('hidden', e.target.value !== 'custom');
      if (e.target.value === 'custom') customInput?.focus();
    });

    document.getElementById('btn-embedded')?.addEventListener('click', () => {
      this.useEmbeddedEngine = true;
      document.getElementById('field-engine').classList.add('hidden');
      document.getElementById('btn-embedded').classList.add('active');
      document.getElementById('btn-custom').classList.remove('active');
    });

    document.getElementById('btn-custom')?.addEventListener('click', () => {
      this.useEmbeddedEngine = false;
      document.getElementById('field-engine').classList.remove('hidden');
      document.getElementById('btn-custom').classList.add('active');
      document.getElementById('btn-embedded').classList.remove('active');
      this.pickEngine();
    });

    document.getElementById('btn-launch')?.addEventListener('click', () => this.launch());
    document.getElementById('btn-embedded')?.click();
  }

  applyPreset(presetId) {
    const preset = this.presets.find(p => p.id === presetId);
    if (!preset) return;

    document.getElementById('field-dl').value = preset.config.downloaded;
    document.getElementById('field-dl-speed').value = preset.config.dl_speed;
    document.getElementById('field-ul').value = preset.config.uploaded;
    document.getElementById('field-ul-speed').value = preset.config.ul_speed;
    document.getElementById('field-port').value = preset.config.port;

    if (preset.config.client) {
      const clientSelect = document.getElementById('field-client');
      const customInput = document.getElementById('field-client-custom');
      const known = SUPPORTED_CLIENTS.find(c => c.id === preset.config.client);
      if (known && known.id !== 'custom') {
        clientSelect.value = preset.config.client;
        customInput?.classList.add('hidden');
      } else {
        clientSelect.value = 'custom';
        customInput?.classList.remove('hidden');
        customInput.value = preset.config.client || '';
      }
    }

    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === presetId);
    });

    ['dl', 'dl-speed', 'ul', 'ul-speed', 'port'].forEach(f => this.validateField(f));
    Toast.success(`Preset "${preset.name}" applique`);
  }

  async pickTorrent() {
    try {
      const selected = await open({ multiple: false, filters: [{ name: 'Torrent', extensions: ['torrent'] }] });
      if (selected) this.setTorrent(selected);
    } catch (e) {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.torrent';
      input.onchange = (ev) => { const f = ev.target.files[0]; if (f) this.setTorrent(f.name); };
      input.click();
    }
  }

  setTorrent(path) {
    this.torrentPath = path;
    document.getElementById('drop-zone').classList.add('hidden');
    document.getElementById('file-chip').classList.remove('hidden');
    document.getElementById('file-chip-name').textContent = path.replace(/\\/g, '/').split('/').pop();
  }

  clearTorrent() {
    this.torrentPath = '';
    document.getElementById('drop-zone').classList.remove('hidden');
    document.getElementById('file-chip').classList.add('hidden');
    document.getElementById('file-chip-name').textContent = '';
  }

  async pickEngine() {
    try {
      const selected = await open({ multiple: false, filters: [{ name: 'Executable', extensions: ['exe', 'bat', 'cmd', 'sh'] }] });
      if (selected) document.getElementById('field-engine').value = selected;
    } catch (e) { console.error(e); }
  }

  async validateField(field) {
    const el = document.getElementById(`field-${field}`);
    const feedback = document.getElementById(`feedback-${field}`);
    if (!el || !feedback) return;

    const value = el.value.trim();
    if (!value) {
      el.classList.remove('valid', 'invalid');
      feedback.textContent = '';
      this.validationState[field] = false;
      return;
    }

    let valid = true, msg = '';
    if (field === 'port') {
      const n = parseInt(value);
      valid = !isNaN(n) && n > 0 && n <= 65535;
      msg = valid ? 'OK' : 'Port invalide';
    } else if (field.includes('speed')) {
      valid = /^\d+\s*(bps|kbps|mbps|gbps)$/i.test(value);
      msg = valid ? 'OK' : 'Format: 5mbps';
    } else {
      valid = /^\d+\s*(%|mb|gb|tb)?$/i.test(value) || /^\d+(\.\d+)?\s*(%|mb|gb|tb)$/i.test(value);
      msg = valid ? 'OK' : 'Format: 100% ou 500MB';
    }

    el.classList.toggle('valid', valid);
    el.classList.toggle('invalid', !valid);
    feedback.className = `validation-feedback ${valid ? 'success' : 'error'}`;
    feedback.textContent = msg;
    this.validationState[field] = valid;
  }

  async launch() {
    if (!this.torrentPath) {
      Toast.error('Veuillez selectionner un fichier .torrent');
      return;
    }

    const fields = ['dl', 'dl-speed', 'ul', 'ul-speed', 'port'];
    for (const f of fields) await this.validateField(f);

    const allValid = fields.every(f => this.validationState[f]);
    if (!allValid) {
      Toast.error('Veuillez corriger les champs invalides');
      return;
    }

    const enginePath = this.useEmbeddedEngine ? 'ratio-spoof' : document.getElementById('field-engine').value;
    if (!this.useEmbeddedEngine && !enginePath) {
      Toast.error('Veuillez selectionner un moteur personnalise');
      return;
    }

    let clientValue = document.getElementById('field-client').value;
    if (clientValue === 'custom') {
      const customVal = document.getElementById('field-client-custom')?.value.trim();
      if (!customVal) { Toast.error('Veuillez saisir un ID client'); return; }
      clientValue = customVal;
    }

    const config = {
      torrent_path: this.torrentPath,
      downloaded: document.getElementById('field-dl').value.trim().toLowerCase().replace(',', '.'),
      dl_speed: document.getElementById('field-dl-speed').value.trim().toLowerCase().replace(',', '.'),
      uploaded: document.getElementById('field-ul').value.trim().toLowerCase().replace(',', '.'),
      ul_speed: document.getElementById('field-ul-speed').value.trim().toLowerCase().replace(',', '.'),
      port: parseInt(document.getElementById('field-port').value),
      client: clientValue,
      engine_path: enginePath,
    };

    this.onLaunch?.(config);
  }
}
