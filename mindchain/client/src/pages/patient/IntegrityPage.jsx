import { useState } from 'react';
import { ChainStatusBadge, ErrorState, PageHeader, Pagination, WalletNotice } from '../../components/common.jsx';
import Modal from '../../components/Modal.jsx';
import TxStatus from '../../components/TxStatus.jsx';
import { Alert, Button, Card, EmptyState, PageLoader, shortHash, Spinner } from '../../components/ui.jsx';
import VerificationResult, { VerificationBadge } from '../../components/VerificationResult.jsx';
import { useWallet } from '../../context/WalletContext.jsx';
import { useAnchor } from '../../hooks/useAnchor.js';
import { useAsync } from '../../hooks/useAsync.js';
import { api, apiErrorMessage } from '../../services/api.js';
import { NETWORK_NAME } from '../../services/contract.js';
import { formatDateTime, formatEntryDate } from '../../services/format.js';

export default function IntegrityPage() {
  const [page, setPage] = useState(1);
  const [results, setResults] = useState({}); // recordId -> verification | { error } | 'loading'
  const [details, setDetails] = useState(null);
  const [runningAll, setRunningAll] = useState(false);
  const [message, setMessage] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const wallet = useWallet();
  const { anchor, sync, tx } = useAnchor();

  const { data, loading, error, reload } = useAsync(async () => (await api.get('/wellness', { params: { page, limit: 20 } })).data, [page]);

  const verifyOne = async (r) => {
    setResults((s) => ({ ...s, [r.recordId]: 'loading' }));
    try {
      const { data: res } = await api.get(`/wellness/${r.recordId}/verify`);
      setResults((s) => ({ ...s, [r.recordId]: res.verification }));
      return res.verification;
    } catch (err) {
      setResults((s) => ({ ...s, [r.recordId]: { error: apiErrorMessage(err) } }));
      return null;
    }
  };

  const verifyAll = async () => {
    setRunningAll(true);
    for (const r of data.items) await verifyOne(r); // sequential: keeps RPC load low
    setRunningAll(false);
  };

  const act = async (r, fn, success) => {
    setMessage(null);
    setBusyId(r.recordId);
    try {
      await fn(r);
      setMessage({ type: 'success', text: success });
      setResults((s) => ({ ...s, [r.recordId]: undefined }));
      reload();
    } catch (err) {
      setMessage({ type: 'error', text: err?.response ? apiErrorMessage(err) : err.message });
    } finally {
      setBusyId(null);
    }
  };

  const failures = Object.values(results).filter((v) => v && v !== 'loading' && v.status === 'tampered').length;

  return (
    <div>
      <PageHeader
        title="Record integrity"
        description="Each check decrypts the record, recomputes its SHA-256 fingerprint and compares it with the value anchored on the blockchain."
        action={
          <Button onClick={verifyAll} loading={runningAll} disabled={!data?.items?.length}>
            Verify all on this page
          </Button>
        }
      />
      <WalletNotice purpose="anchor records" />
      {failures > 0 && (
        <Alert type="error" title="Verification failed" className="mb-4">
          {failures} record{failures > 1 ? 's' : ''} did not match {failures > 1 ? 'their' : 'its'} anchored fingerprint or could not be decrypted. The stored data may have been altered.
        </Alert>
      )}
      {message && <Alert type={message.type} className="mb-4">{message.text}</Alert>}
      <TxStatus tx={tx} />

      {loading ? (
        <PageLoader />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No records yet" description="Records appear here after your first check-in." />
      ) : (
        <Card className="mt-4 overflow-hidden !p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3">Entry / created</th>
                  <th scope="col" className="px-4 py-3">Chain status</th>
                  <th scope="col" className="px-4 py-3">Transaction / network</th>
                  <th scope="col" className="px-4 py-3">Record ID</th>
                  <th scope="col" className="px-4 py-3">Verification</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.items.map((r) => {
                  const res = results[r.recordId];
                  return (
                    <tr key={r.recordId} className={res?.status === 'tampered' ? 'bg-rose-50/60' : ''}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="block font-medium text-slate-800">{formatEntryDate(r.entryDate, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                        <span className="block text-xs text-slate-500">Created {formatDateTime(r.createdAt)}</span>
                      </td>
                      <td className="px-4 py-3"><ChainStatusBadge status={r.chainStatus} /></td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="block font-mono text-xs" title={r.txHash ?? ''}>{r.txHash ? shortHash(r.txHash) : '—'}</span>
                        <span className="block text-xs text-slate-500">{r.chainId ? `${NETWORK_NAME} (${r.chainId})` : 'Not on-chain'}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap" title={r.recordId}>{shortHash(r.recordId)}</td>
                      <td className="px-4 py-3">
                        {res === 'loading' ? (
                          <Spinner className="h-4 w-4 text-slate-400" />
                        ) : res?.error ? (
                          <span className="text-xs text-rose-700">{res.error}</span>
                        ) : res ? (
                          <button type="button" onClick={() => setDetails({ record: r, result: res })} className="text-left">
                            <VerificationBadge status={res.status} />
                            <span className="ml-1 text-xs text-brand-700 underline">details</span>
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">Not checked</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2 whitespace-nowrap">
                          <Button variant="secondary" className="!px-3 !py-1.5" onClick={() => verifyOne(r)} disabled={res === 'loading'}>
                            Verify
                          </Button>
                          {r.chainStatus !== 'anchored' && r.integrity.status === 'ok' && (
                            <>
                              <Button className="!px-3 !py-1.5" onClick={() => act(r, anchor, 'Record anchored on-chain.')} loading={busyId === r.recordId && tx.busy} disabled={!wallet.isLinkedAccount || Boolean(busyId)}>
                                {r.onChainAction === 'update' ? 'Re-anchor' : 'Anchor'}
                              </Button>
                              <Button variant="ghost" className="!px-3 !py-1.5" onClick={() => act(r, sync, 'Anchor found on-chain and confirmed.')} disabled={Boolean(busyId)} title="Use if a transaction was sent but not confirmed here">
                                Check chain
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-4">
            <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
          </div>
        </Card>
      )}

      <Modal open={Boolean(details)} onClose={() => setDetails(null)} title="Verification details" description={details && formatEntryDate(details.record.entryDate)} size="lg">
        {details && <VerificationResult verification={details.result} />}
      </Modal>
    </div>
  );
}
