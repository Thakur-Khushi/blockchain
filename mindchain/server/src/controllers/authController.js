import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config/env.js';
import { User } from '../models/User.js';
import { recordAudit } from '../services/auditService.js';
import { signAccessToken } from '../services/tokenService.js';
import { conflict, forbidden, unauthorized } from '../utils/AppError.js';
import { email, password, safeText } from '../utils/validators.js';

export const therapistProfileSchema = z.object({
  licenseNumber: safeText(64).pipe(z.string().min(3, 'License number is required')),
  licensingBody: safeText(120).pipe(z.string().min(2, 'Licensing body is required')),
  specialization: safeText(120).pipe(z.string().min(2, 'Specialization is required')),
  yearsOfExperience: z.coerce.number().int().min(0).max(70),
  bio: safeText(1000).optional().default(''),
});

const baseRegister = {
  name: safeText(100).pipe(z.string().min(2, 'Name must be at least 2 characters')),
  email,
  password,
};

// Admin accounts cannot be self-registered; they are created by scripts/seed-admin.js.
export const registerSchema = z.discriminatedUnion('role', [
  z.object({ ...baseRegister, role: z.literal('patient') }),
  z.object({ ...baseRegister, role: z.literal('therapist'), therapistProfile: therapistProfileSchema }),
]);

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(200),
});

let dummyHashPromise;
// Compared against when the email is unknown so response time does not reveal
// which emails are registered.
function dummyHash() {
  dummyHashPromise ??= bcrypt.hash('mindchain-timing-equaliser', config.BCRYPT_ROUNDS);
  return dummyHashPromise;
}

export async function register(req, res) {
  const data = req.valid.body;
  if (await User.exists({ email: data.email })) {
    throw conflict('An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(data.password, config.BCRYPT_ROUNDS);
  const isTherapist = data.role === 'therapist';
  const user = await User.create({
    name: data.name,
    email: data.email,
    passwordHash,
    role: data.role,
    therapistProfile: isTherapist ? data.therapistProfile : undefined,
    verificationStatus: isTherapist ? 'pending' : 'not_applicable',
  });

  await recordAudit({ eventType: 'user_registered', actor: user._id, detail: user.role });
  if (isTherapist) {
    await recordAudit({ eventType: 'therapist_verification_submitted', actor: user._id });
  }

  res.status(201).json({ token: signAccessToken(user, 0), user });
}

export async function login(req, res) {
  const { email: userEmail, password: pwd } = req.valid.body;
  const user = await User.findOne({ email: userEmail }).select('+passwordHash +tokenVersion');

  const valid = await bcrypt.compare(pwd, user?.passwordHash ?? (await dummyHash()));
  if (!user || !valid) {
    if (user) await recordAudit({ eventType: 'login_failed', actor: user._id, outcome: 'denied' });
    throw unauthorized('Invalid email or password');
  }
  if (user.accountStatus !== 'active') {
    await recordAudit({ eventType: 'login_failed', actor: user._id, outcome: 'denied', detail: 'suspended' });
    throw forbidden('Account is suspended. Please contact support.');
  }

  user.lastLoginAt = new Date();
  await user.save();
  await recordAudit({ eventType: 'login_success', actor: user._id });

  res.json({ token: signAccessToken(user, user.tokenVersion), user });
}

export async function me(req, res) {
  res.json({ user: req.user });
}

// Invalidates every token issued to this user (all devices).
export async function logout(req, res) {
  await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
  await recordAudit({ eventType: 'logout', actor: req.user._id });
  res.status(204).end();
}
