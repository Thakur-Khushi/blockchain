import { NETWORK_NAME } from '../services/contract.js';
import { formatDateTime } from '../services/format.js';
import { Alert, Badge } from './ui.jsx';

const STATUS = {
  verified: ['success', 'Verified', 'green'],
  tampered: ['error', 'Integrity check FAILED', 'red'],
  outdated: ['warning', 'Edited — new version not anchored', 'yellow'],
  not_anchored: ['warning', 'Not anchored on-chain', 'yellow'],
  revoked: ['warning', 'Withdrawn on-chain', 'gray'],
  chain_unavailable: ['error', 'Blockchain unavailable — not verified', 'red'],
};

const CHECK_LABELS = {
  decryption: 'Encrypted data authentic (AES-GCM tag)',
  digest: 'Recomputed SHA-256 matches stored fingerprint',
  onChain: 'Fingerprint matches the blockchain',
  owner: 'On-chain owner is your linked wallet',
};

const CHECK_COLORS = { pass: 'green', fail: 'red', mismatch: 'red', missing: 'yellow', revoked: 'gray', unavailable: 'red', skipped: 'gray', no_wallet: 'yellow' };

export function VerificationBadge({ status }) {
  const [, label, color] = STATUS[status] ?? ['info', status, 'gray'];
  return <Badge color={color}>{label}</Badge>;
}

export default function VerificationResult({ verification }) {
  if (!verification) return null;
  const [type, label] = STATUS[verification.status] ?? ['info', verification.status];
  const r = verification.record;
  return (
    <div className="space-y-4">
      <Alert type={type} title={label}>
        {verification.reason}
      </Alert>
      <ul className="space-y-2" aria-label="Verification checks">
        {Object.entries(CHECK_LABELS).map(([key, text]) => (
          <li key={key} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-700">{text}</span>
            <Badge color={CHECK_COLORS[verification.checks[key]] ?? 'gray'}>{verification.checks[key]}</Badge>
          </li>
        ))}
      </ul>
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <Detail label="Record ID" value={verification.recordId} mono />
        <Detail label="Entry created" value={formatDateTime(r.createdAt)} />
        <Detail label="Transaction hash" value={r.txHash ?? 'Not anchored'} mono />
        <Detail label="Network" value={verification.network?.chainId ? `${NETWORK_NAME} (chain ${verification.network.chainId})` : 'Unavailable'} />
        <Detail label="Stored fingerprint" value={r.digest} mono />
        <Detail label="On-chain fingerprint" value={verification.onChain?.digest ?? '—'} mono />
        <Detail label="On-chain version" value={verification.onChain?.version ?? '—'} />
        <Detail label="Checked at" value={formatDateTime(verification.verifiedAt)} />
      </dl>
    </div>
  );
}

function Detail({ label, value, mono }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`mt-0.5 break-all text-slate-800 ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}
