import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChainStatusBadge, PageHeader, WalletNotice } from '../../components/common.jsx';
import TxStatus from '../../components/TxStatus.jsx';
import { Alert, Button, Card, CardHeader, Field, Input, PageLoader, Textarea } from '../../components/ui.jsx';
import { MoodSelector, StressSlider, TagInput } from '../../components/wellness.jsx';
import { useWallet } from '../../context/WalletContext.jsx';
import { useAnchor } from '../../hooks/useAnchor.js';
import { api, apiErrorMessage } from '../../services/api.js';
import { formatEntryDate, localDate } from '../../services/format.js';

const MAX_JOURNAL = 5000;
const EMPTY = { mood: null, stress: 5, journal: '', tags: [] };

export default function CheckInPage() {
  const [params, setParams] = useSearchParams();
  const today = localDate();
  const date = params.get('date') && params.get('date') <= today ? params.get('date') : today;

  const [existing, setExisting] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [saved, setSaved] = useState(null);
  const wallet = useWallet();
  const { anchor, tx } = useAnchor();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage(null);
    setSaved(null);
    tx.reset();
    api
      .get('/wellness', { params: { from: date, to: date, limit: 1 } })
      .then(({ data }) => {
        if (cancelled) return;
        const rec = data.items[0] ?? null;
        setExisting(rec);
        setForm(rec && rec.integrity.status === 'ok' ? { mood: rec.mood, stress: rec.stress, journal: rec.journal ?? '', tags: rec.tags ?? [] } : EMPTY);
      })
      .catch((err) => !cancelled && setMessage({ type: 'error', text: apiErrorMessage(err) }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const onSubmit = async (e) => {
    e.preventDefault();
    const v = {};
    if (!form.mood) v.mood = 'Choose a mood score';
    if (form.journal.length > MAX_JOURNAL) v.journal = `Keep the journal under ${MAX_JOURNAL} characters`;
    setErrors(v);
    if (Object.keys(v).length) return;

    setSaving(true);
    setMessage(null);
    try {
      const body = { mood: form.mood, stress: form.stress, journal: form.journal, tags: form.tags };
      const { data } = existing
        ? await api.patch(`/wellness/${existing.recordId}`, body)
        : await api.post('/wellness', { ...body, entryDate: date });
      setExisting(data.record);
      setSaved(data.record);
      setMessage({ type: 'success', text: existing ? 'Check-in updated and re-encrypted.' : 'Check-in saved and encrypted.' });
    } catch (err) {
      setMessage({ type: 'error', text: apiErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  const onAnchor = async () => {
    setMessage(null);
    try {
      const rec = await anchor(saved ?? existing);
      setExisting(rec);
      setSaved(rec);
      setMessage({ type: 'success', text: 'Record fingerprint anchored and confirmed on-chain.' });
    } catch (err) {
      setMessage({ type: 'error', text: err?.response ? apiErrorMessage(err) : err.message });
    }
  };

  if (loading) return <PageLoader />;
  const tampered = existing && existing.integrity.status !== 'ok';
  const anchorTarget = saved ?? existing;
  const needsAnchor = anchorTarget && anchorTarget.chainStatus !== 'anchored';

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={existing ? 'Edit check-in' : 'Daily check-in'}
        description={formatEntryDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        action={
          <div className="w-44">
            <label htmlFor="date" className="sr-only">Check-in date</label>
            <Input id="date" type="date" max={today} value={date} onChange={(e) => e.target.value && setParams({ date: e.target.value })} />
          </div>
        }
      />

      {message && <Alert type={message.type} className="mb-4">{message.text}</Alert>}
      {tampered && (
        <Alert type="error" title="This record failed its integrity check" className="mb-4">
          Its content is withheld and it cannot be edited. See the <Link to="/patient/integrity" className="underline">integrity page</Link>.
        </Alert>
      )}

      {!tampered && (
        <form onSubmit={onSubmit} className="space-y-6" noValidate>
          <Card>
            <MoodSelector value={form.mood} onChange={(mood) => setForm({ ...form, mood })} error={errors.mood} />
          </Card>
          <Card>
            <StressSlider value={form.stress} onChange={(stress) => setForm({ ...form, stress })} />
          </Card>
          <Card>
            <Field label="Private journal (optional)" htmlFor="journal" error={errors.journal} hint="Encrypted before it is stored. Only you, and therapists you authorise, can read it.">
              <Textarea
                id="journal"
                rows={6}
                value={form.journal}
                onChange={(e) => setForm({ ...form, journal: e.target.value })}
                placeholder="What's on your mind today?"
                invalid={!!errors.journal}
              />
            </Field>
            <p className={`mt-1 text-right text-xs ${form.journal.length > MAX_JOURNAL ? 'text-rose-600' : 'text-slate-400'}`}>
              {form.journal.length}/{MAX_JOURNAL}
            </p>
            <div className="mt-4">
              <TagInput value={form.tags} onChange={(tags) => setForm({ ...form, tags })} />
            </div>
          </Card>
          <div className="flex justify-end">
            <Button type="submit" loading={saving}>
              {existing ? 'Save changes' : 'Save check-in'}
            </Button>
          </div>
        </form>
      )}

      {anchorTarget && !tampered && (
        <Card className="mt-6">
          <CardHeader
            title="Blockchain integrity"
            description="Anchor a fingerprint (SHA-256) of this check-in on-chain so any later tampering can be detected. Only the fingerprint and a random ID go on-chain — never your content."
            action={<ChainStatusBadge status={anchorTarget.chainStatus} />}
          />
          <WalletNotice purpose="anchor this record" />
          {needsAnchor ? (
            <Button onClick={onAnchor} loading={tx.busy} disabled={!wallet.isLinkedAccount || tx.busy}>
              {anchorTarget.onChainAction === 'update' ? 'Anchor updated version' : 'Anchor on blockchain'}
            </Button>
          ) : (
            <p className="text-sm text-slate-600">
              Current version anchored. <span className="font-mono text-xs break-all">{anchorTarget.txHash}</span>
            </p>
          )}
          <div className="mt-3">
            <TxStatus tx={tx} />
          </div>
        </Card>
      )}
    </div>
  );
}
