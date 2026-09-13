// RSM Worker — parsing & diffing offloadé du main thread

function sessionHash(s) {
  return `${s.status}|${(s.total_uploaded_mb ?? 0).toFixed(2)}|${(s.current_upload_speed ?? 0).toFixed(2)}|${(s.ratio ?? 0).toFixed(2)}|${(s.progress_percent ?? 0).toFixed(2)}|${(s.logs?.length ?? 0)}|${s.elapsed_seconds ?? 0}`;
}

self.onmessage = function(e) {
  const { type, payload, id } = e.data;

  if (type === 'diff') {
    const { newSessions, oldHashes, searchQuery } = payload;
    const result = {
      toAdd: [],
      toUpdate: [],
      toRemove: [],
      newHashes: {},
      filtered: [],
    };

    const currentIds = new Set();

    for (const s of newSessions) {
      currentIds.add(s.id);
      const hash = sessionHash(s);
      result.newHashes[s.id] = hash;

      if (searchQuery) {
        const name = (s.config?.torrent_path || '').toLowerCase().split('/').pop() || '';
        if (!name.includes(searchQuery)) continue;
      }
      result.filtered.push(s);

      if (!oldHashes[s.id]) {
        result.toAdd.push(s);
      } else if (oldHashes[s.id] !== hash) {
        result.toUpdate.push(s);
      }
    }

    for (const id of Object.keys(oldHashes)) {
      if (!currentIds.has(id)) {
        result.toRemove.push(id);
      }
    }

    self.postMessage({ type: 'diffResult', id, result });
  }

  if (type === 'stats') {
    const sessions = payload;
    const active = sessions.filter(s => s.status === 'running').length;
    const totalUploadMb = sessions.reduce((sum, s) => sum + (s.total_uploaded_mb || 0), 0);
    const totalDownloadMb = sessions.reduce((sum, s) => sum + (s.total_downloaded_mb || 0), 0);
    const ratios = sessions.map(s => s.ratio).filter(r => r > 0);
    const avgRatio = ratios.length > 0 ? (ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(1) : '0.0';

    self.postMessage({ type: 'statsResult', id, result: { active, totalUploadMb, totalDownloadMb, avgRatio } });
  }

  if (type === 'persist') {
    // Le worker ne peut pas accéder à localStorage, mais il peut préparer les données
    const sessions = payload.sessions;
    const stripped = sessions.map(s => ({
      id: s.id,
      config: s.config,
      status: s.status,
      created_at: s.created_at,
      total_uploaded_mb: s.total_uploaded_mb,
      total_downloaded_mb: s.total_downloaded_mb,
      current_upload_speed: s.current_upload_speed,
      ratio: s.ratio,
      progress_percent: s.progress_percent,
      elapsed_seconds: s.elapsed_seconds,
    }));
    self.postMessage({ type: 'persistReady', id, result: stripped });
  }
};
