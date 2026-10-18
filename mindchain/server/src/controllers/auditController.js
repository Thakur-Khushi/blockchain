import { z } from 'zod';
import { AUDIT_EVENT_TYPES, AuditEvent } from '../models/AuditEvent.js';
import { pageMeta, paginate, paginationSchema } from '../utils/pagination.js';

export const myAuditQuery = paginationSchema.extend({
  eventType: z.enum(AUDIT_EVENT_TYPES).optional(),
  // "true" limits the list to entries with a blockchain transaction (transaction history).
  withTx: z.enum(['true', 'false']).optional(),
});

// Events where the user is the actor or the subject: e.g. a patient sees which
// therapists accessed (or were denied) their records, and their own transactions.
export async function listMyAuditEvents(req, res) {
  const q = req.valid.query;
  const filter = { $or: [{ actor: req.user._id }, { subject: req.user._id }] };
  if (q.eventType) filter.eventType = q.eventType;
  if (q.withTx === 'true') filter.txHash = { $exists: true };
  const [items, total] = await Promise.all([
    AuditEvent.find(filter)
      .sort({ createdAt: -1 })
      .skip(paginate(q).skip)
      .limit(q.limit)
      .populate('actor', 'name role')
      .populate('subject', 'name role'),
    AuditEvent.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(q, total) });
}
