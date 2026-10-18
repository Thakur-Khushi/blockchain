import { z } from 'zod';
import { User } from '../models/User.js';
import { WellnessRecord } from '../models/WellnessRecord.js';
import { recordAudit } from '../services/auditService.js';
import { listConsentingPatients } from '../services/consentService.js';
import { serializeRecord } from '../services/wellnessRecordService.js';
import { badRequest } from '../utils/AppError.js';
import { pageMeta, paginate, paginationSchema } from '../utils/pagination.js';
import { safeText } from '../utils/validators.js';
import { therapistProfileSchema } from './authController.js';
import { dateString } from './wellnessController.js';

export const listTherapistsQuery = paginationSchema.extend({
  search: safeText(60).optional(),
});

export const resubmitBody = z.object({ therapistProfile: therapistProfileSchema });

const PUBLIC_FIELDS = 'name therapistProfile.specialization therapistProfile.yearsOfExperience therapistProfile.bio walletAddress';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Directory of verified, active therapists. Licence numbers are not exposed.
export async function listVerifiedTherapists(req, res) {
  const q = req.valid.query;
  const filter = { role: 'therapist', verificationStatus: 'verified', accountStatus: 'active' };
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ name: rx }, { 'therapistProfile.specialization': rx }];
  }
  const [docs, total] = await Promise.all([
    User.find(filter).select(PUBLIC_FIELDS).sort({ name: 1 }).skip(paginate(q).skip).limit(q.limit),
    User.countDocuments(filter),
  ]);
  const items = docs.map((t) => ({
    id: t._id.toString(),
    name: t.name,
    specialization: t.therapistProfile?.specialization,
    yearsOfExperience: t.therapistProfile?.yearsOfExperience,
    bio: t.therapistProfile?.bio,
    walletAddress: t.walletAddress ?? null,
  }));
  res.json({ items, ...pageMeta(q, total) });
}

// A rejected therapist may correct and resubmit their professional details.
export async function resubmitVerification(req, res) {
  if (req.user.verificationStatus === 'verified') {
    throw badRequest('Your account is already verified');
  }
  req.user.therapistProfile = req.valid.body.therapistProfile;
  req.user.verificationStatus = 'pending';
  req.user.verificationNote = undefined;
  await req.user.save();
  await recordAudit({ eventType: 'therapist_verification_submitted', actor: req.user._id });
  res.json({ user: req.user });
}

// ------------------------------------------------------------- consented patients

export const patientRecordsQuery = paginationSchema.extend({
  from: dateString.optional(),
  to: dateString.optional(),
});

// Patients whose on-chain grant to this therapist is currently valid.
export async function listMyPatients(req, res) {
  if (!req.user.walletAddress) return res.json({ walletLinked: false, items: [] });
  const items = await listConsentingPatients(req.app.locals.chain, req.user.walletAddress);
  res.json({ walletLinked: true, items });
}

// Runs after requireConsent, which has just checked live on-chain consent.
export async function getPatientSummary(req, res) {
  const grant = await req.app.locals.chain.getGrant(req.patient.walletAddress, req.user.walletAddress);
  res.json({
    patient: { id: req.patient._id.toString(), name: req.patient.name },
    grant: {
      grantedAt: grant.grantedAt ? new Date(grant.grantedAt * 1000) : null,
      expiresAt: grant.expiresAt ? new Date(grant.expiresAt * 1000) : null,
    },
  });
}

export async function listPatientRecords(req, res) {
  const q = req.valid.query;
  const filter = { patient: req.patient._id, isDeleted: false };
  if (q.from || q.to) {
    filter.entryDate = {};
    if (q.from) filter.entryDate.$gte = q.from;
    if (q.to) filter.entryDate.$lte = q.to;
  }
  const [docs, total] = await Promise.all([
    WellnessRecord.find(filter).sort({ entryDate: -1 }).skip(paginate(q).skip).limit(q.limit),
    WellnessRecord.countDocuments(filter),
  ]);
  await recordAudit({ eventType: 'record_access', actor: req.user._id, subject: req.patient._id, detail: `records_list:${docs.length}` });

  // Therapists get the clinical content and integrity status, not anchoring internals.
  const items = docs.map((d) => {
    const { anchorHistory: _h, onChainAction: _a, ...rest } = serializeRecord(d);
    return rest;
  });
  res.json({ items, ...pageMeta(q, total) });
}
