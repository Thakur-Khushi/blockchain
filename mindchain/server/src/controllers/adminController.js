import { z } from 'zod';
import { AUDIT_EVENT_TYPES, AuditEvent } from '../models/AuditEvent.js';
import { ACCOUNT_STATUSES, ROLES, User } from '../models/User.js';
import { recordAudit } from '../services/auditService.js';
import { badRequest, notFound } from '../utils/AppError.js';
import { pageMeta, paginate, paginationSchema } from '../utils/pagination.js';
import { objectId, safeText } from '../utils/validators.js';

export const idParams = z.object({ id: objectId });

export const listUsersQuery = paginationSchema.extend({
  role: z.enum(ROLES).optional(),
  accountStatus: z.enum(ACCOUNT_STATUSES).optional(),
  verificationStatus: z.enum(['pending', 'verified', 'rejected']).optional(),
});

export const verificationBody = z.object({
  status: z.enum(['verified', 'rejected']),
  note: safeText(500).optional(),
});

export const accountStatusBody = z.object({
  accountStatus: z.enum(ACCOUNT_STATUSES),
});

export const auditQuery = paginationSchema.extend({
  eventType: z.enum(AUDIT_EVENT_TYPES).optional(),
  outcome: z.enum(['success', 'denied', 'failure']).optional(),
});

export async function listPendingTherapists(req, res) {
  const q = req.valid.query;
  const filter = { role: 'therapist', verificationStatus: 'pending' };
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: 1 }).skip(paginate(q).skip).limit(q.limit),
    User.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(q, total) });
}

export async function setTherapistVerification(req, res) {
  const { id } = req.valid.params;
  const { status, note } = req.valid.body;
  const therapist = await User.findOne({ _id: id, role: 'therapist' });
  if (!therapist) throw notFound('Therapist not found');

  therapist.verificationStatus = status;
  therapist.verificationNote = note;
  therapist.verifiedBy = req.user._id;
  therapist.verifiedAt = new Date();
  await therapist.save();

  await recordAudit({
    eventType: status === 'verified' ? 'therapist_verified' : 'therapist_rejected',
    actor: req.user._id,
    subject: therapist._id,
  });
  res.json({ user: therapist });
}

export async function listUsers(req, res) {
  const q = req.valid.query;
  const filter = {};
  if (q.role) filter.role = q.role;
  if (q.accountStatus) filter.accountStatus = q.accountStatus;
  if (q.verificationStatus) filter.verificationStatus = q.verificationStatus;
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(paginate(q).skip).limit(q.limit),
    User.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(q, total) });
}

export async function setAccountStatus(req, res) {
  const { id } = req.valid.params;
  const { accountStatus } = req.valid.body;
  if (req.user._id.equals(id)) throw badRequest('Administrators cannot change their own account status');

  const user = await User.findById(id);
  if (!user) throw notFound('User not found');
  if (user.role === 'admin') throw badRequest('Administrator accounts cannot be suspended here');

  const update = { accountStatus };
  // Suspension also invalidates existing sessions.
  const ops = accountStatus === 'suspended' ? { $set: update, $inc: { tokenVersion: 1 } } : { $set: update };
  const updated = await User.findByIdAndUpdate(id, ops, { returnDocument: 'after' });

  await recordAudit({
    eventType: 'account_status_changed',
    actor: req.user._id,
    subject: user._id,
    detail: accountStatus,
  });
  res.json({ user: updated });
}

// Audit events contain identifiers and reason codes only — never record content.
export async function listAuditEvents(req, res) {
  const q = req.valid.query;
  const filter = {};
  if (q.eventType) filter.eventType = q.eventType;
  if (q.outcome) filter.outcome = q.outcome;
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

export async function stats(_req, res) {
  const [byRole, pendingTherapists, suspended] = await Promise.all([
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    User.countDocuments({ role: 'therapist', verificationStatus: 'pending' }),
    User.countDocuments({ accountStatus: 'suspended' }),
  ]);
  res.json({
    usersByRole: Object.fromEntries(byRole.map((r) => [r._id, r.count])),
    pendingTherapists,
    suspendedAccounts: suspended,
  });
}
