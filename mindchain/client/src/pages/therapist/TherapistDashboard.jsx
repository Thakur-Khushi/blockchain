import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState, PageHeader, StatCard, WalletNotice } from '../../components/common.jsx';
import { Alert, Button, Card, CardHeader, EmptyState, Field, Input, PageLoader, Textarea } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api, apiErrorMessage, apiFieldErrors } from '../../services/api.js';
import { formatDate } from '../../services/format.js';

export default function TherapistDashboard() {
  const { user } = useAuth();
  if (user.verificationStatus !== 'verified') return <VerificationStatus />;
  return <VerifiedDashboard />;
}

function VerifiedDashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync(async () => (await api.get('/therapists/patients')).data, []);

  return (
    <div>
      <PageHeader title={`Welcome, ${user.name}`} description="Patients appear here only while their on-chain consent to you is active." />
      <WalletNotice purpose="receive patient consent" />
      {loading ? (
        <PageLoader />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Patients with active consent" value={data.items.length} />
            <StatCard label="Verification" value="Verified" hint={`Specialization: ${user.therapistProfile?.specialization ?? '—'}`} />
            <StatCard label="Wallet" value={user.walletAddress ? 'Linked' : 'Not linked'} accent={user.walletAddress ? 'brand' : 'amber'} hint="Patients grant access to this address" />
          </div>
          <Card className="mt-6">
            <CardHeader title="Your patients" action={<Link to="/therapist/patients" className="text-sm font-medium text-brand-700 hover:underline">View all</Link>} />
            {!data.walletLinked ? (
              <EmptyState title="Link your wallet" description="Patients grant access to a wallet address. Link yours so patients can choose you." action={<Link to="/wallet"><Button>Go to wallet</Button></Link>} />
            ) : data.items.length === 0 ? (
              <EmptyState title="No patients have granted access yet" description="Patients can find you in the therapist directory and grant access from their dashboard." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.items.slice(0, 6).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{p.name}</p>
                      <p className="text-xs text-slate-500">Access since {formatDate(p.grantedAt)}{p.expiresAt ? ` · until ${formatDate(p.expiresAt)}` : ''}</p>
                    </div>
                    <Link to={`/therapist/patients/${p.id}`}><Button variant="secondary">Open records</Button></Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function VerificationStatus() {
  const { user, setUser } = useAuth();
  const p = user.therapistProfile ?? {};
  const [form, setForm] = useState({
    licenseNumber: p.licenseNumber ?? '',
    licensingBody: p.licensingBody ?? '',
    specialization: p.specialization ?? '',
    yearsOfExperience: p.yearsOfExperience ?? '',
    bio: p.bio ?? '',
  });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const rejected = user.verificationStatus === 'rejected';

  const onSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const { data } = await api.put('/therapists/me/verification', {
        therapistProfile: { ...form, yearsOfExperience: Number(form.yearsOfExperience) },
      });
      setUser(data.user);
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setMessage(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Professional verification" description="Therapist features unlock after an administrator reviews your credentials." />
      {rejected ? (
        <Alert type="error" title="Verification was not approved">
          {user.verificationNote || 'An administrator could not verify the details you submitted.'} You can correct and resubmit them below.
        </Alert>
      ) : (
        <Alert type="info" title="Verification pending">
          Your details are awaiting administrator review. You will not be able to access patient records until you are verified — even if a patient grants your wallet access.
        </Alert>
      )}
      <Card className="mt-6">
        <CardHeader title="Submitted details" />
        {rejected ? (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {message && <Alert type="error">{message}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="License number" htmlFor="ln" error={errors.licenseNumber}><Input id="ln" value={form.licenseNumber} onChange={set('licenseNumber')} /></Field>
              <Field label="Licensing body" htmlFor="lb" error={errors.licensingBody}><Input id="lb" value={form.licensingBody} onChange={set('licensingBody')} /></Field>
              <Field label="Specialization" htmlFor="sp" error={errors.specialization}><Input id="sp" value={form.specialization} onChange={set('specialization')} /></Field>
              <Field label="Years of experience" htmlFor="ye" error={errors.yearsOfExperience}><Input id="ye" type="number" min="0" max="70" value={form.yearsOfExperience} onChange={set('yearsOfExperience')} /></Field>
            </div>
            <Field label="Bio" htmlFor="bio"><Textarea id="bio" rows={3} value={form.bio} onChange={set('bio')} /></Field>
            <Button type="submit" loading={saving}>Resubmit for verification</Button>
          </form>
        ) : (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {[
              ['License number', p.licenseNumber],
              ['Licensing body', p.licensingBody],
              ['Specialization', p.specialization],
              ['Years of experience', p.yearsOfExperience],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-slate-500">{k}</dt>
                <dd className="mt-0.5 font-medium text-slate-800">{v ?? '—'}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </div>
  );
}
