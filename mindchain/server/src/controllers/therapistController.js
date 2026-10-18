import { z } from 'zod';
import { User } from '../models/User.js';
import { recordAudit } from '../services/auditService.js';
import { badRequest } from '../utils/AppError.js';
import { pageMeta, paginate, paginationSchema } from '../utils/pagination.js';
import { safeText } from '../utils/validators.js';
import { therapistProfileSchema } from './authController.js';

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
