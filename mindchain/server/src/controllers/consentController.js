import { z } from 'zod';
import { AuditEvent } from '../models/AuditEvent.js';
import { User } from '../models/User.js';
import { recordAudit } from '../services/auditService.js';
import { listPatientGrants } from '../services/consentService.js';
import { AppError, badRequest } from '../utils/AppError.js';

export const confirmBody = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash').transform((s) => s.toLowerCase()),
});

// The patient's current grants, read from the smart contract (the source of truth).
export async function listMyGrants(req, res) {
  if (!req.user.walletAddress) return res.json({ walletLinked: false, items: [] });
  const items = await listPatientGrants(req.app.locals.chain, req.user.walletAddress);
  res.json({ walletLinked: true, items });
}

// Called by the client after a grantAccess/revokeAccess transaction is mined, to add
// it to the audit trail. It does not change any permission — the contract already did.
export async function confirmConsentTransaction(req, res) {
  const wallet = req.user.walletAddress;
  if (!wallet) throw badRequest('Link your wallet first');
  const { txHash } = req.valid.body;

  const tx = await req.app.locals.chain.getContractTransaction(txHash);
  if (!tx) throw new AppError(409, 'Transaction not found or not yet confirmed', 'TX_NOT_FOUND');
  if (!tx.toContract || tx.from !== wallet) throw badRequest('This transaction was not sent from your linked wallet to MindChain');
  if (!tx.success) throw new AppError(422, 'The transaction failed on-chain. Your consent settings did not change.', 'TX_FAILED');

  const consentEvents = tx.events.filter(
    (e) => (e.name === 'AccessGranted' || e.name === 'AccessRevoked') && e.args.patient.toLowerCase() === wallet,
  );
  if (!consentEvents.length) throw badRequest('This transaction did not change any consent');

  const recorded = [];
  for (const e of consentEvents) {
    const eventType = e.name === 'AccessGranted' ? 'consent_granted' : 'consent_revoked';
    // Idempotent: confirming the same transaction twice records it once.
    if (await AuditEvent.exists({ eventType, txHash, actor: req.user._id })) continue;
    const therapist = await User.findOne({ walletAddress: e.args.therapist.toLowerCase(), role: 'therapist' }).select('_id');
    await recordAudit({ eventType, actor: req.user._id, subject: therapist?._id, txHash });
    recorded.push({ type: eventType, therapistWallet: e.args.therapist.toLowerCase() });
  }
  res.json({ recorded });
}
