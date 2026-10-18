import { z } from 'zod';
import { WellnessRecord } from '../models/WellnessRecord.js';
import { recordAudit } from '../services/auditService.js';
import { verifyRecordIntegrity } from '../services/integrityService.js';
import { digestsEqual, newRecordId } from '../services/recordDigest.js';
import { openRecord, sealRecord, serializeRecord } from '../services/wellnessRecordService.js';
import { AppError, badRequest, conflict, notFound } from '../utils/AppError.js';
import { pageMeta, paginate, paginationSchema } from '../utils/pagination.js';
import { safeText } from '../utils/validators.js';

export const MOOD_SCALE = { min: 1, max: 10 }; // 1 = very low mood, 10 = very good mood
export const STRESS_SCALE = { min: 1, max: 10 }; // 1 = very relaxed, 10 = extremely stressed

const DAY_MS = 24 * 60 * 60 * 1000;

function isRealDate(s) {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(isRealDate, 'Date is not a valid calendar date');

// Allows "tomorrow" in UTC so users ahead of UTC can record their local today.
const entryDate = dateString
  .refine((s) => new Date(`${s}T00:00:00Z`).getTime() <= Date.now() + DAY_MS, 'Entry date cannot be in the future')
  .refine((s) => s >= '2000-01-01', 'Entry date is too far in the past');

const score = (label, { min, max }) =>
  z.coerce.number().int(`${label} must be a whole number`).min(min, `${label} must be ${min}-${max}`).max(max, `${label} must be ${min}-${max}`);

const tags = z
  .array(safeText(30).pipe(z.string().min(1).regex(/^[\p{L}\p{N} _-]+$/u, 'Tags may contain letters, numbers, spaces, - and _')))
  .max(10, 'At most 10 tags')
  .transform((list) => [...new Set(list.map((t) => t.toLowerCase()))].sort());

const journal = safeText(5000);

export const recordIdParams = z.object({ id: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid record id').transform((s) => s.toLowerCase()) });

export const createBody = z.object({
  entryDate,
  mood: score('Mood', MOOD_SCALE),
  stress: score('Stress', STRESS_SCALE),
  journal: journal.optional().default(''),
  tags: tags.optional().default([]),
});

export const updateBody = z
  .object({
    mood: score('Mood', MOOD_SCALE).optional(),
    stress: score('Stress', STRESS_SCALE).optional(),
    journal: journal.optional(),
    tags: tags.optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Provide at least one field to update');

export const listQuery = paginationSchema
  .extend({ from: dateString.optional(), to: dateString.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '"from" must not be after "to"', path: ['from'] });

async function findOwnRecord(req) {
  // Scoped to the authenticated patient: another patient's id yields 404, not 403,
  // so record existence is not disclosed.
  const doc = await WellnessRecord.findOne({
    recordId: req.valid.params.id,
    patient: req.user._id,
    isDeleted: false,
  });
  if (!doc) throw notFound('Wellness record not found');
  return doc;
}

export async function createRecord(req, res) {
  const body = req.valid.body;
  const patientId = req.user._id;
  if (await WellnessRecord.exists({ patient: patientId, entryDate: body.entryDate, isDeleted: false })) {
    throw conflict('A check-in already exists for this date. Edit it instead.');
  }

  const recordId = newRecordId();
  const sealed = sealRecord({ recordId, patientId, ...body });
  const doc = await WellnessRecord.create({ patient: patientId, recordId, entryDate: body.entryDate, ...sealed });

  await recordAudit({ eventType: 'record_created', actor: patientId, recordId });
  res.status(201).json({ record: serializeRecord(doc) });
}

export async function listRecords(req, res) {
  const q = req.valid.query;
  const filter = { patient: req.user._id, isDeleted: false };
  if (q.from || q.to) {
    filter.entryDate = {};
    if (q.from) filter.entryDate.$gte = q.from;
    if (q.to) filter.entryDate.$lte = q.to;
  }
  const [docs, total] = await Promise.all([
    WellnessRecord.find(filter).sort({ entryDate: -1 }).skip(paginate(q).skip).limit(q.limit),
    WellnessRecord.countDocuments(filter),
  ]);
  res.json({ items: docs.map((d) => serializeRecord(d)), ...pageMeta(q, total) });
}

export async function getRecord(req, res) {
  const doc = await findOwnRecord(req);
  res.json({ record: serializeRecord(doc) });
}

// Edits produce a new encrypted version and digest; the on-chain hash must then be
// updated by the patient, so the chain status returns to "pending".
export async function updateRecord(req, res) {
  const doc = await findOwnRecord(req);
  const opened = openRecord(doc);
  if (opened.status !== 'ok') {
    throw conflict('This record failed its integrity check and cannot be edited');
  }

  const merged = { ...opened.data, ...Object.fromEntries(Object.entries(req.valid.body).filter(([, v]) => v !== undefined)) };
  const sealed = sealRecord({
    recordId: doc.recordId,
    patientId: doc.patient,
    entryDate: doc.entryDate,
    mood: merged.mood,
    stress: merged.stress,
    journal: merged.journal,
    tags: merged.tags,
  });

  doc.set({ ...sealed, version: doc.version + 1, chainStatus: 'pending', txHash: undefined, anchoredAt: undefined });
  await doc.save();

  await recordAudit({ eventType: 'record_updated', actor: req.user._id, recordId: doc.recordId });
  res.json({ record: serializeRecord(doc) });
}

// Crypto-shredding: the ciphertext, IV and tag are erased; a tombstone keeps the
// non-identifying recordId and last digest so the on-chain history stays explainable.
export async function deleteRecord(req, res) {
  const doc = await findOwnRecord(req);
  doc.set({
    isDeleted: true,
    deletedAt: new Date(),
    encryptedPayload: undefined,
    iv: undefined,
    authTag: undefined,
    keyVersion: undefined,
  });
  await doc.save();
  await recordAudit({ eventType: 'record_deleted', actor: req.user._id, recordId: doc.recordId });
  res.status(204).end();
}

// ------------------------------------------------------------------ blockchain

const txHash = z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash').transform((s) => s.toLowerCase());
export const anchorBody = z.object({ txHash: txHash.optional() });
export const revocationBody = z.object({ txHash });

function requireWallet(user) {
  if (!user.walletAddress) throw badRequest('Link your wallet before using blockchain features');
  return user.walletAddress;
}

// Checks a patient-submitted transaction hash against the chain: it must be a
// successful call from the patient's linked wallet to the MindChain contract.
async function loadOwnTransaction(chain, hash, wallet) {
  const tx = await chain.getContractTransaction(hash);
  if (!tx) throw new AppError(409, 'Transaction not found or not yet confirmed. Try again shortly.', 'TX_NOT_FOUND');
  if (!tx.toContract) throw badRequest('This transaction was not sent to the MindChain contract');
  if (tx.from !== wallet) throw badRequest('This transaction was not sent from your linked wallet');
  return tx;
}

// Marks a record as anchored only after the receipt AND the current contract state
// confirm that this exact digest is registered to the patient's wallet. Without a
// txHash it recovers the anchor from contract events (e.g. after a lost response).
export async function anchorRecord(req, res) {
  const doc = await findOwnRecord(req);
  const wallet = requireWallet(req.user);
  const chain = req.app.locals.chain;
  let hash = req.valid.body.txHash;
  let action;

  if (hash) {
    const tx = await loadOwnTransaction(chain, hash, wallet);
    if (!tx.success) {
      if (doc.chainStatus !== 'anchored') {
        doc.chainStatus = 'failed';
        await doc.save();
      }
      await recordAudit({ eventType: 'record_anchored', actor: req.user._id, recordId: doc.recordId, txHash: hash, outcome: 'failure', detail: 'tx_reverted' });
      throw new AppError(422, 'The transaction failed on-chain. The record was not anchored.', 'TX_FAILED');
    }
    const ev = tx.events.find(
      (e) =>
        (e.name === 'RecordRegistered' || e.name === 'RecordUpdated') &&
        e.args.recordId.toLowerCase() === doc.recordId &&
        digestsEqual(e.args.digest, doc.digest),
    );
    if (!ev) throw badRequest('This transaction does not anchor the current version of this record');
    action = ev.name === 'RecordRegistered' ? 'registered' : 'updated';
  } else {
    const events = await chain.getRecordEvents(doc.recordId);
    const match = [...events].reverse().find((e) => e.digest && digestsEqual(e.digest, doc.digest) && e.owner === wallet);
    if (!match) throw new AppError(409, 'No on-chain anchor was found for this version of the record', 'NOT_ANCHORED');
    hash = match.txHash.toLowerCase();
    action = match.name === 'RecordRegistered' ? 'registered' : 'updated';
  }

  // Authoritative state check: the receipt alone is not enough (a later update or
  // revocation could have changed the record).
  const onChain = await chain.getRecord(doc.recordId);
  if (!onChain || onChain.revoked || onChain.owner !== wallet || !digestsEqual(onChain.digest, doc.digest)) {
    throw new AppError(409, 'The on-chain record does not match this version of the record', 'CHAIN_MISMATCH');
  }

  const alreadyRecorded = doc.anchorHistory.some((h) => h.txHash === hash);
  doc.set({ chainStatus: 'anchored', txHash: hash, chainId: chain.chainId, anchoredAt: doc.anchoredAt ?? new Date() });
  if (!alreadyRecorded) {
    doc.anchorHistory.push({ action, txHash: hash, digest: doc.digest, version: onChain.version, chainId: chain.chainId });
    await recordAudit({ eventType: 'record_anchored', actor: req.user._id, recordId: doc.recordId, txHash: hash });
  }
  await doc.save();
  res.json({ record: serializeRecord(doc) });
}

// Confirms that a deleted (or live) record was withdrawn on-chain with revokeRecord().
export async function confirmRevocation(req, res) {
  const doc = await WellnessRecord.findOne({ recordId: req.valid.params.id, patient: req.user._id });
  if (!doc) throw notFound('Wellness record not found');
  const wallet = requireWallet(req.user);
  const chain = req.app.locals.chain;
  const hash = req.valid.body.txHash;

  const tx = await loadOwnTransaction(chain, hash, wallet);
  if (!tx.success) throw new AppError(422, 'The revocation transaction failed on-chain', 'TX_FAILED');
  if (!tx.events.some((e) => e.name === 'RecordRevoked' && e.args.recordId.toLowerCase() === doc.recordId)) {
    throw badRequest('This transaction does not revoke this record');
  }
  const onChain = await chain.getRecord(doc.recordId);
  if (!onChain?.revoked) throw new AppError(409, 'The record is not revoked on-chain', 'CHAIN_MISMATCH');

  if (!doc.anchorHistory.some((h) => h.txHash === hash)) {
    doc.anchorHistory.push({ action: 'revoked', txHash: hash, version: onChain.version, chainId: chain.chainId });
    await recordAudit({ eventType: 'record_revoked_onchain', actor: req.user._id, recordId: doc.recordId, txHash: hash });
  }
  doc.chainRevoked = true;
  await doc.save();
  res.json({ recordId: doc.recordId, chainRevoked: true });
}

export async function verifyRecord(req, res) {
  const doc = await findOwnRecord(req);
  const chain = req.app.locals.chain;
  const v = await verifyRecordIntegrity(doc, { chain, patientWallet: req.user.walletAddress });

  await recordAudit({
    eventType: 'record_verified',
    actor: req.user._id,
    recordId: doc.recordId,
    outcome: v.status === 'verified' ? 'success' : 'failure',
    detail: v.status,
  });
  res.json({
    verification: {
      recordId: doc.recordId,
      status: v.status,
      reason: v.reason,
      checks: v.checks,
      onChain: v.onChain,
      record: {
        entryDate: doc.entryDate,
        createdAt: doc.createdAt,
        version: doc.version,
        digest: doc.digest,
        chainStatus: doc.chainStatus,
        txHash: doc.txHash ?? null,
        anchoredAt: doc.anchoredAt ?? null,
      },
      network: { chainId: chain.chainId, contractAddress: chain.contractAddress },
      verifiedAt: new Date(),
    },
  });
}

export function scale(_req, res) {
  res.json({ mood: MOOD_SCALE, stress: STRESS_SCALE });
}

// Shared with other date-filtered endpoints (analytics, appointments).
export { dateString };
