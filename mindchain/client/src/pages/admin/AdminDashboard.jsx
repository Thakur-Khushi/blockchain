import { Link } from 'react-router-dom';
import { ErrorState, PageHeader, StatCard } from '../../components/common.jsx';
import { Alert, Button, Card, CardHeader, EmptyState, PageLoader } from '../../components/ui.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDate } from '../../services/format.js';

export default function AdminDashboard() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [stats, pending, chain] = await Promise.all([
      api.get('/admin/stats'),
      api.get('/admin/therapists/pending', { params: { limit: 5 } }),
      api.get('/chain/status'),
    ]);
    return { stats: stats.data, pending: pending.data, chain: chain.data.chain };
  }, []);

  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const { stats, pending, chain } = data;

  return (
    <div>
      <PageHeader title="Administration" description="Verify therapists, manage accounts and review security events. Administrators cannot read patient journals." />
      {!chain.available && (
        <Alert type="error" title="Blockchain unavailable" className="mb-4">
          {chain.reason}. Consent checks fail closed, so therapists cannot open patient records until it is restored.
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Patients" value={stats.usersByRole.patient ?? 0} />
        <StatCard label="Therapists" value={stats.usersByRole.therapist ?? 0} accent="sky" />
        <StatCard label="Pending verification" value={stats.pendingTherapists} accent={stats.pendingTherapists ? 'amber' : 'brand'} />
        <StatCard label="Suspended accounts" value={stats.suspendedAccounts} accent={stats.suspendedAccounts ? 'rose' : 'brand'} />
      </div>
      <Card className="mt-6">
        <CardHeader title="Awaiting verification" action={<Link to="/admin/therapists" className="text-sm font-medium text-brand-700 hover:underline">Review all</Link>} />
        {pending.items.length === 0 ? (
          <EmptyState title="No therapists are waiting for review" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {pending.items.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{t.name}</p>
                  <p className="text-xs text-slate-500">{t.therapistProfile?.specialization} · submitted {formatDate(t.createdAt)}</p>
                </div>
                <Link to="/admin/therapists"><Button variant="secondary">Review</Button></Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
