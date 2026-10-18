import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { bearer, clearDb, createUser, startDb, stopDb } from './helpers/db.js';
import { createApp } from '../src/app.js';
import { Appointment } from '../src/models/Appointment.js';
import { AuditEvent } from '../src/models/AuditEvent.js';

const app = createApp();

// A slot `days` ahead at the given UTC hour, on a 15-minute boundary.
function slot(days = 2, hour = 10, minute = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

async function setup() {
  const patient = await createUser({ role: 'patient' });
  const therapist = await createUser({ role: 'therapist', verificationStatus: 'verified' });
  return { patient, therapist };
}

const book = (token, body) => request(app).post('/api/appointments').set(bearer(token)).send(body);
const act = (token, id, action) => request(app).patch(`/api/appointments/${id}`).set(bearer(token)).send({ action });

describe('Appointments', () => {
  before(startDb);
  after(stopDb);
  beforeEach(clearDb);

  it('lets a patient request an appointment with a verified therapist and encrypts the note', async () => {
    const { patient, therapist } = await setup();
    const res = await book(patient.token, {
      therapistId: therapist.user._id.toString(),
      scheduledAt: slot(),
      durationMinutes: 45,
      mode: 'online',
      note: 'Want to talk about sleep (note-marker-55)',
    }).expect(201);
    const a = res.body.appointment;
    assert.equal(a.status, 'requested');
    assert.equal(a.therapist.name, therapist.user.name);
    assert.equal(a.note, 'Want to talk about sleep (note-marker-55)');
    assert.equal(new Date(a.endsAt) - new Date(a.scheduledAt), 45 * 60000);

    const raw = await mongoose.connection.db.collection('appointments').findOne({});
    assert.equal(JSON.stringify(raw).includes('note-marker-55'), false);
    assert.ok(raw.note.ciphertext);
    assert.equal(await AuditEvent.countDocuments({ eventType: 'appointment_created' }), 1);
  });

  it('validates date, time and duration', async () => {
    const { patient, therapist } = await setup();
    const base = { therapistId: therapist.user._id.toString(), durationMinutes: 30 };
    const past = new Date(Date.now() - 86400000);
    past.setUTCMinutes(0, 0, 0);
    await book(patient.token, { ...base, scheduledAt: past.toISOString() }).expect(400);
    const soon = new Date(Date.now() + 10 * 60000);
    soon.setUTCMinutes(Math.ceil(soon.getUTCMinutes() / 15) * 15, 0, 0);
    if (soon.getTime() < Date.now() + 3600000) await book(patient.token, { ...base, scheduledAt: soon.toISOString() }).expect(400);
    await book(patient.token, { ...base, scheduledAt: slot(2, 10, 7) }).expect(400);
    await book(patient.token, { ...base, scheduledAt: slot(200) }).expect(400);
    await book(patient.token, { ...base, scheduledAt: 'next tuesday' }).expect(400);
    await book(patient.token, { ...base, scheduledAt: slot(), durationMinutes: 20 }).expect(400);
    assert.equal(await Appointment.countDocuments(), 0);
  });

  it('only allows booking verified, active therapists', async () => {
    const { patient } = await setup();
    const pending = await createUser({ role: 'therapist', verificationStatus: 'pending' });
    const suspended = await createUser({ role: 'therapist', verificationStatus: 'verified', accountStatus: 'suspended' });
    const other = await createUser({ role: 'patient' });
    for (const t of [pending, suspended, other]) {
      await book(patient.token, { therapistId: t.user._id.toString(), scheduledAt: slot(), durationMinutes: 30 }).expect(404);
    }
  });

  it('prevents double-booking for therapist and patient', async () => {
    const { patient, therapist } = await setup();
    const other = await createUser({ role: 'patient' });
    const tid = therapist.user._id.toString();
    await book(patient.token, { therapistId: tid, scheduledAt: slot(2, 10), durationMinutes: 60 }).expect(201);
    await book(other.token, { therapistId: tid, scheduledAt: slot(2, 10, 30), durationMinutes: 30 }).expect(409);
    const t2 = await createUser({ role: 'therapist', verificationStatus: 'verified' });
    await book(patient.token, { therapistId: t2.user._id.toString(), scheduledAt: slot(2, 10, 45), durationMinutes: 30 }).expect(409);
    // Back-to-back is fine.
    await book(other.token, { therapistId: tid, scheduledAt: slot(2, 11), durationMinutes: 30 }).expect(201);
  });

  it('enforces role-based transitions', async () => {
    const { patient, therapist } = await setup();
    const { body } = await book(patient.token, { therapistId: therapist.user._id.toString(), scheduledAt: slot(), durationMinutes: 30 }).expect(201);
    const id = body.appointment.id;

    await act(patient.token, id, 'confirm').expect(403);
    await act(therapist.token, id, 'complete').expect(409);
    const confirmed = await act(therapist.token, id, 'confirm').expect(200);
    assert.equal(confirmed.body.appointment.status, 'confirmed');
    await act(therapist.token, id, 'confirm').expect(409);
    await act(therapist.token, id, 'decline').expect(409);
    await act(therapist.token, id, 'complete').expect(409); // not started yet

    const cancelled = await act(patient.token, id, 'cancel').expect(200);
    assert.equal(cancelled.body.appointment.status, 'cancelled');
    assert.equal(cancelled.body.appointment.cancelledBy, patient.user._id.toString());
    await act(patient.token, id, 'cancel').expect(409);
  });

  it('lets a therapist complete a confirmed appointment after it starts', async () => {
    const { patient, therapist } = await setup();
    const appt = await Appointment.create({
      patient: patient.user._id, therapist: therapist.user._id,
      scheduledAt: new Date(Date.now() - 3600000), endsAt: new Date(Date.now() - 1800000),
      durationMinutes: 30, status: 'confirmed',
    });
    const res = await act(therapist.token, appt._id, 'complete').expect(200);
    assert.equal(res.body.appointment.status, 'completed');
    await act(patient.token, appt._id, 'cancel').expect(409);
  });

  it('isolates appointments between users', async () => {
    const { patient, therapist } = await setup();
    const otherPatient = await createUser({ role: 'patient' });
    const otherTherapist = await createUser({ role: 'therapist', verificationStatus: 'verified' });
    const { body } = await book(patient.token, { therapistId: therapist.user._id.toString(), scheduledAt: slot(), durationMinutes: 30, note: 'secret' }).expect(201);
    const id = body.appointment.id;

    await act(otherPatient.token, id, 'cancel').expect(404);
    await act(otherTherapist.token, id, 'confirm').expect(404);
    const op = await request(app).get('/api/appointments?scope=all').set(bearer(otherPatient.token)).expect(200);
    const ot = await request(app).get('/api/appointments?scope=all').set(bearer(otherTherapist.token)).expect(200);
    assert.equal(op.body.total + ot.body.total, 0);

    const mine = await request(app).get('/api/appointments').set(bearer(therapist.token)).expect(200);
    assert.equal(mine.body.items[0].note, 'secret');
    assert.equal(mine.body.items[0].patient.name, patient.user.name);
  });

  it('blocks admins and unverified therapists', async () => {
    const admin = await createUser({ role: 'admin' });
    const pending = await createUser({ role: 'therapist', verificationStatus: 'pending' });
    await request(app).get('/api/appointments').set(bearer(admin.token)).expect(403);
    await request(app).get('/api/appointments').set(bearer(pending.token)).expect(403);
    await book(pending.token, { therapistId: pending.user._id.toString(), scheduledAt: slot(), durationMinutes: 30 }).expect(403);
  });

  it('splits upcoming and past and rejects a confirm that clashes with a confirmed slot', async () => {
    const { patient, therapist } = await setup();
    const other = await createUser({ role: 'patient' });
    await Appointment.create({
      patient: patient.user._id, therapist: therapist.user._id,
      scheduledAt: new Date(Date.now() - 7 * 86400000), endsAt: new Date(Date.now() - 7 * 86400000 + 1800000),
      durationMinutes: 30, status: 'completed',
    });
    // Two pending requests for the same slot (created directly; booking would block the second).
    const at = new Date(slot(3, 9));
    const mk = (p) => Appointment.create({ patient: p, therapist: therapist.user._id, scheduledAt: at, endsAt: new Date(at.getTime() + 1800000), durationMinutes: 30 });
    const a1 = await mk(patient.user._id);
    const a2 = await mk(other.user._id);
    await act(therapist.token, a1._id, 'confirm').expect(200);
    await act(therapist.token, a2._id, 'confirm').expect(409);

    const up = await request(app).get('/api/appointments?scope=upcoming').set(bearer(patient.token)).expect(200);
    const past = await request(app).get('/api/appointments?scope=past').set(bearer(patient.token)).expect(200);
    assert.equal(up.body.total, 1);
    assert.equal(past.body.total, 1);
    assert.equal(past.body.items[0].status, 'completed');
  });
});
