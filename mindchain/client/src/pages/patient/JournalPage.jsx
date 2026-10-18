import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChainStatusBadge, ErrorState, PageHeader, Pagination } from '../../components/common.jsx';
import Modal, { ConfirmDialog } from '../../components/Modal.jsx';
import TxStatus from '../../components/TxStatus.jsx';
import { Alert, Badge, Button, Card, EmptyState, Input, PageLoader } from '../../components/ui.jsx';
import VerificationResult from '../../components/VerificationResult.jsx';
import { ScorePill } from '../../components/wellness.jsx';
import { useWallet } from '../../context/WalletContext.jsx';
import { useAnchor } from '../../hooks/useAnchor.js';
import { useAsync } from '../../hooks/useAsync.js';
import { api, apiErrorMessage } from '../../services/api.js';
import { formatEntryDate, localDate } from '../../services/format.js';

export default function JournalPage() {
  const [filters, setFilters] = useState({ from: '', to: '' });
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState(null);
  const [verifying, setVerifying] = useState(null); // { record, result, loading, error }
  const [deleting, setDeleting] = useState(null); // { record, revokeOnChain }
  const [busyId, setBusyId] = useState(null);
  const wallet = useWallet();
  const { anchor, revoke, tx } = useAnchor();

  const invalidRange = filters.from && filters.to && filters.from > filters.to;
  const { data, loading, error, reload } = useAsync(async () => {
    if (invalidRange) return { items: [], total: 0, totalPages: 1 };
    const params = { page, limit: 10 };
    if (filters.from) params.from = filters.from;
    if (filters.to) params.to = filters.to;
    return (await api.get('/wellness', { params })).data;
  }, [page, filters.from, filters.to]);

  const report = (err) => setMessage({ type: 'error', text: err?.response ? apiErrorMessage(err) : err.message });

  const onAnchor = async (record) => {
    setMessage(null);
    setBusyId(record.recordId);
    try {
      await anchor(record);
      setMessage({ type: 'success', text: `Check-in for ${formatEntryDate(record.entryDate)} anchored on-chain.` });
      reload();
    } catch (err) {
      report(err);
    } finally {
      setBusyId(null);
    }
  };

  const onVerify = async (record) => {
    setVerifying({ record, loading: true });
    try {
      const { data: res } = await api.get(`/wellness/${record.recordId}/verify`);
      setVerifying({ record, result: res.verification });
    } catch (err) {
      setVerifying({ record, error: apiErrorMessage(err) });
    }
  };

  const onDelete = async () => {
    const { record, revokeOnChain } = deleting;
    setBusyId(record.recordId);
    try {
      // Withdraw on-chain first: if the transaction fails, nothing is deleted.
      if (revokeOnChain) await revoke(record);
      await api.delete(`/wellness/${record.recordId}`);
      setMessage({ type: 'success', text: `Check-in for ${formatEntryDate(record.entryDate)} deleted${revokeOnChain ? ' and withdrawn on-chain' : ''}.` });
      setDeleting(null);
      reload();
    } catch (err) {
      report(err);
      setDeleting(null);
    } finally {
      setBusyId(null);
    }
  };

  const onChainExists = (r) => r.anchorHistory.some((h) => h.action === 'registered');

  return (
    <div>
      <PageHeader
        title="Journal history"
        description="Your encrypted check-ins, newest first."
        action={<Link to="/patient/check-in"><Button>New check-in</Button></Link>}
      />

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
          <div>
            <label htmlFor="from" className="mb-1 block text-xs font-medium text-slate-600">From</label>
            <Input id="from" type="date" max={localDate()} value={filters.from} onChange={(e) => { setPage(1); setFilters({ ...filters, from: e.target.value }); }} />
          </div>
          <div>
            <label htmlFor="to" className="mb-1 block text-xs font-medium text-slate-600">To</label>
            <Input id="to" type="date" max={localDate()} value={filters.to} onChange={(e) => { setPage(1); setFilters({ ...filters, to: e.target.value }); }} />
          </div>
          {(filters.from || filters.to) && (
            <Button variant="ghost" onClick={() => { setPage(1); setFilters({ from: '', to: '' }); }}>Clear</Button>
          )}
        </form>
        {invalidRange && <p className="mt-2 text-xs text-rose-600">"From" must be on or before "To".</p>}
      </Card>

      {message && <Alert type={message.type} className="mb-4">{message.text}</Alert>}
      <TxStatus tx={tx} />

      {loading ? (
        <PageLoader />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <EmptyState
          title={filters.from || filters.to ? 'No check-ins in this date range' : 'No check-ins yet'}
          description="Check-ins you save appear here."
          action={<Link to="/patient/check-in"><Button>Check in now</Button></Link>}
        />
      ) : (
        <div className="mt-4 space-y-3">
          {data.items.map((r) => {
            const ok = r.integrity.status === 'ok';
            return (
              <Card key={r.recordId} className="!p-4 sm:!p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-900">{formatEntryDate(r.entryDate)}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {ok ? (
                        <>
                          <ScorePill kind="mood" value={r.mood} />
                          <ScorePill kind="stress" value={r.stress} />
                        </>
                      ) : (
                        <Badge color="red">Integrity check failed</Badge>
                      )}
                      <ChainStatusBadge status={r.chainStatus} />
                      {r.version > 1 && <Badge>Edited · v{r.version}</Badge>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ok && r.chainStatus !== 'anchored' && (
                      <Button variant="secondary" onClick={() => onAnchor(r)} loading={busyId === r.recordId && tx.busy} disabled={!wallet.isLinkedAccount || Boolean(busyId)} title={wallet.isLinkedAccount ? '' : 'Connect your linked wallet first'}>
                        {r.onChainAction === 'update' ? 'Re-anchor' : 'Anchor'}
                      </Button>
                    )}
                    <Button variant="secondary" onClick={() => onVerify(r)}>Verify</Button>
                    {ok && (
                      <Link to={`/patient/check-in?date=${r.entryDate}`}>
                        <Button variant="secondary">Edit</Button>
                      </Link>
                    )}
                    <Button variant="ghost" className="text-rose-700" onClick={() => setDeleting({ record: r, revokeOnChain: onChainExists(r) && wallet.isLinkedAccount })}>
                      Delete
                    </Button>
                  </div>
                </div>
                {ok && r.journal && <p className="mt-3 text-sm whitespace-pre-wrap text-slate-700">{r.journal}</p>}
                {ok && r.tags?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {r.tags.map((t) => <Badge key={t} color="teal">#{t}</Badge>)}
                  </div>
                )}
                {!ok && <p className="mt-3 text-sm text-rose-700">Content withheld because the encrypted record could not be authenticated.</p>}
              </Card>
            );
          })}
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </div>
      )}

      <Modal open={Boolean(verifying)} onClose={() => setVerifying(null)} title="Record verification" description={verifying && formatEntryDate(verifying.record.entryDate)} size="lg">
        {verifying?.loading && <PageLoader label="Checking encryption, fingerprint and blockchain…" />}
        {verifying?.error && <Alert type="error">{verifying.error}</Alert>}
        {verifying?.result && <VerificationResult verification={verifying.result} />}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={onDelete}
        loading={Boolean(busyId)}
        danger
        title="Delete this check-in?"
        confirmLabel="Delete"
      >
        <p>The encrypted content is permanently erased (crypto-shredded). This cannot be undone.</p>
        {deleting && onChainExists(deleting.record) && (
          <label className="mt-3 flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 accent-brand-700"
              checked={deleting.revokeOnChain}
              disabled={!wallet.isLinkedAccount}
              onChange={(e) => setDeleting({ ...deleting, revokeOnChain: e.target.checked })}
            />
            <span>
              Also withdraw the fingerprint on-chain (MetaMask transaction). The random ID and fingerprint remain in blockchain history but contain no personal data.
            </span>
          </label>
        )}
      </ConfirmDialog>
    </div>
  );
}
