import { useState } from 'react';
import AuditTable from '../../components/AuditTable.jsx';
import { ErrorState, PageHeader, Pagination } from '../../components/common.jsx';
import { Card, EmptyState, PageLoader, Select } from '../../components/ui.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { AUDIT_LABELS } from '../../services/format.js';

export default function AdminAudit() {
  const [filters, setFilters] = useState({ eventType: '', outcome: '' });
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useAsync(async () => {
    const params = { page, limit: 25 };
    if (filters.eventType) params.eventType = filters.eventType;
    if (filters.outcome) params.outcome = filters.outcome;
    return (await api.get('/admin/audit', { params })).data;
  }, [page, filters.eventType, filters.outcome]);

  const setFilter = (k) => (e) => {
    setPage(1);
    setFilters({ ...filters, [k]: e.target.value });
  };

  return (
    <div>
      <PageHeader title="Audit log" description="Security and access events. Entries hold identifiers and reason codes only — never record content." />
      <Card className="mb-4">
        <div className="flex flex-wrap gap-3">
          <div className="w-60">
            <label htmlFor="etype" className="mb-1 block text-xs font-medium text-slate-600">Event</label>
            <Select id="etype" value={filters.eventType} onChange={setFilter('eventType')}>
              <option value="">All events</option>
              {Object.entries(AUDIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>
          <div className="w-44">
            <label htmlFor="outcome" className="mb-1 block text-xs font-medium text-slate-600">Outcome</label>
            <Select id="outcome" value={filters.outcome} onChange={setFilter('outcome')}>
              <option value="">Any outcome</option>
              <option value="success">Success</option>
              <option value="denied">Denied</option>
              <option value="failure">Failure</option>
            </Select>
          </div>
        </div>
      </Card>
      {loading ? (
        <PageLoader />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No events match these filters" />
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
