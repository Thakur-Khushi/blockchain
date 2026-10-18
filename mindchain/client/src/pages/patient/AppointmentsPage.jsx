import { useState } from 'react';
import AppointmentCard from '../../components/AppointmentCard.jsx';
import { ErrorState, PageHeader, Pagination } from '../../components/common.jsx';
import Modal, { ConfirmDialog } from '../../components/Modal.jsx';
import { Alert, Button, EmptyState, Field, Input, PageLoader, Select, Textarea } from '../../components/ui.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api, apiErrorMessage } from '../../services/api.js';
import { addDays, localDate } from '../../services/format.js';

const TIMES = Array.from({ length: 48 }, (_, i) => {
  const h = 8 + Math.floor(i / 4);
  const m = (i % 4) * 15;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}).filter((t) => t <= '19:45');

const TABS = [
  ['upcoming', 'Upcoming'],
  ['past', 'Past'],
];

export default function AppointmentsPage() {
  const [scope, setScope] = useState('upcoming');
  const [page, setPage] = useState(1);
  const [booking, setBooking] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const list = useAsync(async () => (await api.get('/appointments', { params: { scope, page, limit: 10 } })).data, [scope, page]);

  const cancel = async () => {
    setBusy(true);
    try {
      await api.patch(`/appointments/${cancelling.id}`, { action: 'cancel' });
      setMessage({ type: 'success', text: 'Appointment cancelled.' });
      setCancelling(null);
      list.reload();
    } catch (err) {
      setMessage({ type: 'error', text: apiErrorMessage(err) });
      setCancelling(null);
    } finally {
      setBusy(false);
    }
  };

  const actionsFor = (a) =>
    ['requested', 'confirmed'].includes(a.status) && new Date(a.scheduledAt) > new Date()
      ? [{ action: 'cancel', label: 'Cancel', variant: 'secondary' }]
      : [];

  return (
    <div>
      <PageHeader title="Appointments" description="Request sessions with verified therapists. Your therapist confirms or declines each request." action={<Button onClick={() => setBooking(true)}>Request appointment</Button>} />
      <div className="mb-4 flex gap-2" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={scope === id} onClick={() => { setScope(id); setPage(1); }}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${scope === id ? 'bg-brand-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
            {label}
          </button>
        ))}
      </div>
      {message && <Alert type={message.type} className="mb-4">{message.text}</Alert>}
      {list.loading ? (
        <PageLoader />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title={scope === 'upcoming' ? 'No upcoming appointments' : 'No past appointments'}
          action={scope === 'upcoming' && <Button onClick={() => setBooking(true)}>Request appointment</Button>}
        />
      ) : (
        <div className="space-y-3">
          {list.data.items.map((a) => (
            <AppointmentCard key={a.id} appointment={a} viewer="patient" actions={actionsFor(a)} onAction={(appt) => setCancelling(appt)} busy={busy} />
          ))}
          <Pagination page={list.data.page} totalPages={list.data.totalPages} onChange={setPage} />
        </div>
      )}

      <BookingDialog
        open={booking}
        onClose={() => setBooking(false)}
        onBooked={() => {
          setBooking(false);
          setMessage({ type: 'success', text: 'Appointment requested. You will see it here once the therapist responds.' });
          setScope('upcoming');
          list.reload();
        }}
      />
      <ConfirmDialog open={Boolean(cancelling)} onClose={() => setCancelling(null)} onConfirm={cancel} loading={busy} danger title="Cancel this appointment?" confirmLabel="Cancel appointment">
        Your therapist will see that you cancelled.
      </ConfirmDialog>
    </div>
  );
}

function BookingDialog({ open, onClose, onBooked }) {
  const tomorrow = addDays(localDate(), 1);
  const [form, setForm] = useState({ therapistId: '', date: tomorrow, time: '10:00', durationMinutes: '45', mode: 'online', note: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const therapists = useAsync(async () => (open ? (await api.get('/therapists', { params: { limit: 100 } })).data.items : []), [open]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async () => {
    const v = {};
    if (!form.therapistId) v.therapistId = 'Choose a therapist';
    const start = new Date(`${form.date}T${form.time}`); // local time
    if (Number.isNaN(start.getTime())) v.date = 'Choose a valid date and time';
    else if (start.getTime() < Date.now() + 3600000) v.date = 'Choose a time at least one hour from now';
    else if (start.getTime() > Date.now() + 180 * 86400000) v.date = 'Appointments can be booked up to 180 days ahead';
    setErrors(v);
    if (Object.keys(v).length) return;

    setSaving(true);
    setError('');
    try {
      await api.post('/appointments', {
        therapistId: form.therapistId,
        scheduledAt: start.toISOString(),
        durationMinutes: Number(form.durationMinutes),
        mode: form.mode,
        note: form.note.trim() || undefined,
      });
      setForm({ ...form, note: '' });
      onBooked();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title="Request an appointment"
      description="Times are shown in your local time zone."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} loading={saving}>Send request</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert type="error">{error}</Alert>}
        <Field label="Therapist" htmlFor="therapist" error={errors.therapistId}>
          {therapists.loading ? (
            <PageLoader />
          ) : therapists.error ? (
            <Alert type="error">{therapists.error}</Alert>
          ) : therapists.data.length === 0 ? (
            <p className="text-sm text-slate-500">No verified therapists are available yet.</p>
          ) : (
            <Select id="therapist" value={form.therapistId} onChange={set('therapistId')}>
              <option value="">Select a therapist…</option>
              {therapists.data.map((t) => (
                <option key={t.id} value={t.id}>{t.name} — {t.specialization}</option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" htmlFor="adate" error={errors.date}>
            <Input id="adate" type="date" min={localDate()} max={addDays(localDate(), 180)} value={form.date} onChange={set('date')} />
          </Field>
          <Field label="Start time" htmlFor="atime">
            <Select id="atime" value={form.time} onChange={set('time')}>
              {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Duration" htmlFor="adur">
            <Select id="adur" value={form.durationMinutes} onChange={set('durationMinutes')}>
              {[30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} minutes</option>)}
            </Select>
          </Field>
          <Field label="Session type" htmlFor="amode">
            <Select id="amode" value={form.mode} onChange={set('mode')}>
              <option value="online">Online</option>
              <option value="in_person">In person</option>
            </Select>
          </Field>
        </div>
        <Field label="Note for the therapist (optional)" htmlFor="anote" hint="Encrypted. Visible only to you and this therapist.">
          <Textarea id="anote" rows={3} maxLength={500} value={form.note} onChange={set('note')} />
        </Field>
      </div>
    </Modal>
  );
}
