import { useState } from 'react';
import AuditTable from '../../components/AuditTable.jsx';
import { ErrorState, PageHeader, Pagination } from '../../components/common.jsx';
import { Card, EmptyState, PageLoader } from '../../components/ui.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';

const TABS = [
  { id: 'all', label: 'All activity', params: {} },
  { id: 'access', label: 'Therapist access', params: { eventType: 'record_access' } },
  { id: 'denied', label: 'Denied attempts', params: { eventType: 'access_denied' } },
  { id: 'tx', label: 'Blockchain transactions', params: { withTx: 'true' } },
];

export default function ActivityPage() {
  const [tab, setTab] = useState('all');
  const [page, setPage] = useState(1);
  const current = TABS.find((t) => t.id === tab);
  const { data, loading, error, reload } = useAsync(
    async () => (await api.get('/audit/me', { params: { page, limit: 20, ...current.params } })).data,
    [tab, page],
  );

  return (
    <div>
      <PageHeader title="Activity & transactions" description="Who accessed your records, consent changes, and your confirmed blockchain transactions." />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => { setTab(t.id); setPage(1); }}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === t.id ? 'bg-brand-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {loading ? (
        <PageLoader />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <EmptyState title="Nothing to show yet" description="Events will appear here as you and your therapists use MindChain." />
      ) : (
        <Card className="overflow-hidden !p-0">
          <AuditTable items={data.items} />
          <div className="px-4 pb-4">
            <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
          </div>
        </Card>
      )}
    </div>
  );
}
