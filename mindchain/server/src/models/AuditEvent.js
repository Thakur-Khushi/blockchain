import mongoose from 'mongoose';

// Audit events never contain record content, journal text, passwords or tokens —
// only who did what, to whom, and non-sensitive references (record IDs, tx hashes).
export const AUDIT_EVENT_TYPES = Object.freeze([
  'user_registered',
  'login_success',
  'login_failed',
  'logout',
  'therapist_verification_submitted',
  'therapist_verified',
  'therapist_rejected',
  'account_status_changed',
  'wallet_linked',
  'record_created',
  'record_anchored',
  'record_updated',
  'record_deleted',
  'record_revoked_onchain',
  'record_verified',
  'record_access',
  'access_denied',
  'consent_granted',
  'consent_revoked',
  'appointment_created',
  'appointment_updated',
]);

const auditEventSchema = new mongoose.Schema(
  {
    eventType: { type: String, enum: AUDIT_EVENT_TYPES, required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    outcome: { type: String, enum: ['success', 'denied', 'failure'], default: 'success' },
    recordId: { type: String, match: /^0x[a-f0-9]{64}$/ },
    txHash: { type: String, match: /^0x[a-f0-9]{64}$/ },
    // Short, non-sensitive reason code or description (e.g. "consent_revoked").
    detail: { type: String, maxlength: 200 },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      transform(_doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

auditEventSchema.index({ createdAt: -1 });
auditEventSchema.index({ actor: 1, createdAt: -1 });
auditEventSchema.index({ subject: 1, createdAt: -1 });
auditEventSchema.index({ eventType: 1, createdAt: -1 });

export const AuditEvent = mongoose.model('AuditEvent', auditEventSchema);
