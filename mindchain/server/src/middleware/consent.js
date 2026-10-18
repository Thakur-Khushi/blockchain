import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { recordAudit } from '../services/auditService.js';
import { ChainUnavailableError } from '../services/chainService.js';
import { AppError, forbidden, notFound } from '../utils/AppError.js';

// Gate for every therapist read of patient data. Runs on EVERY request — nothing is
// cached — and checks, in order:
//   1. the caller is an active, admin-verified therapist (requireVerifiedTherapist runs first)
//   2. both parties have linked wallets
//   3. the live smart-contract hasAccess(patientWallet, therapistWallet) is true
// Any failure, including an unreachable chain, denies access and is audited.
export function requireConsent(paramName = 'patientId') {
  return async (req, _res, next) => {
    const therapist = req.user;
    const patientId = req.params[paramName];
    const deny = async (detail, error) => {
      await recordAudit({
        eventType: 'access_denied',
        actor: therapist._id,
        subject: mongoose.isValidObjectId(patientId) ? patientId : undefined,
        outcome: 'denied',
        detail,
      });
      throw error;
    };

    if (!mongoose.isValidObjectId(patientId) || !/^[a-f0-9]{24}$/i.test(patientId)) {
      throw notFound('Patient not found');
    }
    const patient = await User.findOne({ _id: patientId, role: 'patient' });
    // Same response for "no such patient" and "no consent", so patient ids cannot be probed.
    const noAccess = forbidden('This patient has not granted you access');
    if (!patient || patient.accountStatus !== 'active') return deny('patient_unavailable', noAccess);
    if (!therapist.walletAddress) {
      return deny('therapist_no_wallet', forbidden('Link your wallet before accessing patient records'));
    }
    if (!patient.walletAddress) return deny('patient_no_wallet', noAccess);

    let allowed;
    try {
      allowed = await req.app.locals.chain.hasAccess(patient.walletAddress, therapist.walletAddress);
    } catch (err) {
      if (err instanceof ChainUnavailableError) {
        return deny('chain_unavailable', new AppError(503, 'Consent cannot be verified because the blockchain is unavailable', 'CHAIN_UNAVAILABLE'));
      }
      throw err;
    }
    if (!allowed) return deny('no_consent', noAccess);

    req.patient = patient;
    next();
  };
}
