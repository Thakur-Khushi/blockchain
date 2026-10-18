import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Palette validated with the dataviz validator (light surface): categorical slot 1
// (blue) = mood, slot 2 (orange) = stress. Both share the 1–10 scale, so they sit
// on one y-axis. Identity is never colour-only: legend + tooltip + table view.
export const SERIES = {
  mood: { key: 'mood', label: 'Mood', color: '#2a78d6' },
  stress: { key: 'stress', label: 'Stress', color: '#eb6834' },
  checkIns: { key: 'checkIns', label: 'Check-ins', color: '#2a78d6' },
};
const GRID = '#e2e8f0';
const AXIS_TEXT = { fill: '#64748b', fontSize: 12 };

const shortDate = (d) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
const monthLabel = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
};

function ChartTooltip({ active, payload, label, labelFormatter, unit = '/10' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200">
      <p className="mb-1 font-medium text-slate-900">{labelFormatter ? labelFormatter(label) : label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-slate-700">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden="true" />
          {p.name}: <span className="font-medium text-slate-900">{p.value == null ? 'no check-in' : `${p.value}${unit}`}</span>
        </p>
      ))}
    </div>
  );
}

function LegendRow({ series }) {
  return (
    <ul className="flex flex-wrap gap-4 text-xs text-slate-600">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} aria-hidden="true" />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

// Wraps a chart with a title, legend and an accessible table-view toggle.
export function ChartFrame({ title, description, series, table, children, height = 260 }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <figcaption className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
        </div>
        <button type="button" onClick={() => setShowTable((v) => !v)} className="text-xs font-medium text-brand-700 hover:underline" aria-pressed={showTable}>
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </figcaption>
      {series.length > 1 && !showTable && (
        <div className="mb-2">
          <LegendRow series={series} />
        </div>
      )}
      {showTable ? (
        <div className="max-h-72 overflow-auto">{table}</div>
      ) : (
        <div style={{ height }} role="img" aria-label={`${title} chart. Use “Show table” for the values.`}>
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}

function DataTable({ columns, rows }) {
  return (
    <table className="min-w-full text-xs">
      <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
        <tr>{columns.map((c) => <th key={c.key} scope="col" className="px-3 py-2 font-medium">{c.label}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r, i) => (
          <tr key={i}>{columns.map((c) => <td key={c.key} className="px-3 py-1.5 text-slate-700">{c.format ? c.format(r[c.key]) : r[c.key] ?? '—'}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

const dot = (color) => ({ r: 4, fill: color, stroke: '#ffffff', strokeWidth: 2 });

export function DailyTrendChart({ daily, height }) {
  const series = [SERIES.mood, SERIES.stress];
  const dense = daily.length > 45;
  return (
    <ChartFrame
      title="Daily mood and stress"
      description="Self-rated, 1–10. Gaps are days without a check-in."
      series={series}
      height={height}
      table={<DataTable columns={[{ key: 'date', label: 'Date', format: shortDate }, { key: 'mood', label: 'Mood' }, { key: 'stress', label: 'Stress' }]} rows={daily} />}
    >
      <LineChart data={daily} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TEXT} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
        <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={AXIS_TEXT} tickLine={false} axisLine={false} />
        <Tooltip content={<ChartTooltip labelFormatter={shortDate} />} cursor={{ stroke: '#94a3b8', strokeWidth: 1 }} />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={dense ? false : dot(s.color)}
            activeDot={{ r: 5, fill: s.color, stroke: '#ffffff', strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartFrame>
  );
}

function AverageBars({ data, xKey, xFormat, title, description, height }) {
  const series = [SERIES.mood, SERIES.stress];
  const rows = data.map((d) => ({ ...d, mood: d.avgMood, stress: d.avgStress }));
  return (
    <ChartFrame
      title={title}
      description={description}
      series={series}
      height={height}
      table={
        <DataTable
          columns={[
            { key: xKey, label: xKey === 'month' ? 'Month' : 'Week of', format: xFormat },
            { key: 'mood', label: 'Avg mood' },
            { key: 'stress', label: 'Avg stress' },
            { key: 'checkIns', label: 'Check-ins' },
            { key: 'days', label: 'Days' },
          ]}
          rows={rows}
        />
      }
    >
      <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -16 }} barGap={2} barCategoryGap="30%">
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tickFormatter={xFormat} tick={AXIS_TEXT} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={AXIS_TEXT} tickLine={false} axisLine={false} />
        <Tooltip content={<ChartTooltip labelFormatter={xFormat} />} cursor={{ fill: '#f1f5f9' }} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        ))}
      </BarChart>
    </ChartFrame>
  );
}

export function WeeklyAveragesChart({ weekly, height }) {
  return <AverageBars data={weekly} xKey="weekStart" xFormat={(d) => shortDate(d)} title="Weekly averages" description="Average of the days you checked in, per week (Mon–Sun)." height={height} />;
}

export function MonthlyAveragesChart({ monthly, height }) {
  return <AverageBars data={monthly} xKey="month" xFormat={monthLabel} title="Monthly averages" description="Average of the days you checked in, per month." height={height} />;
}

export function CompletionChart({ weekly, height = 200 }) {
  const rows = weekly.map((w) => ({ ...w, label: w.weekStart }));
  return (
    <ChartFrame
      title="Check-ins per week"
      description="Number of days with a check-in in each week of the range."
      series={[SERIES.checkIns]}
      height={height}
      table={<DataTable columns={[{ key: 'weekStart', label: 'Week of', format: shortDate }, { key: 'checkIns', label: 'Check-ins' }, { key: 'days', label: 'Days in range' }]} rows={rows} />}
    >
      <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -16 }} barCategoryGap="30%">
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="weekStart" tickFormatter={shortDate} tick={AXIS_TEXT} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis domain={[0, 7]} ticks={[0, 1, 2, 3, 4, 5, 6, 7]} allowDecimals={false} tick={AXIS_TEXT} tickLine={false} axisLine={false} />
        <Tooltip content={<ChartTooltip labelFormatter={shortDate} unit=" days" />} cursor={{ fill: '#f1f5f9' }} />
        <Bar dataKey="checkIns" name="Check-ins" fill={SERIES.checkIns.color} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartFrame>
  );
}

