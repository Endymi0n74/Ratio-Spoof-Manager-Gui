import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Toast } from './Toast.js';

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

    this.render();
    this.attachEvents();
  }

  render() {
    this.container.innerHTML = `
      <div class="presets-bar" id="presets-bar"></div>

      <div class="drop-zone" id="drop-zone">
        <div class="drop-zone-icon">${this.icons.upload || ''}</div>
        <div class="drop-zone-text">Déposez un fichier .torrent</div>
        <div class="drop-zone-hint">ou cliquez pour parcourir</div>
      </div>

      <div class="file-chip hidden" id="file-chip">
        <span class="file-chip-icon">${this.icons.folder || ''}</span>
        <span class="file-chip-name" id="file-chip-name"></span>
        <button class="file-chip-remove" id="file-chip-remove">${this.icons.close || ''}</button>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Téléchargé</label>
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
          <label class="form-label">Uploadé</label>
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
            <option value="qbit-4.0.3" ${this.settings?.default_client === 'qbit-4.0.3' ? 'selected' : ''}>qBittorrent 4.0.3</option>
            <option value="qbit-4.3.3" ${this.settings?.default_client === 'qbit-4.3.3' ? 'selected' : ''}>qBittorrent 4.3.3</option>
          </select>
        </div>
      </div>

      <div class="form-group mt-3">
        <label class="form-label">Moteur</label>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary" id="btn-embedded" style="flex: 1;">Intégré</button>
          <button class="btn btn-secondary" id="btn-custom" style="flex: 1;">Personnalisé</button>
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
      <button class="preset-btn" data-preset="${p.id}" title="${p.description}">
        ${p.name}
      </button>
    `).join('');
  }

  attachEvents() {
    // Presets
    document.getElementById('presets-bar')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('preset-btn')) {
        const presetId = e.target.dataset.preset;
        this.applyPreset(presetId);
      }
    });

    // Drop zone
    const dropZone = document.getElementById('drop-zone');
    dropZone?.addEventListener('click', () => this.pickTorrent());
    dropZone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone?.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    dropZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files.length > 0 && files[0].name.endsWith('.torrent')) {
        this.setTorrent(files[0].path || files[0].name);
      }
    });

    // File chip remove
    document.getElementById('file-chip-remove')?.addEventListener('click', () => {
      this.clearTorrent();
    });

    // Validation on input
    ['dl', 'dl-speed', 'ul', 'ul-speed', 'port'].forEach(field => {
      const el = document.getElementById(`field-${field}`);
      if (el) {
        el.addEventListener('input', () => this.validateField(field));
      }
    });

    // Engine buttons
    document.getElementById('btn-embedded')?.addEventListener('click', () => {
      this.useEmbeddedEngine = true;
      document.getElementById('field-engine').classList.add('hidden');
      document.getElementById('btn-embedded').style.borderColor = 'var(--accent)';
      document.getElementById('btn-embedded').style.color = 'var(--accent)';
      document.getElementById('btn-custom').style.borderColor = '';
      document.getElementById('btn-custom').style.color = '';
    });

    document.getElementById('btn-custom')?.addEventListener('click', () => {
      this.useEmbeddedEngine = false;
      document.getElementById('field-engine').classList.remove('hidden');
      document.getElementById('btn-custom').style.borderColor = 'var(--accent)';
      document.getElementById('btn-custom').style.color = 'var(--accent)';
      document.getElementById('btn-embedded').style.borderColor = '';
      document.getElementById('btn-embedded').style.color = '';
      this.pickEngine();
    });

    // Launch
    document.getElementById('btn-launch')?.addEventListener('click', () => this.launch());

    // Default to embedded
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

    // Update active state
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === presetId);
    });

    // Re-validate all
    ['dl', 'dl-speed', 'ul', 'ul-speed', 'port'].forEach(f => this.validateField(f));

    Toast.success(`Preset "${preset.name}" appliqué`);
  }

  async pickTorrent() {
    try {
      const res = await invoke('pick_torrent');
      if (res.success && res.data) {
        this.setTorrent(res.data);
      }
    } catch (e) {
      console.error('Pick torrent failed:', e);
    }
  }

  setTorrent(path) {
    this.torrentPath = path;
    document.getElementById('drop-zone').classList.add('hidden');
    document.getElementById('file-chip').classList.remove('hidden');
    document.getElementById('file-chip-name').textContent = path.split(/[\\/]/).pop();
  }

  clearTorrent() {
    this.torrentPath = '';
    document.getElementById('drop-zone').classList.remove('hidden');
    document.getElementById('file-chip').classList.add('hidden');
    document.getElementById('file-chip-name').textContent = '';
  }

  async pickEngine() {
    try {
      const res = await invoke('pick_executable');
      if (res.success && res.data) {
        document.getElementById('field-engine').value = res.data;
      }
    } catch (e) {
      console.error('Pick engine failed:', e);
    }
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

    const type = field === 'port' ? 'port' : (field.includes('speed') ? 'speed' : 'amount');

    try {
      const res = await invoke('validate_field', { value, field_type: type });
      if (res.success) {
        const result = res.data;
        el.classList.toggle('valid', result.valid);
        el.classList.toggle('invalid', !result.valid);
        feedback.className = `validation-feedback ${result.valid ? 'success' : 'error'}`;
        feedback.textContent = result.valid ? '✓' : result.message;
        this.validationState[field] = result.valid;
      }
    } catch (e) {
      console.error('Validation error:', e);
    }
  }

  async launch() {
    if (!this.torrentPath) {
      Toast.error('Veuillez sélectionner un fichier .torrent');
      return;
    }

    // Validate all fields
    const fields = ['dl', 'dl-speed', 'ul', 'ul-speed', 'port'];
    for (const f of fields) {
      await this.validateField(f);
    }

    const allValid = fields.every(f => this.validationState[f]);
    if (!allValid) {
      Toast.error('Veuillez corriger les champs invalides');
      return;
    }

    const enginePath = this.useEmbeddedEngine 
      ? 'ratio-spoof' 
      : document.getElementById('field-engine').value;

    if (!this.useEmbeddedEngine && !enginePath) {
      Toast.error('Veuillez sélectionner un moteur personnalisé');
      return;
    }

    const config = {
      torrent_path: this.torrentPath,
      downloaded: document.getElementById('field-dl').value.trim().toLowerCase().replace(',', '.'),
      dl_speed: document.getElementById('field-dl-speed').value.trim().toLowerCase().replace(',', '.'),
      uploaded: document.getElementById('field-ul').value.trim().toLowerCase().replace(',', '.'),
      ul_speed: document.getElementById('field-ul-speed').value.trim().toLowerCase().replace(',', '.'),
      port: parseInt(document.getElementById('field-port').value),
      client: document.getElementById('field-client').value,
      engine_path: enginePath,
    };

    this.onLaunch?.(config);
  }
}
