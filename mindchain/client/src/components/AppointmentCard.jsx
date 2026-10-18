import { Badge, Button } from './ui.jsx';

const STATUS = {
  requested: ['yellow', 'Requested'],
  confirmed: ['green', 'Confirmed'],
  declined: ['gray', 'Declined'],
  cancelled: ['gray', 'Cancelled'],
  completed: ['blue', 'Completed'],
};

export function AppointmentStatus({ status }) {
  const [color, label] = STATUS[status] ?? ['gray', status];
  return <Badge color={color}>{label}</Badge>;
}

// `actions`: [{ action, label, variant }] permitted for the viewer in this state.
export default function AppointmentCard({ appointment: a, viewer, actions = [], onAction, busy }) {
  const start = new Date(a.scheduledAt);
  const counterpart = viewer === 'patient' ? a.therapist : a.patient;
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
      <div className="flex gap-4">
        <div className="flex w-14 shrink-0 flex-col items-center rounded-xl bg-brand-50 py-2 text-brand-800">
          <span className="text-xs font-medium uppercase">{start.toLocaleDateString(undefined, { month: 'short' })}</span>
          <span className="text-xl leading-none font-semibold">{start.getDate()}</span>
        </div>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
            {counterpart.name ?? 'Unknown'}
            <AppointmentStatus status={a.status} />
          </p>
          {viewer === 'patient' && a.therapist.specialization && <p className="text-xs text-slate-500">{a.therapist.specialization}</p>}
          <p className="mt-1 text-sm text-slate-600">
            {start.toLocaleDateString(undefined, { weekday: 'long' })},{' '}
            {start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · {a.durationMinutes} min ·{' '}
            {a.mode === 'online' ? 'Online' : 'In person'}
          </p>
          {a.note && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">“{a.note}”</p>}
          {a.noteIntegrity === 'tampered' && <p className="mt-2 text-xs text-rose-700">The note failed its integrity check and is hidden.</p>}
        </div>
      </div>
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((x) => (
            <Button key={x.action} variant={x.variant ?? 'secondary'} onClick={() => onAction(a, x.action)} disabled={busy}>
              {x.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
