import { useState } from 'react';
import { api, apiErrorMessage } from '../services/api.js';
import { Button } from './ui.jsx';

// Downloads the patient's own decrypted history from the API (auth header included).
export default function ExportMenu({ from, to, onError }) {
  const [busy, setBusy] = useState(null);

  const download = async (format) => {
    setBusy(format);
    try {
      const params = { format };
      if (from) params.from = from;
      if (to) params.to = to;
      const res = await api.get('/wellness/export', { params, responseType: 'blob' });
      const name = /filename="([^"]+)"/.exec(res.headers['content-disposition'] ?? '')?.[1] ?? `mindchain-export.${format}`;
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      onError?.(apiErrorMessage(err, 'Export failed.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex gap-2">
      <Button variant="secondary" onClick={() => download('csv')} loading={busy === 'csv'} disabled={Boolean(busy)}>
        Export CSV
      </Button>
      <Button variant="secondary" onClick={() => download('json')} loading={busy === 'json'} disabled={Boolean(busy)}>
        Export JSON
      </Button>
    </div>
  );
}
