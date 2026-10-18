import { User } from '../models/User.js';

// Latest grant state per (patient, therapist) pair, derived from contract events and
// confirmed with live getGrant() calls. Events only tell us which pairs to check.
export async function listPatientGrants(chain, patientWallet) {
  const events = await chain.getConsentEvents({ patient: patientWallet });
  const therapistWallets = [...new Set(events.map((e) => e.therapist))];
  const grants = await Promise.all(therapistWallets.map((t) => chain.getGrant(patientWallet, t)));
  const users = await User.find({ walletAddress: { $in: therapistWallets }, role: 'therapist' }).select(
    'name walletAddress verificationStatus accountStatus therapistProfile.specialization',
  );
  const byWallet = new Map(users.map((u) => [u.walletAddress, u]));

  return therapistWallets.map((wallet, i) => {
    const u = byWallet.get(wallet);
    const g = grants[i];
    return {
      therapistWallet: wallet,
      therapist: u
        ? {
            id: u._id.toString(),
            name: u.name,
            specialization: u.therapistProfile?.specialization ?? null,
            verificationStatus: u.verificationStatus,
            accountStatus: u.accountStatus,
          }
        : null,
      active: g.active,
      currentlyValid: g.currentlyValid,
      grantedAt: g.grantedAt ? new Date(g.grantedAt * 1000) : null,
      expiresAt: g.expiresAt ? new Date(g.expiresAt * 1000) : null,
      history: events
        .filter((e) => e.therapist === wallet)
        .map((e) => ({ type: e.type, txHash: e.txHash, blockNumber: e.blockNumber, expiresAt: e.expiresAt })),
    };
  });
}

// Patients who currently grant this therapist access (live hasAccess per candidate).
export async function listConsentingPatients(chain, therapistWallet) {
  const events = await chain.getConsentEvents({ therapist: therapistWallet });
  const patientWallets = [...new Set(events.filter((e) => e.type === 'granted').map((e) => e.patient))];
  const checks = await Promise.all(patientWallets.map((p) => chain.getGrant(p, therapistWallet)));
  const allowed = patientWallets.filter((_, i) => checks[i].currentlyValid);
  const grantByWallet = new Map(patientWallets.map((p, i) => [p, checks[i]]));

  const patients = await User.find({ walletAddress: { $in: allowed }, role: 'patient', accountStatus: 'active' }).select(
    'name walletAddress',
  );
  return patients.map((p) => {
    const g = grantByWallet.get(p.walletAddress);
    return {
      id: p._id.toString(),
      name: p.name,
      grantedAt: g.grantedAt ? new Date(g.grantedAt * 1000) : null,
      expiresAt: g.expiresAt ? new Date(g.expiresAt * 1000) : null,
    };
  });
}
