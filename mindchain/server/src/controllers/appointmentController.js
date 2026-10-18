import mongoose from 'mongoose';
import { z } from 'zod';
import { ACTIVE_STATUSES, APPOINTMENT_MODES, APPOINTMENT_STATUSES, Appointment } from '../models/Appointment.js';
import { User } from '../models/User.js';
import { recordAudit } from '../services/auditService.js';
import { cipherSuite, IntegrityError } from '../services/cryptoService.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/AppError.js';
import { pageMeta, paginate, paginationSchema } from '../utils/pagination.js';
import { objectId, safeText } from '../utils/validators.js';

const HOUR_MS = 3600000;
const MIN_LEAD_MS = HOUR_MS; // book at least one hour ahead
const MAX_AHEAD_MS = 180 * 24 * HOUR_MS; // and at most ~6 months ahead

export const createBody = z.object({
  therapistId: objectId,
  scheduledAt: z.iso.datetime({ offset: true, message: 'scheduledAt must be an ISO 8601 date-time' }),
  durationMinutes: z.coerce.number().refine((v) => [30, 45, 60, 90].includes(v), 'Duration must be 30, 45, 60 or 90 minutes'),
  mode: z.enum(APPOINTMENT_MODES).default('online'),
  note: safeText(500).optional(),
});

export const listQuery = paginationSchema.extend({
  scope: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
});

export const idParams = z.object({ id: objectId });

export const updateBody = z.object({ action: z.enum(['confirm', 'decline', 'cancel', 'complete']) });

// Which role may perform which action, from which status.
const TRANSITIONS = {
  therapist: {
    confirm: { from: ['requested'], to: 'confirmed', future: true },
    decline: { from: ['requested'], to: 'declined' },
    cancel: { from: ['confirmed'], to: 'cancelled', future: true },
    complete: { from: ['confirmed'], to: 'completed', past: true },
  },
  patient: {
    cancel: { from: ['requested', 'confirmed'], to: 'cancelled', future: true },
  },
};

const noteContext = (appointmentId, patientId) => ({ recordId: `appointment:${appointmentId}`, patientId: String(patientId) });

function decryptNote(appt) {
  if (!appt.note?.ciphertext) return { note: null, noteIntegrity: null };
  try {
    const value = cipherSuite.decryptJson(
      { ciphertext: appt.note.ciphertext, iv: appt.note.iv, authTag: appt.note.authTag, keyVersion: appt.note.keyVersion },
      noteContext(appt._id, appt.patient._id ?? appt.patient),
    );
    return { note: value.text, noteIntegrity: 'ok' };
  } catch (err) {
    if (err instanceof IntegrityError) return { note: null, noteIntegrity: 'tampered' };
    throw err;
  }
}

function serialize(appt) {
  const p = appt.patient;
  const t = appt.therapist;
  return {
    id: appt._id.toString(),
    patient: { id: (p._id ?? p).toString(), name: p.name ?? null },
    therapist: { id: (t._id ?? t).toString(), name: t.name ?? null, specialization: t.therapistProfile?.specialization ?? null },
    scheduledAt: appt.scheduledAt,
    endsAt: appt.endsAt,
    durationMinutes: appt.durationMinutes,
    mode: appt.mode,
    status: appt.status,
    cancelledBy: appt.cancelledBy ? appt.cancelledBy.toString() : null,
    statusChangedAt: appt.statusChangedAt ?? null,
    createdAt: appt.createdAt,
    ...decryptNote(appt),
  };
}

