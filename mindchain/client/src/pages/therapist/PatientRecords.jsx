import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorState, PageHeader, Pagination } from '../../components/common.jsx';
import { Alert, Badge, Button, Card, EmptyState, Input, PageLoader } from '../../components/ui.jsx';
import { ScorePill } from '../../components/wellness.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDate, formatEntryDate } from '../../services/format.js';

export default function PatientRecords() {
  const { patientId } = useParams();
  const [filters, setFilters] = useState({ from: '', to: '' });
  const [page, setPage] = useState(1);

  // Every load triggers a fresh on-chain consent check on the server.
  const summary = useAsync(async () => (await api.get(`/therapists/patients/${patientId}`)).data, [patientId]);
  const records = useAsync(async () => {
    const params = { page, limit: 10 };
    if (filters.from) params.from = filters.from;
    if (filters.to) params.to = filters.to;
    return (await api.get(`/therapists/patients/${patientId}/records`, { params })).data;
  }, [patientId, page, filters.from, filters.to]);

  const denied = summary.status === 403 || records.status === 403;
  const chainDown = summary.status === 503 || records.status === 503;

  if (denied || chainDown) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <Alert type={chainDown ? 'error' : 'warning'} title={chainDown ? 'Consent cannot be verified right now' : 'Access not available'}>
          {chainDown
            ? 'The blockchain is unreachable, so MindChain cannot confirm this patient’s consent. Access is denied until it can be verified.'
            : 'This patient has not granted you access, or has revoked or let it expire.'}
        </Alert>
        <Link to="/therapist/patients" className="mt-4 inline-block">
          <Button variant="secondary">Back to my patients</Button>
        </Link>
      </div>
    );
  }
  if (summary.loading) return <PageLoader />;
  if (summary.error) return <ErrorState message={summary.error} onRetry={summary.reload} />;

  const { patient, grant } = summary.data;
  return (
    <div>
      <PageHeader
        title={patient.name}
        description={`Read-only view under patient consent · granted ${formatDate(grant.grantedAt)}${grant.expiresAt ? ` · expires ${formatDate(grant.expiresAt)}` : ''}`}
        action={<Link to="/therapist/patients"><Button variant="secondary">Back</Button></Link>}
      />
      <Alert type="info" className="mb-4">
        Self-reported check-ins. Your access is logged and visible to the patient. Scores are descriptive and are not diagnostic measures.
      </Alert>

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="from" className="mb-1 block text-xs font-medium text-slate-600">From</label>
            <Input id="from" type="date" value={filters.from} onChange={(e) => { setPage(1); setFilters({ ...filters, from: e.target.value }); }} />
          </div>
          <div>
            <label htmlFor="to" className="mb-1 block text-xs font-medium text-slate-600">To</label>
            <Input id="to" type="date" value={filters.to} onChange={(e) => { setPage(1); setFilters({ ...filters, to: e.target.value }); }} />
          </div>
          {(filters.from || filters.to) && <Button variant="ghost" onClick={() => setFilters({ from: '', to: '' })}>Clear</Button>}
        </div>
      </Card>

      {records.loading ? (
        <PageLoader />
      ) : records.error ? (
        <ErrorState message={records.error} onRetry={records.reload} />
      ) : records.data.items.length === 0 ? (
        <EmptyState title="No check-ins in this period" />
      ) : (
        <div className="space-y-3">
          {records.data.items.map((r) => (
            <Card key={r.recordId} className="!p-4 sm:!p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-900">{formatEntryDate(r.entryDate)}</p>
                <div className="flex flex-wrap gap-2">
                  {r.integrity.status === 'ok' ? (
                    <>
                      <ScorePill kind="mood" value={r.mood} />
                      <ScorePill kind="stress" value={r.stress} />
                    </>
                  ) : (
                    <Badge color="red">Integrity check failed</Badge>
                  )}
                  <Badge color={r.chainStatus === 'anchored' ? 'green' : 'yellow'}>{r.chainStatus === 'anchored' ? 'Anchored' : 'Not anchored'}</Badge>
                </div>
              </div>
              {r.integrity.status === 'ok' && r.journal && <p className="mt-3 text-sm whitespace-pre-wrap text-slate-700">{r.journal}</p>}
              {r.integrity.status === 'ok' && r.tags?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">{r.tags.map((t) => <Badge key={t} color="teal">#{t}</Badge>)}</div>
              )}
            </Card>
          ))}
          <Pagination page={records.data.page} totalPages={records.data.totalPages} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
