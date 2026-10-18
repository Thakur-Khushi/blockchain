import { useState } from 'react';
import { ErrorState, PageHeader, WalletNotice } from '../../components/common.jsx';
import Modal, { ConfirmDialog } from '../../components/Modal.jsx';
import TxStatus from '../../components/TxStatus.jsx';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageLoader, Select, shortAddress } from '../../components/ui.jsx';
import { useWallet } from '../../context/WalletContext.jsx';
import { useAnchor } from '../../hooks/useAnchor.js';
import { useAsync } from '../../hooks/useAsync.js';
import { api, apiErrorMessage } from '../../services/api.js';
import { formatDate, formatDateTime } from '../../services/format.js';

const EXPIRY_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '0', label: 'Until I revoke it' },
];

function grantState(g) {
  if (g.currentlyValid) return ['green', 'Active'];
  if (g.active && g.expiresAt && new Date(g.expiresAt) <= new Date()) return ['gray', 'Expired'];
  return ['gray', 'Revoked'];
}

export default function ConsentPage() {
  const wallet = useWallet();
  const { ensureReady, tx } = useAnchor();
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const grants = useAsync(async () => (await api.get('/consents')).data, []);

  // Sends a consent transaction, then records it in the audit trail.
  const sendConsentTx = async (send) => {
    const contract = await ensureReady();
    const receipt = await tx.run(() => send(contract));
    try {
      await api.post('/consents/confirm', { txHash: receipt.hash });
    } catch {
      // The on-chain change already happened; only the audit entry is missing.
      setMessage({ type: 'warning', text: 'Consent updated on-chain, but it could not be added to your activity log.' });
    }
  };

  const onGrant = async (therapist, days) => {
    setBusy(true);
    setMessage(null);
    try {
      const expiresAt = days === '0' ? 0 : Math.floor(Date.now() / 1000) + Number(days) * 86400;
      await sendConsentTx((c) => c.grantAccess(therapist.walletAddress, expiresAt));
      setMessage((m) => m ?? { type: 'success', text: `${therapist.name} can now view your wellness records${days === '0' ? '' : ` for ${days} days`}.` });
      setGranting(false);
      grants.reload();
    } catch (err) {
      setMessage({ type: 'error', text: err?.response ? apiErrorMessage(err) : err.message });
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async () => {
    const g = revoking;
    setBusy(true);
    setMessage(null);
    try {
      await sendConsentTx((c) => c.revokeAccess(g.therapistWallet));
      setMessage((m) => m ?? { type: 'success', text: `Access revoked for ${g.therapist?.name ?? shortAddress(g.therapistWallet)}. Their next request will be denied.` });
      setRevoking(null);
      grants.reload();
    } catch (err) {
      setMessage({ type: 'error', text: err?.response ? apiErrorMessage(err) : err.message });
      setRevoking(null);
    } finally {
      setBusy(false);
    }
  };

  const items = grants.data?.items ?? [];
  const active = items.filter((g) => g.currentlyValid);
  const inactive = items.filter((g) => !g.currentlyValid);

  return (
    <div>
      <PageHeader
        title="Therapist access"
        description="You decide which verified therapists can view your check-ins. Permissions live in the MindChain smart contract and are checked on every request."
        action={
          <Button onClick={() => setGranting(true)} disabled={!wallet.isLinkedAccount}>
            Grant access
          </Button>
        }
      />
      <WalletNotice purpose="grant or revoke therapist access" />
      {message && <Alert type={message.type} className="mb-4">{message.text}</Alert>}
      <TxStatus tx={tx} />

      <Alert type="info" title="About revoking access" className="my-4">
        Revoking takes effect immediately for any new request — the server checks the blockchain each time a therapist opens your records.
        It cannot erase information a therapist has already viewed, noted or copied. Grant access only to professionals you trust.
      </Alert>

      {grants.loading ? (
        <PageLoader />
      ) : grants.error ? (
        <ErrorState message={grants.error} onRetry={grants.reload} />
      ) : !grants.data.walletLinked ? (
        <EmptyState title="No wallet linked" description="Link your wallet to manage therapist access." />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader title="Active access" description="Therapists who can currently view your records." />
            {active.length === 0 ? (
              <EmptyState title="No therapist has access" description="Use “Grant access” to share your records with a verified therapist." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {active.map((g) => (
                  <GrantRow key={g.therapistWallet} grant={g} onRevoke={() => setRevoking(g)} disabled={!wallet.isLinkedAccount || busy} />
                ))}
              </ul>
            )}
          </Card>
          {inactive.length > 0 && (
            <Card>
              <CardHeader title="Past access" description="Expired or revoked grants (from blockchain history)." />
              <ul className="divide-y divide-slate-100">
                {inactive.map((g) => (
                  <GrantRow key={g.therapistWallet} grant={g} />
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <GrantDialog open={granting} onClose={() => setGranting(false)} onGrant={onGrant} busy={busy} existing={active.map((g) => g.therapistWallet)} />

      <ConfirmDialog open={Boolean(revoking)} onClose={() => setRevoking(null)} onConfirm={onRevoke} loading={busy} danger title="Revoke access?" confirmLabel="Revoke in MetaMask">
        <p>
          {revoking?.therapist?.name ?? 'This therapist'} will no longer be able to open your records. You will sign a transaction in MetaMask.
        </p>
        <p className="mt-2 text-xs text-slate-500">Information they have already viewed cannot be recalled.</p>
      </ConfirmDialog>
    </div>
  );
}

function GrantRow({ grant: g, onRevoke, disabled }) {
  const [color, label] = grantState(g);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
          {g.therapist?.name ?? 'Unknown wallet'}
          <Badge color={color}>{label}</Badge>
          {g.therapist && g.therapist.verificationStatus !== 'verified' && <Badge color="red">Not verified</Badge>}
          {g.therapist?.accountStatus === 'suspended' && <Badge color="red">Suspended</Badge>}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          {g.therapist?.specialization && <>{g.therapist.specialization} · </>}
          <span className="font-mono" title={g.therapistWallet}>{shortAddress(g.therapistWallet)}</span>
          {g.grantedAt && <> · granted {formatDateTime(g.grantedAt)}</>}
          {g.expiresAt ? <> · expires {formatDate(g.expiresAt)}</> : g.currentlyValid ? <> · no expiry</> : null}
        </p>
      </div>
      {onRevoke && (
        <Button variant="danger" onClick={onRevoke} disabled={disabled}>
          Revoke
        </Button>
      )}
    </li>
  );
}

function GrantDialog({ open, onClose, onGrant, busy, existing }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [days, setDays] = useState('30');
  const list = useAsync(async () => {
    if (!open) return null;
    return (await api.get('/therapists', { params: { search: search || undefined, limit: 20 } })).data;
  }, [open, search]);

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title="Grant therapist access"
      description="Only administrator-verified therapists are listed."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => onGrant(selected, days)} disabled={!selected} loading={busy}>
            Sign in MetaMask
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Search therapists" htmlFor="tsearch">
          <Input id="tsearch" placeholder="Name or specialization" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        {list.loading ? (
          <PageLoader />
        ) : list.error ? (
          <Alert type="error">{list.error}</Alert>
        ) : !list.data?.items.length ? (
          <EmptyState title="No verified therapists found" />
        ) : (
          <ul className="max-h-72 space-y-2 overflow-y-auto" role="radiogroup" aria-label="Therapists">
            {list.data.items.map((t) => {
              const already = t.walletAddress && existing.includes(t.walletAddress);
              const disabled = !t.walletAddress || already;
              return (
                <li key={t.id}>
                  <label className={`flex cursor-pointer items-start gap-3 rounded-lg p-3 ring-1 ${selected?.id === t.id ? 'bg-brand-50 ring-2 ring-brand-600' : 'ring-slate-200'} ${disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-slate-50'}`}>
                    <input type="radio" name="therapist" className="mt-1 accent-brand-700" disabled={disabled} checked={selected?.id === t.id} onChange={() => setSelected(t)} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-900">{t.name}</span>
                      <span className="block text-xs text-slate-500">
                        {t.specialization} · {t.yearsOfExperience} yrs experience
                      </span>
                      {t.bio && <span className="mt-1 block text-xs text-slate-600">{t.bio}</span>}
                      {!t.walletAddress && <span className="mt-1 block text-xs text-amber-700">Has not linked a wallet yet</span>}
                      {already && <span className="mt-1 block text-xs text-emerald-700">Already has access</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <Field label="Access duration" htmlFor="expiry">
          <Select id="expiry" value={days} onChange={(e) => setDays(e.target.value)}>
            {EXPIRY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
