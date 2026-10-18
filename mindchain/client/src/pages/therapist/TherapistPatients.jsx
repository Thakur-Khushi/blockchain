import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState, PageHeader, WalletNotice } from '../../components/common.jsx';
import { Button, Card, EmptyState, Input, PageLoader } from '../../components/ui.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDate } from '../../services/format.js';

export default function TherapistPatients() {
  const [search, setSearch] = useState('');
  const { data, loading, error, reload } = useAsync(async () => (await api.get('/therapists/patients')).data, []);
  const items = (data?.items ?? []).filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div>
      <PageHeader
        title="My patients"
        description="Consent is read from the blockchain each time this list loads. Patients who revoke access disappear immediately."
        action={<Button variant="secondary" onClick={reload}>Refresh</Button>}
      />
      <WalletNotice purpose="receive patient consent" />
      <div className="mb-4 max-w-sm">
        <label htmlFor="psearch" className="sr-only">Search patients</label>
        <Input id="psearch" placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {loading ? (
        <PageLoader />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState title={search ? 'No matching patients' : 'No patients with active consent'} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <Card key={p.id}>
              <p className="font-medium text-slate-900">{p.name}</p>
              <p className="mt-1 text-xs text-slate-500">Access granted {formatDate(p.grantedAt)}</p>
              <p className="text-xs text-slate-500">{p.expiresAt ? `Expires ${formatDate(p.expiresAt)}` : 'No expiry set'}</p>
              <Link to={`/therapist/patients/${p.id}`} className="mt-4 block">
                <Button variant="secondary" className="w-full">View records</Button>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
