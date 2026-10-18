import { AUDIT_LABELS, formatDateTime } from '../services/format.js';
import { Badge, shortHash } from './ui.jsx';

const OUTCOME = { success: 'green', denied: 'yellow', failure: 'red' };

// Renders audit events. Events only ever contain ids, reason codes and tx hashes.
export default function AuditTable({ items, showSubject = true }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
          <tr>
            <th scope="col" className="px-4 py-3">When</th>
            <th scope="col" className="px-4 py-3">Event</th>
            <th scope="col" className="px-4 py-3">By</th>
            {showSubject && <th scope="col" className="px-4 py-3">Concerning</th>}
            <th scope="col" className="px-4 py-3">Outcome</th>
            <th scope="col" className="px-4 py-3">Reference</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {items.map((e) => (
            <tr key={e.id}>
              <td className="px-4 py-3 whitespace-nowrap text-slate-500">{formatDateTime(e.createdAt)}</td>
              <td className="px-4 py-3">
                <span className="font-medium text-slate-800">{AUDIT_LABELS[e.eventType] ?? e.eventType}</span>
                {e.detail && <span className="block text-xs text-slate-500">{e.detail.replaceAll('_', ' ')}</span>}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                {e.actor ? <>{e.actor.name} <span className="text-xs text-slate-400 capitalize">({e.actor.role})</span></> : '—'}
              </td>
              {showSubject && (
                <td className="px-4 py-3 whitespace-nowrap">
                  {e.subject ? <>{e.subject.name} <span className="text-xs text-slate-400 capitalize">({e.subject.role})</span></> : '—'}
                </td>
              )}
              <td className="px-4 py-3"><Badge color={OUTCOME[e.outcome] ?? 'gray'}>{e.outcome}</Badge></td>
              <td className="px-4 py-3 font-mono text-xs">
                {e.txHash ? <span title={e.txHash}>tx {shortHash(e.txHash)}</span> : e.recordId ? <span title={e.recordId}>rec {shortHash(e.recordId)}</span> : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
