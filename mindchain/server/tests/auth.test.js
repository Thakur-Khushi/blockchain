import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { bearer, clearDb, createUser, PASSWORD, startDb, stopDb } from './helpers/db.js';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { AuditEvent } from '../src/models/AuditEvent.js';

const app = createApp();

const therapistProfile = {
  licenseNumber: 'PSY-12345',
  licensingBody: 'National Psychology Board',
  specialization: 'Anxiety and stress',
  yearsOfExperience: 7,
};

describe('Authentication', () => {
  before(startDb);
  after(stopDb);
  beforeEach(clearDb);

  describe('POST /api/auth/register', () => {
    it('registers a patient, hashes the password and never returns it', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Asha Patel', email: 'Asha@Example.com', password: PASSWORD, role: 'patient' })
        .expect(201);

      assert.ok(res.body.token);
      assert.equal(res.body.user.email, 'asha@example.com');
      assert.equal(res.body.user.role, 'patient');
      assert.equal(res.body.user.passwordHash, undefined);
      assert.equal(res.body.user.tokenVersion, undefined);

      const stored = await User.findOne({ email: 'asha@example.com' }).select('+passwordHash');
      assert.notEqual(stored.passwordHash, PASSWORD);
      assert.match(stored.passwordHash, /^\$2[aby]\$/);
    });

    it('registers a therapist as pending verification', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Dr Rao', email: 'rao@example.com', password: PASSWORD, role: 'therapist', therapistProfile })
        .expect(201);
      assert.equal(res.body.user.verificationStatus, 'pending');
      assert.equal(res.body.user.therapistProfile.licenseNumber, 'PSY-12345');
    });

    it('rejects therapist registration without professional details', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Dr X', email: 'x@example.com', password: PASSWORD, role: 'therapist' })
        .expect(400);
      assert.equal(res.body.error.code, 'BAD_REQUEST');
    });

    it('does not allow self-registration as admin', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({ name: 'Eve', email: 'eve@example.com', password: PASSWORD, role: 'admin' })
        .expect(400);
      assert.equal(await User.countDocuments({ role: 'admin' }), 0);
    });

    it('rejects duplicate emails (case-insensitive)', async () => {
      const body = { name: 'Asha', email: 'dup@example.com', password: PASSWORD, role: 'patient' };
      await request(app).post('/api/auth/register').send(body).expect(201);
      await request(app)
        .post('/api/auth/register')
        .send({ ...body, email: 'DUP@example.com' })
        .expect(409);
    });

    it('validates email and password strength', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'A', email: 'not-an-email', password: 'short', role: 'patient' })
        .expect(400);
      const fields = res.body.error.details.map((d) => d.field);
      assert.ok(fields.includes('email'));
      assert.ok(fields.includes('password'));
      assert.ok(fields.includes('name'));
    });

    it('rejects query-operator injection in login email', async () => {
      await createUser({ email: 'victim@example.com' });
      await request(app)
        .post('/api/auth/login')
        .send({ email: { $gt: '' }, password: PASSWORD })
        .expect(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('logs in with valid credentials and records an audit event', async () => {
      const { user } = await createUser({ email: 'login@example.com' });
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'login@example.com', password: PASSWORD })
        .expect(200);
      assert.ok(res.body.token);
      assert.equal(res.body.user.id, user._id.toString());
      assert.equal(await AuditEvent.countDocuments({ eventType: 'login_success', actor: user._id }), 1);
    });

    it('returns the same generic error for wrong password and unknown email', async () => {
      await createUser({ email: 'known@example.com' });
      const wrongPwd = await request(app)
        .post('/api/auth/login')
        .send({ email: 'known@example.com', password: 'Wrong1234' })
        .expect(401);
      const unknown = await request(app)
        .post('/api/auth/login')
        .send({ email: 'unknown@example.com', password: 'Wrong1234' })
        .expect(401);
      assert.equal(wrongPwd.body.error.message, unknown.body.error.message);
    });

    it('blocks suspended accounts', async () => {
      await createUser({ email: 'sus@example.com', accountStatus: 'suspended' });
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'sus@example.com', password: PASSWORD })
        .expect(403);
    });
  });

  describe('GET /api/auth/me and logout', () => {
    it('requires a bearer token', async () => {
      await request(app).get('/api/auth/me').expect(401);
      await request(app).get('/api/auth/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
    });

    it('returns the current user', async () => {
      const { user, token } = await createUser();
      const res = await request(app).get('/api/auth/me').set(bearer(token)).expect(200);
      assert.equal(res.body.user.id, user._id.toString());
    });

    it('invalidates the token after logout', async () => {
      const { token } = await createUser();
      await request(app).post('/api/auth/logout').set(bearer(token)).expect(204);
      await request(app).get('/api/auth/me').set(bearer(token)).expect(401);
    });

    it('rejects tokens for deleted users', async () => {
      const { user, token } = await createUser();
      await User.deleteOne({ _id: user._id });
      await request(app).get('/api/auth/me').set(bearer(token)).expect(401);
    });
  });

  describe('rate limiting', () => {
    it('limits repeated login attempts', async () => {
      const limitedApp = createApp({ authRateLimitMax: 3 });
      const attempt = () =>
        request(limitedApp).post('/api/auth/login').send({ email: 'a@example.com', password: 'Wrong1234' });
      for (let i = 0; i < 3; i += 1) assert.equal((await attempt()).status, 401);
      const res = await attempt();
      assert.equal(res.status, 429);
      assert.equal(res.body.error.code, 'TOO_MANY_REQUESTS');
    });
  });

  describe('security headers and errors', () => {
    it('sets security headers and no-store caching', async () => {
      const res = await request(app).get('/api/health').expect(200);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.equal(res.headers['x-powered-by'], undefined);
    });

    it('returns consistent JSON errors for unknown routes and malformed JSON', async () => {
      const nf = await request(app).get('/api/nope').expect(404);
      assert.equal(nf.body.error.code, 'NOT_FOUND');
      const bad = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email":')
        .expect(400);
      assert.equal(bad.body.error.code, 'BAD_REQUEST');
    });

    it('does not allow cross-origin requests from unknown origins', async () => {
      const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
      assert.equal(res.headers['access-control-allow-origin'], undefined);
      const ok = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
      assert.equal(ok.headers['access-control-allow-origin'], 'http://localhost:5173');
    });
  });
});
