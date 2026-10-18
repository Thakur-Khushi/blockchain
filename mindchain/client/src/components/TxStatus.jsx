import { Alert, shortHash, Spinner } from './ui.jsx';

// Shows the real state of a MetaMask transaction from useTransaction().
export default function TxStatus({ tx, labels = {} }) {
  if (!tx || tx.status === 'idle') return null;

  if (tx.status === 'signing') {
    return (
      <Alert type="info">
        <span className="flex items-center gap-2">
          <Spinner className="h-4 w-4" /> {labels.signing ?? 'Waiting for you to confirm in MetaMask…'}
        </span>
      </Alert>
    );
  }
  if (tx.status === 'pending') {
    return (
      <Alert type="info">
        <span className="flex items-center gap-2">
          <Spinner className="h-4 w-4" /> {labels.pending ?? 'Transaction submitted. Waiting for confirmation…'}
        </span>
        <span className="mt-1 block font-mono text-xs break-all">{tx.txHash}</span>
      </Alert>
    );
  }
  if (tx.status === 'confirmed') {
    return (
      <Alert type="success" title={labels.confirmed ?? 'Transaction confirmed on-chain'}>
        <span className="font-mono text-xs" title={tx.txHash}>
          {shortHash(tx.txHash)}
        </span>
      </Alert>
    );
  }
  return <Alert type="error" title={labels.failed ?? 'Transaction failed'}>{tx.error}</Alert>;
}
