import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { bearer, clearDb, createUser, startDb, stopDb } from './helpers/db.js';
import { createApp } from '../src/app.js';
import { AuditEvent } from '../src/models/AuditEvent.js';
import { WellnessRecord } from '../src/models/WellnessRecord.js';

const app = createApp();
const SECRET_JOURNAL = 'I had a panic attack at work today (secret-marker-7731)';

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

function createEntry(token, overrides = {}) {
  return request(app)
    .post('/api/wellness')
    .set(bearer(token))
    .send({ entryDate: daysAgo(0), mood: 6, stress: 4, journal: SECRET_JOURNAL, tags: ['Work', 'work', 'sleep'], ...overrides });
}

describe('Wellness records API', () => {
  before(startDb);
  after(stopDb);
  beforeEach(clearDb);

  describe('create', () => {
    it('creates an encrypted record with a pending chain status', async () => {
      const { user, token } = await createUser();
      const res = await createEntry(token).expect(201);
      const r = res.body.record;
      assert.match(r.recordId, /^0x[a-f0-9]{64}$/);
      assert.match(r.digest, /^0x[a-f0-9]{64}$/);
      assert.equal(r.mood, 6);
      assert.equal(r.journal, SECRET_JOURNAL);
      assert.deepEqual(r.tags, ['sleep', 'work']);
      assert.equal(r.chainStatus, 'pending');
      assert.equal(r.txHash, null);
      assert.equal(r.integrity.status, 'ok');
      assert.equal(r.salt, undefined);
      assert.equal(await AuditEvent.countDocuments({ eventType: 'record_created', actor: user._id }), 1);
    });

    it('stores no plaintext health data in MongoDB', async () => {
      const { token } = await createUser();
      const { body } = await createEntry(token).expect(201);
      const raw = await mongoose.connection.db.collection('wellnessrecords').findOne({ recordId: body.record.recordId });
      const text = JSON.stringify(raw);
      assert.equal(text.includes('secret-marker-7731'), false);
      assert.equal(text.includes('panic'), false);
      for (const k of ['mood', 'stress', 'journal', 'tags', 'salt']) assert.equal(k in raw, false, `${k} leaked`);
      assert.ok(raw.encryptedPayload && raw.iv && raw.authTag);
    });

    it('does not put journal content in audit events', async () => {
      const { token } = await createUser();
      await createEntry(token).expect(201);
      const events = await AuditEvent.find().lean();
      assert.equal(JSON.stringify(events).includes('secret-marker'), false);
    });

    it('validates scores, dates, journal length and tags', async () => {
      const { token } = await createUser();
      const cases = [
        { mood: 0 }, { mood: 11 }, { stress: 3.5 }, { stress: 'high' },
        { entryDate: '2026-02-30' }, { entryDate: '10/01/2026' }, { entryDate: daysAgo(-5) },
        { journal: 'x'.repeat(5001) }, { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) },
        { tags: ['<script>'] },
      ];
      for (const c of cases) {
        const res = await createEntry(token, c);
        assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(c).slice(0, 60)}`);
      }
      assert.equal(await WellnessRecord.countDocuments(), 0);
    });

    it('allows only one check-in per day', async () => {
      const { token } = await createUser();
      await createEntry(token).expect(201);
      await createEntry(token).expect(409);
      await createEntry(token, { entryDate: daysAgo(1) }).expect(201);
    });
  });

  describe('list and read', () => {
    it('lists own records newest first with pagination and date filters', async () => {
      const { token } = await createUser();
      for (let i = 0; i < 5; i += 1) await createEntry(token, { entryDate: daysAgo(i), mood: i + 1 }).expect(201);

      const page1 = await request(app).get('/api/wellness?limit=2&page=1').set(bearer(token)).expect(200);
      assert.equal(page1.body.total, 5);
      assert.equal(page1.body.totalPages, 3);
      assert.deepEqual(page1.body.items.map((r) => r.entryDate), [daysAgo(0), daysAgo(1)]);

      const ranged = await request(app)
        .get(`/api/wellness?from=${daysAgo(3)}&to=${daysAgo(1)}`)
        .set(bearer(token))
        .expect(200);
      assert.deepEqual(ranged.body.items.map((r) => r.mood), [2, 3, 4]);

      await request(app).get(`/api/wellness?from=${daysAgo(0)}&to=${daysAgo(3)}`).set(bearer(token)).expect(400);
      await request(app).get('/api/wellness?limit=1000').set(bearer(token)).expect(400);
    });

    it('returns a single record by id', async () => {
      const { token } = await createUser();
      const { body } = await createEntry(token).expect(201);
      const res = await request(app).get(`/api/wellness/${body.record.recordId}`).set(bearer(token)).expect(200);
      assert.equal(res.body.record.journal, SECRET_JOURNAL);
      await request(app).get('/api/wellness/123').set(bearer(token)).expect(400);
      await request(app).get(`/api/wellness/0x${'1'.repeat(64)}`).set(bearer(token)).expect(404);
    });
  });

  describe('patient record isolation', () => {
    it('prevents a patient from reading, editing or deleting another patient\'s record', async () => {
      const alice = await createUser();
      const bob = await createUser();
      const { body } = await createEntry(alice.token).expect(201);
      const id = body.record.recordId;

      await request(app).get(`/api/wellness/${id}`).set(bearer(bob.token)).expect(404);
      await request(app).patch(`/api/wellness/${id}`).set(bearer(bob.token)).send({ mood: 1 }).expect(404);
      await request(app).delete(`/api/wellness/${id}`).set(bearer(bob.token)).expect(404);

      const bobList = await request(app).get('/api/wellness').set(bearer(bob.token)).expect(200);
      assert.equal(bobList.body.total, 0);

      const still = await request(app).get(`/api/wellness/${id}`).set(bearer(alice.token)).expect(200);
      assert.equal(still.body.record.mood, 6);
    });

    it('denies therapists (even verified) and admins access to patient record endpoints', async () => {
      const patient = await createUser();
      const { body } = await createEntry(patient.token).expect(201);
      const therapist = await createUser({ role: 'therapist', verificationStatus: 'verified' });
      const admin = await createUser({ role: 'admin' });
      for (const { token } of [therapist, admin]) {
        await request(app).get('/api/wellness').set(bearer(token)).expect(403);
        await request(app).get(`/api/wellness/${body.record.recordId}`).set(bearer(token)).expect(403);
        await createEntry(token).expect(403);
      }
      await request(app).get('/api/wellness').expect(401);
    });

    it('ignores a patient id supplied in the request body', async () => {
      const alice = await createUser();
      const bob = await createUser();
      await createEntry(alice.token, { patient: bob.user._id.toString() }).expect(201);
      assert.equal(await WellnessRecord.countDocuments({ patient: bob.user._id }), 0);
      assert.equal(await WellnessRecord.countDocuments({ patient: alice.user._id }), 1);
    });
  });

  describe('update and delete', () => {
    it('re-encrypts with a new digest, bumps the version and resets chain status', async () => {
      const { token } = await createUser();
      const { body } = await createEntry(token).expect(201);
      const id = body.record.recordId;
      await WellnessRecord.updateOne({ recordId: id }, { chainStatus: 'anchored', txHash: '0x' + 'ab'.repeat(32) });

      const res = await request(app)
        .patch(`/api/wellness/${id}`)
        .set(bearer(token))
        .send({ mood: 9, journal: 'Better today' })
        .expect(200);
      const r = res.body.record;
      assert.equal(r.mood, 9);
      assert.equal(r.stress, 4);
      assert.equal(r.journal, 'Better today');
      assert.equal(r.version, 2);
      assert.notEqual(r.digest, body.record.digest);
      assert.equal(r.chainStatus, 'pending');
      assert.equal(r.txHash, null);
      assert.equal(r.integrity.status, 'ok');

      await request(app).patch(`/api/wellness/${id}`).set(bearer(token)).send({}).expect(400);
      await request(app).patch(`/api/wellness/${id}`).set(bearer(token)).send({ mood: 42 }).expect(400);
    });

    it('crypto-shreds on delete, keeps a tombstone and frees the date', async () => {
      const { token } = await createUser();
      const { body } = await createEntry(token).expect(201);
      const id = body.record.recordId;

      await request(app).delete(`/api/wellness/${id}`).set(bearer(token)).expect(204);
      await request(app).get(`/api/wellness/${id}`).set(bearer(token)).expect(404);

      const raw = await mongoose.connection.db.collection('wellnessrecords').findOne({ recordId: id });
      assert.equal(raw.isDeleted, true);
      assert.equal(raw.encryptedPayload, undefined);
      assert.equal(raw.iv, undefined);
      assert.equal(raw.authTag, undefined);
      assert.equal(raw.digest, body.record.digest);

      await createEntry(token).expect(201);
    });
  });

  describe('tamper detection', () => {
    async function setup() {
      const alice = await createUser();
      const { body } = await createEntry(alice.token).expect(201);
      return { ...alice, id: body.record.recordId };
    }

    it('flags modified ciphertext and withholds content', async () => {
      const { token, id } = await setup();
      const doc = await WellnessRecord.findOne({ recordId: id });
      const buf = Buffer.from(doc.encryptedPayload, 'base64');
      buf[3] ^= 0xff;
      await WellnessRecord.updateOne({ recordId: id }, { encryptedPayload: buf.toString('base64') });

      const res = await request(app).get(`/api/wellness/${id}`).set(bearer(token)).expect(200);
      assert.deepEqual(res.body.record.integrity, { status: 'tampered', reason: 'decryption_failed' });
      assert.equal(res.body.record.journal, undefined);
      assert.equal(res.body.record.mood, undefined);

      const list = await request(app).get('/api/wellness').set(bearer(token)).expect(200);
      assert.equal(list.body.items[0].integrity.status, 'tampered');
    });

    it('flags a modified stored digest', async () => {
      const { token, id } = await setup();
      await WellnessRecord.updateOne({ recordId: id }, { digest: '0x' + 'f'.repeat(64) });
      const res = await request(app).get(`/api/wellness/${id}`).set(bearer(token)).expect(200);
      assert.deepEqual(res.body.record.integrity, { status: 'tampered', reason: 'digest_mismatch' });
    });

    it('flags ciphertext copied from another patient\'s record', async () => {
      const alice = await setup();
      const bob = await createUser();
      const { body } = await createEntry(bob.token, { journal: 'bob private' }).expect(201);
      const bobDoc = await WellnessRecord.findOne({ recordId: body.record.recordId });
      await WellnessRecord.updateOne(
        { recordId: alice.id },
        { encryptedPayload: bobDoc.encryptedPayload, iv: bobDoc.iv, authTag: bobDoc.authTag, digest: bobDoc.digest },
      );
      const res = await request(app).get(`/api/wellness/${alice.id}`).set(bearer(alice.token)).expect(200);
      assert.equal(res.body.record.integrity.status, 'tampered');
      assert.equal(JSON.stringify(res.body).includes('bob private'), false);
    });

    it('refuses to edit a tampered record', async () => {
      const { token, id } = await setup();
      await WellnessRecord.updateOne({ recordId: id }, { digest: '0x' + 'f'.repeat(64) });
      await request(app).patch(`/api/wellness/${id}`).set(bearer(token)).send({ mood: 2 }).expect(409);
    });
  });
});
