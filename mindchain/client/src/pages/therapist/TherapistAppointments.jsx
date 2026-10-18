import { useState } from 'react';
import AppointmentCard from '../../components/AppointmentCard.jsx';
import { ErrorState, PageHeader, Pagination } from '../../components/common.jsx';
import { ConfirmDialog } from '../../components/Modal.jsx';
import { Alert, EmptyState, PageLoader } from '../../components/ui.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api, apiErrorMessage } from '../../services/api.js';

const TABS = [
  { id: 'requests', label: 'Requests', params: { scope: 'upcoming', status: 'requested' } },
  { id: 'upcoming', label: 'Confirmed', params: { scope: 'upcoming', status: 'confirmed' } },
  { id: 'past', label: 'Past', params: { scope: 'past' } },
];

const LABELS = { confirm: 'Confirm', decline: 'Decline', cancel: 'Cancel', complete: 'Mark completed' };
const MESSAGES = { confirm: 'Appointment confirmed.', decline: 'Request declined.', cancel: 'Appointment cancelled.', complete: 'Appointment marked as completed.' };

function actionsFor(a) {
  const started = new Date(a.scheduledAt) <= new Date();
  if (a.status === 'requested') return started ? [{ action: 'decline', label: 'Decline' }] : [{ action: 'confirm', label: 'Confirm', variant: 'primary' }, { action: 'decline', label: 'Decline' }];
  if (a.status === 'confirmed') return started ? [{ action: 'complete', label: 'Mark completed', variant: 'primary' }] : [{ action: 'cancel', label: 'Cancel' }];
  return [];
}

export default function TherapistAppointments() {
  const [tab, setTab] = useState('requests');
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState(null); // { appt, action }
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const current = TABS.find((t) => t.id === tab);
  const list = useAsync(async () => (await api.get('/appointments', { params: { ...current.params, page, limit: 10 } })).data, [tab, page]);

  const run = async () => {
    const { appt, action } = pending;
    setBusy(true);
    try {
      await api.patch(`/appointments/${appt.id}`, { action });
      setMessage({ type: 'success', text: MESSAGES[action] });
      list.reload();
    } catch (err) {
      setMessage({ type: 'error', text: apiErrorMessage(err) });
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <div>
      <PageHeader title="Appointments" description="Confirm or decline requests and manage your schedule." />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); setPage(1); }}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === t.id ? 'bg-brand-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {message && <Alert type={message.type} className="mb-4">{message.text}</Alert>}
      {list.loading ? (
        <PageLoader />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title={tab === 'requests' ? 'No pending requests' : tab === 'upcoming' ? 'No confirmed upcoming appointments' : 'No past appointments'} />
      ) : (
        <div className="space-y-3">
          {list.data.items.map((a) => (
            <AppointmentCard key={a.id} appointment={a} viewer="therapist" actions={actionsFor(a)} onAction={(appt, action) => setPending({ appt, action })} busy={busy} />
          ))}
          <Pagination page={list.data.page} totalPages={list.data.totalPages} onChange={setPage} />
        </div>
      )}
      <ConfirmDialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        onConfirm={run}
        loading={busy}
        danger={pending?.action === 'decline' || pending?.action === 'cancel'}
        title={pending ? `${LABELS[pending.action]} appointment with ${pending.appt.patient.name}?` : ''}
        confirmLabel={pending ? LABELS[pending.action] : 'Confirm'}
      >
        {pending && new Date(pending.appt.scheduledAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}
      </ConfirmDialog>
    </div>
  );
}
