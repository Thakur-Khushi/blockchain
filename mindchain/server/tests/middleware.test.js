import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { bearer, clearDb, createUser, startDb, stopDb } from './helpers/db.js';
import { authenticate, authorize, requireVerifiedTherapist } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

// Minimal app exercising the guards that Phase 6 routes depend on.
const app = express();
app.get('/therapist-only', authenticate, requireVerifiedTherapist, (_req, res) => res.json({ ok: true }));
app.get('/patient-only', authenticate, authorize('patient'), (_req, res) => res.json({ ok: true }));
app.use(errorHandler);

describe('Auth middleware guards', () => {
  before(startDb);
  after(stopDb);
  beforeEach(clearDb);

  it('blocks therapists until an admin verifies them', async () => {
    for (const status of ['pending', 'rejected']) {
      const { token } = await createUser({ role: 'therapist', verificationStatus: status });
      const res = await request(app).get('/therapist-only').set(bearer(token)).expect(403);
      assert.match(res.body.error.message, /verification/);
    }
    const { token } = await createUser({ role: 'therapist', verificationStatus: 'verified' });
    await request(app).get('/therapist-only').set(bearer(token)).expect(200);
  });

  it('blocks non-therapists from therapist routes, even a wallet-holding patient', async () => {
    const { token } = await createUser({
      role: 'patient',
      walletAddress: '0x' + 'a'.repeat(40),
    });
    await request(app).get('/therapist-only').set(bearer(token)).expect(403);
  });

  it('enforces role lists', async () => {
    const { token: p } = await createUser({ role: 'patient' });
    const { token: a } = await createUser({ role: 'admin' });
    await request(app).get('/patient-only').set(bearer(p)).expect(200);
    await request(app).get('/patient-only').set(bearer(a)).expect(403);
  });

  it('rejects a suspended account even with an otherwise valid token', async () => {
    const { token } = await createUser({ role: 'patient', accountStatus: 'suspended' });
    const res = await request(app).get('/patient-only').set(bearer(token)).expect(403);
    assert.match(res.body.error.message, /suspended/);
  });
});
