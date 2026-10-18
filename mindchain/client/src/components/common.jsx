import { Link } from 'react-router-dom';
import { useWallet } from '../context/WalletContext.jsx';
import { Alert, Badge, Button } from './ui.jsx';

export function PageHeader({ title, description, action }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({ label, value, hint, accent = 'brand' }) {
  const ring = { brand: 'bg-brand-50 text-brand-700', amber: 'bg-amber-50 text-amber-700', rose: 'bg-rose-50 text-rose-700', sky: 'bg-sky-50 text-sky-700' }[accent];
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-2 inline-flex rounded-lg px-2 py-0.5 text-2xl font-semibold ${ring}`}>{value ?? '—'}</p>
      {hint && <p className="mt-2 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Pagination({ page, totalPages, onChange }) {
  if (!totalPages || totalPages <= 1) return null;
  return (
    <nav className="mt-4 flex items-center justify-between gap-2 text-sm" aria-label="Pagination">
      <Button variant="secondary" onClick={() => onChange(page - 1)} disabled={page <= 1}>
        Previous
      </Button>
      <span className="text-slate-500">
        Page {page} of {totalPages}
      </span>
      <Button variant="secondary" onClick={() => onChange(page + 1)} disabled={page >= totalPages}>
        Next
      </Button>
    </nav>
  );
}

const CHAIN_STATUS = {
  anchored: ['green', 'Anchored'],
  pending: ['yellow', 'Not anchored'],
  failed: ['red', 'Anchoring failed'],
};

export function ChainStatusBadge({ status }) {
  const [color, label] = CHAIN_STATUS[status] ?? ['gray', status];
  return <Badge color={color}>{label}</Badge>;
}

// Prompts the user to finish wallet setup before blockchain actions.
export function WalletNotice({ purpose = 'use blockchain features' }) {
  const wallet = useWallet();
  if (wallet.isLinkedAccount) return null;
  let text;
  if (!wallet.linkedAddress) text = `Link a wallet to ${purpose}.`;
  else if (!wallet.account) text = `Connect MetaMask with your linked wallet to ${purpose}.`;
  else text = `MetaMask is on a different account than your linked wallet. Switch accounts to ${purpose}.`;
  return (
    <Alert type="warning" className="mb-4">
      {text}{' '}
      <Link to="/wallet" className="font-medium underline">
        Open wallet settings
      </Link>
    </Alert>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <Alert type="error" title="Could not load data">
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 font-medium underline">
          Try again
        </button>
      )}
    </Alert>
  );
}
