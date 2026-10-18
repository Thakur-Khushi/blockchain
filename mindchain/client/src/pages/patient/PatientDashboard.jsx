import { Link } from 'react-router-dom';
import { DailyTrendChart } from '../../components/charts.jsx';
import { ChainStatusBadge, ErrorState, PageHeader, StatCard, WalletNotice } from '../../components/common.jsx';
import { Alert, Button, Card, CardHeader, EmptyState, PageLoader } from '../../components/ui.jsx';
import { ScorePill } from '../../components/wellness.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { addDays, average, formatEntryDate, localDate } from '../../services/format.js';

export default function PatientDashboard() {
  const { user } = useAuth();
  const today = localDate();
  const { data, loading, error, reload } = useAsync(async () => {
    const { data: res } = await api.get('/wellness', { params: { from: addDays(today, -29), to: today, limit: 100 } });
    return res.items;
  }, [today]);
  const trend = useAsync(async () => (await api.get('/wellness/analytics', { params: { from: addDays(today, -13), to: today } })).data.analytics, [today]);

  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const items = data ?? [];
  const todays = items.find((r) => r.entryDate === today);
  const last7 = items.filter((r) => r.entryDate >= addDays(today, -6));
  const readable = (list) => list.filter((r) => r.integrity.status === 'ok');
  const avgMood = average(readable(last7).map((r) => r.mood));
  const avgStress = average(readable(last7).map((r) => r.stress));
  const unanchored = items.filter((r) => r.chainStatus !== 'anchored').length;
  const tampered = items.filter((r) => r.integrity.status === 'tampered').length;

  return (
    <div>
      <PageHeader
        title={`Hello, ${user.name.split(' ')[0]}`}
        description="A snapshot of your last 30 days. Scores are your own descriptive ratings, not a diagnosis."
        action={
          <Link to="/patient/check-in">
            <Button>{todays ? "Edit today's check-in" : 'Check in for today'}</Button>
          </Link>
        }
      />
      <WalletNotice purpose="anchor your records and manage therapist access" />
      {tampered > 0 && (
        <Alert type="error" title="Integrity warning" className="mb-4">
          {tampered} record{tampered > 1 ? 's' : ''} failed an integrity check.{' '}
          <Link to="/patient/integrity" className="font-medium underline">Review on the integrity page</Link>.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Today's check-in" value={todays ? 'Done' : 'Pending'} accent={todays ? 'brand' : 'amber'} hint={todays ? `Mood ${todays.mood ?? '—'}, stress ${todays.stress ?? '—'}` : 'Take a minute to check in'} />
        <StatCard label="Average mood (7 days)" value={avgMood ?? '—'} hint="Scale 1–10, higher is better" />
        <StatCard label="Average stress (7 days)" value={avgStress ?? '—'} accent="sky" hint="Scale 1–10, lower is calmer" />
        <StatCard label="Check-ins (30 days)" value={`${items.length}/30`} accent="sky" hint={unanchored ? `${unanchored} not yet anchored on-chain` : 'All anchored on-chain'} />
      </div>

      {trend.data && trend.data.completion.checkIns > 0 && (
        <div className="mt-6">
          <DailyTrendChart daily={trend.data.daily} height={220} />
          <p className="mt-2 text-right text-xs">
            <Link to="/patient/analytics" className="font-medium text-brand-700 hover:underline">Open full analytics</Link>
          </p>
        </div>
      )}

      <Card className="mt-6">
        <CardHeader
          title="Recent check-ins"
          action={
            <Link to="/patient/journal" className="text-sm font-medium text-brand-700 hover:underline">
              View all
            </Link>
          }
        />
        {items.length === 0 ? (
          <EmptyState
            title="No check-ins yet"
            description="Your first daily check-in takes less than a minute."
            action={<Link to="/patient/check-in"><Button>Start your first check-in</Button></Link>}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.slice(0, 6).map((r) => (
              <li key={r.recordId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{formatEntryDate(r.entryDate)}</p>
                  <p className="mt-0.5 truncate text-sm text-slate-500">
                    {r.integrity.status !== 'ok' ? 'Content withheld — integrity check failed' : r.journal || 'No journal entry'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {r.integrity.status === 'ok' && <ScorePill kind="mood" value={r.mood} />}
                  {r.integrity.status === 'ok' && <ScorePill kind="stress" value={r.stress} />}
                  <ChainStatusBadge status={r.chainStatus} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
