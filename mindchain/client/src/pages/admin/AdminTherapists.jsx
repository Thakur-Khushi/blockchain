import { useState } from 'react';
import { ErrorState, PageHeader, Pagination } from '../../components/common.jsx';
import Modal from '../../components/Modal.jsx';
import { Alert, Badge, Button, Card, EmptyState, Field, PageLoader, Textarea } from '../../components/ui.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api, apiErrorMessage } from '../../services/api.js';
import { formatDate } from '../../services/format.js';

const TABS = [
  ['pending', 'Pending'],
  ['verified', 'Verified'],
  ['rejected', 'Rejected'],
];

export default function AdminTherapists() {
  const [tab, setTab] = useState('pending');
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState(null); // { therapist, status }
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const { data, loading, error, reload } = useAsync(
    async () =>
      (await api.get('/admin/users', { params: { role: 'therapist', verificationStatus: tab, page, limit: 10 } })).data,
    [tab, page],
  );

  const submit = async () => {
    setSaving(true);
    try {
      await api.patch(`/admin/therapists/${decision.therapist.id}/verification`, { status: decision.status, note: note || undefined });
      setMessage({ type: 'success', text: `${decision.therapist.name} ${decision.status === 'verified' ? 'verified' : 'rejected'}.` });
      setDecision(null);
      setNote('');
      reload();
    } catch (err) {
      setMessage({ type: 'error', text: apiErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Therapist verification" description="Check each licence with the issuing body before approving. A wallet address does not prove professional identity." />
      <div className="mb-4 flex gap-2" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setPage(1); }}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === id ? 'bg-brand-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
            {label}
          </button>
        ))}
      </div>
      {message && <Alert type={message.type} className="mb-4">{message.text}</Alert>}
      {loading ? (
        <PageLoader />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <EmptyState title={`No ${tab} therapists`} />
      ) : (
        <div className="space-y-3">
          {data.items.map((t) => (
            <Card key={t.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                    {t.name}
                    {t.accountStatus === 'suspended' && <Badge color="red">Suspended</Badge>}
                  </p>
                  <p className="text-sm text-slate-500">{t.email}</p>
                  <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    <div><dt className="inline text-slate-500">License: </dt><dd className="inline font-medium">{t.therapistProfile?.licenseNumber}</dd></div>
                    <div><dt className="inline text-slate-500">Body: </dt><dd className="inline">{t.therapistProfile?.licensingBody}</dd></div>
                    <div><dt className="inline text-slate-500">Specialization: </dt><dd className="inline">{t.therapistProfile?.specialization}</dd></div>
                    <div><dt className="inline text-slate-500">Experience: </dt><dd className="inline">{t.therapistProfile?.yearsOfExperience} years</dd></div>
                    <div><dt className="inline text-slate-500">Registered: </dt><dd className="inline">{formatDate(t.createdAt)}</dd></div>
                    {t.verifiedAt && <div><dt className="inline text-slate-500">Reviewed: </dt><dd className="inline">{formatDate(t.verifiedAt)}</dd></div>}
                  </dl>
                  {t.therapistProfile?.bio && <p className="mt-2 text-sm text-slate-600">{t.therapistProfile.bio}</p>}
                  {t.verificationNote && <p className="mt-2 text-xs text-slate-500">Note: {t.verificationNote}</p>}
                </div>
                <div className="flex gap-2">
                  {tab !== 'verified' && <Button onClick={() => setDecision({ therapist: t, status: 'verified' })}>Verify</Button>}
                  {tab !== 'rejected' && <Button variant="secondary" onClick={() => setDecision({ therapist: t, status: 'rejected' })}>{tab === 'verified' ? 'Revoke verification' : 'Reject'}</Button>}
                </div>
              </div>
            </Card>
          ))}
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </div>
      )}

      <Modal
        open={Boolean(decision)}
        onClose={() => !saving && setDecision(null)}
        title={decision?.status === 'verified' ? `Verify ${decision?.therapist.name}?` : `Reject ${decision?.therapist.name}?`}
        description={decision?.status === 'verified' ? 'Confirm you have checked the licence with the issuing body.' : 'The therapist will see your note and can resubmit their details.'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDecision(null)} disabled={saving}>Cancel</Button>
            <Button variant={decision?.status === 'verified' ? 'primary' : 'danger'} onClick={submit} loading={saving}>
              {decision?.status === 'verified' ? 'Verify therapist' : 'Reject'}
            </Button>
          </>
        }
      >
        <Field label="Note (optional)" htmlFor="note" hint="Do not include confidential information.">
          <Textarea id="note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