async function hasOverlap(field, userId, start, end, excludeId) {
  const filter = {
    [field]: userId,
    status: { $in: ACTIVE_STATUSES },
    scheduledAt: { $lt: end },
    endsAt: { $gt: start },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  return Appointment.exists(filter);
}

function assertTherapistVerified(user) {
  if (user.role === 'therapist' && user.verificationStatus !== 'verified') {
    throw forbidden('Therapist account is awaiting administrator verification');
  }
}

export async function createAppointment(req, res) {
  const body = req.valid.body;
  const start = new Date(body.scheduledAt);
  const now = Date.now();
  if (start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0 || start.getUTCMinutes() % 15 !== 0) {
    throw badRequest('Appointments start on a 15-minute boundary (e.g. 10:00, 10:15)');
  }
  if (start.getTime() < now + MIN_LEAD_MS) throw badRequest('Appointments must be booked at least one hour in advance');
  if (start.getTime() > now + MAX_AHEAD_MS) throw badRequest('Appointments can be booked up to 180 days ahead');
  const end = new Date(start.getTime() + body.durationMinutes * 60000);

  const therapist = await User.findOne({
    _id: body.therapistId,
    role: 'therapist',
    verificationStatus: 'verified',
    accountStatus: 'active',
  });
  if (!therapist) throw notFound('Therapist not found or not available for appointments');

  if (await hasOverlap('therapist', therapist._id, start, end)) throw conflict('The therapist already has an appointment at this time');
  if (await hasOverlap('patient', req.user._id, start, end)) throw conflict('You already have an appointment at this time');

  const _id = new mongoose.Types.ObjectId();
  let note;
  if (body.note) {
    const enc = cipherSuite.encryptJson({ text: body.note }, noteContext(_id, req.user._id));
    note = { ciphertext: enc.ciphertext, iv: enc.iv, authTag: enc.authTag, keyVersion: enc.keyVersion };
  }
  const appt = await Appointment.create({
    _id,
    patient: req.user._id,
    therapist: therapist._id,
    scheduledAt: start,
    endsAt: end,
    durationMinutes: body.durationMinutes,
    mode: body.mode,
    note,
    statusChangedAt: new Date(),
  });
  await recordAudit({ eventType: 'appointment_created', actor: req.user._id, subject: therapist._id });

  await appt.populate([{ path: 'patient', select: 'name' }, { path: 'therapist', select: 'name therapistProfile.specialization' }]);
  res.status(201).json({ appointment: serialize(appt) });
}

export async function listAppointments(req, res) {
  assertTherapistVerified(req.user);
  const q = req.valid.query;
  const filter = { [req.user.role]: req.user._id };
  if (q.status) filter.status = q.status;
  const now = new Date();
  let sort = { scheduledAt: -1 };
  if (q.scope === 'upcoming') {
    filter.endsAt = { $gte: now };
    sort = { scheduledAt: 1 };
  } else if (q.scope === 'past') {
    filter.endsAt = { $lt: now };
  }
  const [docs, total] = await Promise.all([
    Appointment.find(filter)
      .sort(sort)
      .skip(paginate(q).skip)
      .limit(q.limit)
      .populate('patient', 'name')
      .populate('therapist', 'name therapistProfile.specialization'),
    Appointment.countDocuments(filter),
  ]);
  res.json({ items: docs.map(serialize), ...pageMeta(q, total) });
}

export async function updateAppointment(req, res) {
  assertTherapistVerified(req.user);
  const { id } = req.valid.params;
  const { action } = req.valid.body;
  // Only participants can see or change an appointment (others get 404).
  const appt = await Appointment.findOne({ _id: id, [req.user.role]: req.user._id });
  if (!appt) throw notFound('Appointment not found');

  const rule = TRANSITIONS[req.user.role]?.[action];
  if (!rule) throw forbidden(`A ${req.user.role} cannot ${action} an appointment`);
  if (!rule.from.includes(appt.status)) throw conflict(`Cannot ${action} an appointment that is ${appt.status}`);
  const now = Date.now();
  if (rule.future && appt.scheduledAt.getTime() <= now) throw conflict(`Cannot ${action} an appointment that has already started`);
  if (rule.past && appt.scheduledAt.getTime() > now) throw conflict('An appointment can only be completed after it has started');
  if (action === 'confirm') {
    // Another request for an overlapping slot may already have been confirmed.
    const clash = await Appointment.exists({
      _id: { $ne: appt._id },
      therapist: appt.therapist,
      status: 'confirmed',
      scheduledAt: { $lt: appt.endsAt },
      endsAt: { $gt: appt.scheduledAt },
    });
    if (clash) throw conflict('You already have a confirmed appointment that overlaps this time');
  }

  appt.status = rule.to;
  appt.statusChangedAt = new Date();
  if (rule.to === 'cancelled') appt.cancelledBy = req.user._id;
  await appt.save();
  await recordAudit({
    eventType: 'appointment_updated',
    actor: req.user._id,
    subject: req.user.role === 'patient' ? appt.therapist : appt.patient,
    detail: action,
  });

  await appt.populate([{ path: 'patient', select: 'name' }, { path: 'therapist', select: 'name therapistProfile.specialization' }]);
  res.json({ appointment: serialize(appt) });
}
