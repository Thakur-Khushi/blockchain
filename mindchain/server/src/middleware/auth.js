import { User } from '../models/User.js';
import { verifyAccessToken } from '../services/tokenService.js';
import { forbidden, unauthorized } from '../utils/AppError.js';

// Verifies the bearer token and reloads the user on every request, so role changes,
// suspensions and logouts take effect immediately rather than when the token expires.
export async function authenticate(req, _res, next) {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized();

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw unauthorized('Invalid or expired session');
  }

  const user = await User.findById(payload.sub).select('+tokenVersion');
  if (!user || user.tokenVersion !== payload.tv) throw unauthorized('Invalid or expired session');
  if (user.accountStatus !== 'active') throw forbidden('Account is suspended');

  req.user = user;
  next();
}

export function authorize(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

// Professional identity is established by admin review, never by a wallet address alone.
export function requireVerifiedTherapist(req, _res, next) {
  if (req.user?.role !== 'therapist') throw forbidden();
  if (req.user.verificationStatus !== 'verified') {
    throw forbidden('Therapist account is awaiting administrator verification');
  }
  next();
}
