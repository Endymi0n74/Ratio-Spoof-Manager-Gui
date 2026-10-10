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
    this.onSavePreset = options.onSavePreset;
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
          <div class="speed-row">
            <input type="text" class="form-input" id="field-dl-speed" value="${this.settings?.default_dl_speed || ''}" placeholder="ex: 10" autocomplete="off">
            <select class="form-select speed-unit" id="unit-dl-speed" aria-label="Unite vitesse DL">
              <option value="kbps">kbps</option>
              <option value="mbps">mbps</option>
            </select>
          </div>
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
          <div class="speed-row">
            <input type="text" class="form-input" id="field-ul-speed" value="${this.settings?.default_ul_speed || ''}" placeholder="ex: 5" autocomplete="off">
            <select class="form-select speed-unit" id="unit-ul-speed" aria-label="Unite vitesse UL">
              <option value="kbps">kbps</option>
              <option value="mbps">mbps</option>
            </select>
          </div>
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

    // Bouton sauvegarder preset
    const savePresetBtn = document.createElement('button');
    savePresetBtn.className = 'btn btn-secondary preset-save-btn';
    savePresetBtn.innerHTML = (this.icons.add || '+') + ' Sauvegarder preset';
    savePresetBtn.addEventListener('click', () => this.saveCurrentPreset());
    const presetsBar = document.getElementById('presets-bar');
    if (presetsBar) presetsBar.parentNode.insertBefore(savePresetBtn, presetsBar.nextSibling);
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
      // L'unité se choisit dans le menu déroulant : changer de kbps/mbps doit
      // rejouer la validation du champ associé.
      const unit = document.getElementById(`unit-${field}`);
      if (unit) unit.addEventListener('change', () => this.validateField(field));
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

  saveCurrentPreset() {
    const name = prompt('Nom du preset :');
    if (!name) return;

    const preset = {
      id: 'custom_' + Date.now(),
      name: name,
      description: 'Preset personnalise',
      config: {
        downloaded: document.getElementById('field-dl').value,
        dl_speed: this.readSpeedField('dl-speed') || '',
        uploaded: document.getElementById('field-ul').value,
        ul_speed: this.readSpeedField('ul-speed') || '',
        port: document.getElementById('field-port').value,
        client: document.getElementById('field-client').value,
      }
    };

    this.onSavePreset?.(preset);
  }

  applyPreset(presetId) {
    const preset = this.presets.find(p => p.id === presetId);
    if (!preset) return;

    document.getElementById('field-dl').value = preset.config.downloaded;
    this.setSpeedField('dl-speed', preset.config.dl_speed);
    document.getElementById('field-ul').value = preset.config.uploaded;
    this.setSpeedField('ul-speed', preset.config.ul_speed);
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

  /// Lit une vitesse en deux temps : le nombre dans le champ, l'unité dans le
  /// menu déroulant (le moteur n'accepte que `kbps` et `mbps`).
  ///
  /// Retourne :
  /// - `''` si le champ nombre est vide (champ non renseigné) ;
  /// - la valeur normalisée prête pour le moteur (`« 5mbps »`), l'unité
  ///   étant toujours celle du menu déroulant (kbps par défaut) ;
  /// - `null` si la saisie est invalide.
  ///
  /// Tolérance : « 5mbps » saisi d'un bloc reste accepté, l'unité rejoint
  /// alors le menu déroulant.
  readSpeedField(field) {
    const el = document.getElementById(`field-${field}`);
    const unitEl = document.getElementById(`unit-${field}`);
    if (!el || !unitEl) return null;

    const raw = el.value.trim().toLowerCase().replace(',', '.').replace(/\s+/g, '');
    if (!raw) return '';

    const m = raw.match(/^(\d+(?:\.\d+)?)(kbps|mbps)?$/);
    if (!m) return null;

    // Le menu ne propose plus que kbps/mbps : il porte toujours une unité.
    if (m[2]) unitEl.value = m[2];
    return m[1] + unitEl.value;
  }

  /// Remplit nombre + unité à partir d'une valeur complète (« 0kbps »), pour
  /// les presets et la restauration des réglages.
  setSpeedField(field, value) {
    const el = document.getElementById(`field-${field}`);
    const unitEl = document.getElementById(`unit-${field}`);
    if (!el || !unitEl) return;

    const m = String(value ?? '')
      .trim().toLowerCase().replace(',', '.').replace(/\s+/g, '')
      .match(/^(\d+(?:\.\d+)?)(kbps|mbps)?$/);
    el.value = m ? m[1] : '';
    // Sans unité dans la valeur, le menu retombe sur kbps (défaut).
    unitEl.value = m && m[2] ? m[2] : 'kbps';
  }

  async validateField(field, force = false) {
    const el = document.getElementById(`field-${field}`);
    const feedback = document.getElementById(`feedback-${field}`);
    if (!el || !feedback) return;

    // Vitesses : nombre et unité sont lus ensemble (champ + menu déroulant).
    if (field.includes('speed')) {
      const speed = this.readSpeedField(field);

      if (speed === '') {
        // Champ nombre vide : état neutre tant que l'utilisateur n'a rien
        // saisi — le « requis » n'apparaît qu'au lancement (`force`), pour ne
        // pas afficher deux champs en rouge dès l'ouverture du formulaire.
        el.classList.toggle('invalid', force);
        el.classList.remove('valid');
        feedback.className = force ? 'validation-feedback error' : 'validation-feedback';
        feedback.textContent = force ? 'Requis : ex 5 (kbps ou mbps)' : '';
        this.validationState[field] = false;
        return;
      }

      // Le moteur n'accepte que kbps et mbps (input.go : validSpeedSufixes).
      const valid = speed !== null;
      el.classList.toggle('valid', valid);
      el.classList.toggle('invalid', !valid);
      feedback.className = `validation-feedback ${valid ? 'success' : 'error'}`;
      feedback.textContent = valid ? 'OK' : 'Nombre invalide (ex: 5)';
      this.validationState[field] = valid;
      return;
    }

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
    } else {
      valid = /^\d+(\.\d+)?\s*(%|b|kb|mb|gb|tb)$/i.test(value);
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
    // `force` : un champ vide n'est signalé qu'ici, au lancement — jamais en
    // rouge dès l'ouverture du formulaire.
    for (const f of fields) await this.validateField(f, true);

    const dlSpeed = this.readSpeedField('dl-speed');
    const ulSpeed = this.readSpeedField('ul-speed');
    if (dlSpeed === '' || ulSpeed === '') {
      Toast.error('Renseignez les vitesses DL et UL (nombre + kbps/mbps)');
      return;
    }

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
      // Espace interne supprimé : « 5 mbps » passerait la validation mais le
      // moteur échouerait sur ParseFloat("5 ") (input.go n'enlève pas les
      // espaces, lui).
      downloaded: document.getElementById('field-dl').value.trim().toLowerCase().replace(',', '.').replace(/\s+/g, ''),
      // Normalisées par `readSpeedField` : déjà en minuscules, sans espace,
      // avec l'unité choisie dans le menu déroulant (« 5mbps »).
      dl_speed: dlSpeed,
      uploaded: document.getElementById('field-ul').value.trim().toLowerCase().replace(',', '.').replace(/\s+/g, ''),
      ul_speed: ulSpeed,
      port: parseInt(document.getElementById('field-port').value),
      client: clientValue,
      engine_path: enginePath,
    };

    this.onLaunch?.(config);
  }
}
