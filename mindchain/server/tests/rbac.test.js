import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { bearer, clearDb, createUser, PASSWORD, startDb, stopDb } from './helpers/db.js';
import { createApp } from '../src/app.js';
import { AuditEvent } from '../src/models/AuditEvent.js';
import { User } from '../src/models/User.js';

const app = createApp();

describe('Role-based authorization and therapist verification', () => {
  before(startDb);
  after(stopDb);
  beforeEach(clearDb);

  it('denies admin endpoints to patients and therapists', async () => {
    const { token: patientToken } = await createUser({ role: 'patient' });
    const { token: therapistToken } = await createUser({ role: 'therapist', verificationStatus: 'verified' });
    for (const token of [patientToken, therapistToken]) {
      await request(app).get('/api/admin/therapists/pending').set(bearer(token)).expect(403);
      await request(app).get('/api/admin/users').set(bearer(token)).expect(403);
      await request(app).get('/api/admin/audit').set(bearer(token)).expect(403);
    }
    await request(app).get('/api/admin/users').expect(401);
  });

  it('lets an admin list pending therapists and verify one', async () => {
    const { user: admin, token } = await createUser({ role: 'admin' });
    const { user: therapist } = await createUser({ role: 'therapist' });
    await createUser({ role: 'therapist', verificationStatus: 'verified' });

    const pending = await request(app).get('/api/admin/therapists/pending').set(bearer(token)).expect(200);
    assert.equal(pending.body.total, 1);
    assert.equal(pending.body.items[0].id, therapist._id.toString());

    const res = await request(app)
      .patch(`/api/admin/therapists/${therapist._id}/verification`)
      .set(bearer(token))
      .send({ status: 'verified', note: 'Licence checked' })
      .expect(200);
    assert.equal(res.body.user.verificationStatus, 'verified');

    const stored = await User.findById(therapist._id);
    assert.ok(stored.verifiedBy.equals(admin._id));
    assert.equal(await AuditEvent.countDocuments({ eventType: 'therapist_verified', subject: therapist._id }), 1);
  });

  it('refuses to verify a non-therapist and validates ids', async () => {
    const { token } = await createUser({ role: 'admin' });
    const { user: patient } = await createUser({ role: 'patient' });
    await request(app)
      .patch(`/api/admin/therapists/${patient._id}/verification`)
      .set(bearer(token))
      .send({ status: 'verified' })
      .expect(404);
    await request(app)
      .patch('/api/admin/therapists/not-an-id/verification')
      .set(bearer(token))
      .send({ status: 'verified' })
      .expect(400);
  });

  it('only lists verified, active therapists in the directory, without licence numbers', async () => {
    const { token } = await createUser({ role: 'patient' });
    await createUser({ role: 'therapist' }); // pending
    await createUser({ role: 'therapist', verificationStatus: 'rejected' });
    await createUser({ role: 'therapist', verificationStatus: 'verified', accountStatus: 'suspended' });
    const { user: ok } = await createUser({ role: 'therapist', verificationStatus: 'verified' });

    const res = await request(app).get('/api/therapists').set(bearer(token)).expect(200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0].id, ok._id.toString());
    assert.equal(res.body.items[0].licenseNumber, undefined);
    assert.equal(JSON.stringify(res.body).includes('LIC-001'), false);
  });

  it('lets a rejected therapist resubmit details for verification', async () => {
    const { user, token } = await createUser({ role: 'therapist', verificationStatus: 'rejected' });
    const res = await request(app)
      .put('/api/therapists/me/verification')
      .set(bearer(token))
      .send({
        therapistProfile: {
          licenseNumber: 'NEW-999',
          licensingBody: 'Board',
          specialization: 'Trauma',
          yearsOfExperience: 3,
        },
      })
      .expect(200);
    assert.equal(res.body.user.verificationStatus, 'pending');
    assert.equal((await User.findById(user._id)).therapistProfile.licenseNumber, 'NEW-999');
  });

  it('suspension blocks existing sessions immediately and reactivation restores login', async () => {
    const { token: adminToken } = await createUser({ role: 'admin' });
    const { user, token } = await createUser({ role: 'patient' });

    await request(app).get('/api/auth/me').set(bearer(token)).expect(200);
    await request(app)
      .patch(`/api/admin/users/${user._id}/status`)
      .set(bearer(adminToken))
      .send({ accountStatus: 'suspended' })
      .expect(200);
    await request(app).get('/api/auth/me').set(bearer(token)).expect(401);

    await request(app)
      .patch(`/api/admin/users/${user._id}/status`)
      .set(bearer(adminToken))
      .send({ accountStatus: 'active' })
      .expect(200);
    await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
  });

  it('prevents admins from suspending themselves or other admins', async () => {
    const { user: admin, token } = await createUser({ role: 'admin' });
    const { user: other } = await createUser({ role: 'admin' });
    await request(app)
      .patch(`/api/admin/users/${admin._id}/status`)
      .set(bearer(token))
      .send({ accountStatus: 'suspended' })
      .expect(400);
    await request(app)
      .patch(`/api/admin/users/${other._id}/status`)
      .set(bearer(token))
      .send({ accountStatus: 'suspended' })
      .expect(400);
  });

  it('exposes audit events to admins without sensitive fields', async () => {
    const { token } = await createUser({ role: 'admin' });
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Patient P', email: 'p@example.com', password: PASSWORD, role: 'patient' })
      .expect(201);
    const res = await request(app).get('/api/admin/audit').set(bearer(token)).expect(200);
    assert.ok(res.body.items.some((e) => e.eventType === 'user_registered'));
    const text = JSON.stringify(res.body);
    assert.equal(text.includes(PASSWORD), false);
    assert.equal(text.includes('passwordHash'), false);
    assert.equal(text.includes('p@example.com'), false);
  });
});
