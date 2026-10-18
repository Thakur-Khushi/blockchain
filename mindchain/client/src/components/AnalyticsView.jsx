import { useState } from 'react';
import { CompletionChart, DailyTrendChart, MonthlyAveragesChart, WeeklyAveragesChart } from './charts.jsx';
import { ErrorState, StatCard } from './common.jsx';
import { Alert, Badge, Button, Card, CardHeader, Input, PageLoader } from './ui.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { api } from '../services/api.js';
import { addDays, localDate } from '../services/format.js';

const PRESETS = [
  { id: '7', label: '7 days', days: 7 },
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
  { id: '365', label: '12 months', days: 365 },
];

const TREND_TEXT = {
  improving: ['green', 'Improving'],
  worsening: ['yellow', 'Worsening'],
  stable: ['gray', 'Stable'],
  insufficient_data: ['gray', 'Not enough data'],
};

// Analytics for one patient. `endpoint` is the patient's own or a therapist's
// consent-gated endpoint; both compute the numbers on the server.
export default function AnalyticsView({ endpoint, audience = 'patient' }) {
  const today = localDate();
  const [preset, setPreset] = useState('30');
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const range =
    preset === 'custom' ? custom : { from: addDays(today, -(PRESETS.find((p) => p.id === preset).days - 1)), to: today };
  const invalid = preset === 'custom' && (!custom.from || !custom.to || custom.from > custom.to);

  const { data, loading, error, reload } = useAsync(async () => {
    if (invalid) return null;
    return (await api.get(endpoint, { params: range })).data.analytics;
  }, [endpoint, range.from, range.to, invalid]);

  const you = audience === 'patient';
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Date range">
        {PRESETS.map((p) => (
          <Button key={p.id} variant={preset === p.id ? 'primary' : 'secondary'} onClick={() => setPreset(p.id)} className="!px-3 !py-1.5">
            {p.label}
          </Button>
        ))}
        <Button variant={preset === 'custom' ? 'primary' : 'secondary'} onClick={() => setPreset('custom')} className="!px-3 !py-1.5">
          Custom
        </Button>
        {preset === 'custom' && (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="afrom" className="mb-1 block text-xs text-slate-600">From</label>
              <Input id="afrom" type="date" max={today} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            </div>
            <div>
              <label htmlFor="ato" className="mb-1 block text-xs text-slate-600">To</label>
              <Input id="ato" type="date" max={today} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </div>
          </div>
        )}
      </div>
      {invalid && <Alert type="error">Choose a valid range: “From” must be on or before “To”.</Alert>}

      {loading ? (
        <PageLoader label="Calculating analytics…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? null : (
        <>
          {data.excludedRecords > 0 && (
            <Alert type="warning">
              {data.excludedRecords} record{data.excludedRecords > 1 ? 's were' : ' was'} excluded because {data.excludedRecords > 1 ? 'they' : 'it'} failed an integrity check.
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Average mood" value={data.summary.avgMood ?? '—'} hint={data.summary.minMood != null ? `Range ${data.summary.minMood}–${data.summary.maxMood} · 1–10, higher is better` : 'No check-ins in range'} />
            <StatCard label="Average stress" value={data.summary.avgStress ?? '—'} accent="sky" hint={data.summary.minStress != null ? `Range ${data.summary.minStress}–${data.summary.maxStress} · 1–10, lower is calmer` : 'No check-ins in range'} />
            <StatCard label="Check-in completion" value={`${Math.round(data.completion.rate * 100)}%`} accent={data.completion.rate >= 0.5 ? 'brand' : 'amber'} hint={`${data.completion.checkIns} of ${data.completion.days} days`} />
            <StatCard label="Current streak" value={`${data.completion.currentStreak} d`} accent="sky" hint={`Longest in range: ${data.completion.longestStreak} days`} />
          </div>

          <Card>
            <CardHeader
              title="Summary"
              description={`Descriptive summary of ${you ? 'your' : 'the patient’s'} self-reported check-ins. Not a clinical assessment.`}
              action={
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="flex items-center gap-1">Mood <Badge color={TREND_TEXT[data.summary.moodTrend.direction][0]}>{TREND_TEXT[data.summary.moodTrend.direction][1]}</Badge></span>
                  <span className="flex items-center gap-1">Stress <Badge color={TREND_TEXT[data.summary.stressTrend.direction][0]}>{TREND_TEXT[data.summary.stressTrend.direction][1]}</Badge></span>
                </div>
              }
            />
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              {data.insights.map((s) => <li key={s}>{s}</li>)}
            </ul>
            {data.summary.topTags.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                Frequent tags:
                {data.summary.topTags.map((t) => <Badge key={t.tag} color="teal">#{t.tag} · {t.count}</Badge>)}
              </div>
            )}
          </Card>

          {data.completion.checkIns === 0 ? null : (
            <>
              <DailyTrendChart daily={data.daily} />
              <div className="grid gap-6 lg:grid-cols-2">
                <WeeklyAveragesChart weekly={data.weekly} />
                <CompletionChart weekly={data.weekly} />
              </div>
              {data.monthly.length > 1 && <MonthlyAveragesChart monthly={data.monthly} />}
            </>
          )}
        </>
      )}
    </div>
  );
}
