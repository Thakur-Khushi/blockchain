import { z } from 'zod';
import { WellnessRecord } from '../models/WellnessRecord.js';
import { recordAudit } from '../services/auditService.js';
import { newRecordId } from '../services/recordDigest.js';
import { openRecord, sealRecord, serializeRecord } from '../services/wellnessRecordService.js';
import { conflict, notFound } from '../utils/AppError.js';
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

export function scale(_req, res) {
  res.json({ mood: MOOD_SCALE, stress: STRESS_SCALE });
}

// Shared with other date-filtered endpoints (analytics, appointments).
export { dateString };
