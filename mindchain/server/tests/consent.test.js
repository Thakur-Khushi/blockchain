import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import request from 'supertest';
import { bearer, clearDb, createUser, startDb, stopDb } from './helpers/db.js';
import { createFakeChain } from './helpers/fakeChain.js';
import { createApp } from '../src/app.js';
import { AuditEvent } from '../src/models/AuditEvent.js';
import { User } from '../src/models/User.js';

let chain;
let app;
const JOURNAL = 'consent-test-journal-marker';
const wallet = () => Wallet.createRandom().address.toLowerCase();

async function setup() {
  const patientWallet = wallet();
  const therapistWallet = wallet();
  const patient = await createUser({ role: 'patient', walletAddress: patientWallet });
  const therapist = await createUser({ role: 'therapist', verificationStatus: 'verified', walletAddress: therapistWallet });
  chain.registerPatient(patientWallet);
  await request(app)
    .post('/api/wellness')
    .set(bearer(patient.token))
    .send({ entryDate: new Date().toISOString().slice(0, 10), mood: 4, stress: 8, journal: JOURNAL })
    .expect(201);
  return { patient, therapist, patientWallet, therapistWallet };
}

const records = (token, patientId) => request(app).get(`/api/therapists/patients/${patientId}/records`).set(bearer(token));

describe('Consent-gated therapist access', () => {
  before(startDb);
  after(stopDb);
  beforeEach(async () => {
    await clearDb();
    chain = createFakeChain();
    app = createApp({ chain });
  });

  it('denies access without an on-chain grant and audits the denial', async () => {
    const { patient, therapist } = await setup();
    const res = await records(therapist.token, patient.user._id).expect(403);
    assert.equal(JSON.stringify(res.body).includes(JOURNAL), false);
    const ev = await AuditEvent.findOne({ eventType: 'access_denied', actor: therapist.user._id });
    assert.equal(ev.detail, 'no_consent');
    assert.ok(ev.subject.equals(patient.user._id));
  });

  it('grants access while consent is valid, checking the chain on every request', async () => {
    const { patient, therapist, patientWallet, therapistWallet } = await setup();
    chain.grant(patientWallet, therapistWallet);

    const before = chain.calls.hasAccess;
    const res = await records(therapist.token, patient.user._id).expect(200);
    assert.equal(res.body.items[0].journal, JOURNAL);
    assert.equal(res.body.items[0].integrity.status, 'ok');
    assert.equal(res.body.items[0].anchorHistory, undefined);
    await records(therapist.token, patient.user._id).expect(200);
    assert.equal(chain.calls.hasAccess - before, 2, 'consent must be re-checked per request (no caching)');

    const audit = await AuditEvent.find({ eventType: 'record_access', actor: therapist.user._id });
    assert.equal(audit.length, 2);
    assert.equal(JSON.stringify(audit).includes(JOURNAL), false);
  });

  it('blocks the very next request after revocation', async () => {
    const { patient, therapist, patientWallet, therapistWallet } = await setup();
    chain.grant(patientWallet, therapistWallet);
    await records(therapist.token, patient.user._id).expect(200);
    chain.revoke(patientWallet, therapistWallet);
    await records(therapist.token, patient.user._id).expect(403);
    await request(app).get(`/api/therapists/patients/${patient.user._id}`).set(bearer(therapist.token)).expect(403);
  });

  it('denies access after a time-limited grant expires', async () => {
    const { patient, therapist, patientWallet, therapistWallet } = await setup();
    chain.grant(patientWallet, therapistWallet, Math.floor(Date.now() / 1000) - 1);
    await records(therapist.token, patient.user._id).expect(403);
  });

  it('fails closed when the chain is unavailable', async () => {
    const { patient, therapist, patientWallet, therapistWallet } = await setup();
    chain.grant(patientWallet, therapistWallet);
    chain.down = true;
    const res = await records(therapist.token, patient.user._id).expect(503);
    assert.equal(res.body.error.code, 'CHAIN_UNAVAILABLE');
    assert.equal(JSON.stringify(res.body).includes(JOURNAL), false);
    assert.equal((await AuditEvent.findOne({ eventType: 'access_denied' })).detail, 'chain_unavailable');
  });

  it('scopes a grant to one therapist', async () => {
    const { patient, patientWallet, therapistWallet } = await setup();
    const other = await createUser({ role: 'therapist', verificationStatus: 'verified', walletAddress: wallet() });
    chain.grant(patientWallet, therapistWallet);
    await records(other.token, patient.user._id).expect(403);
  });

  it('requires admin verification even when a patient granted access', async () => {
    const { patient, patientWallet } = await setup();
    const tw = wallet();
    const pending = await createUser({ role: 'therapist', verificationStatus: 'pending', walletAddress: tw });
    chain.grant(patientWallet, tw);
    await records(pending.token, patient.user._id).expect(403);
    await request(app).get('/api/therapists/patients').set(bearer(pending.token)).expect(403);
  });

  it('blocks suspended therapists and suspended patients\' data', async () => {
    const { patient, therapist, patientWallet, therapistWallet } = await setup();
    chain.grant(patientWallet, therapistWallet);
    await User.updateOne({ _id: patient.user._id }, { accountStatus: 'suspended' });
    await records(therapist.token, patient.user._id).expect(403);
    await User.updateOne({ _id: patient.user._id }, { accountStatus: 'active' });
    await User.updateOne({ _id: therapist.user._id }, { accountStatus: 'suspended' });
    await records(therapist.token, patient.user._id).expect(403);
  });

  it('requires the therapist to have a linked wallet', async () => {
    const { patient } = await setup();
    const noWallet = await createUser({ role: 'therapist', verificationStatus: 'verified' });
    const res = await records(noWallet.token, patient.user._id).expect(403);
    assert.match(res.body.error.message, /wallet/i);
  });

  it('gives the same response for unknown patients and non-consenting patients', async () => {
    const { therapist } = await setup();
    const nonPatient = await createUser({ role: 'admin' });
    const a = await records(therapist.token, nonPatient.user._id).expect(403);
    const b = await records(therapist.token, '65f000000000000000000099').expect(403);
    assert.equal(a.body.error.message, b.body.error.message);
    await records(therapist.token, 'not-an-id').expect(404);
  });

  it('never gives admins or patients access to the therapist record endpoint', async () => {
    const { patient, patientWallet } = await setup();
    const admin = await createUser({ role: 'admin', walletAddress: wallet() });
    chain.grant(patientWallet, admin.user.walletAddress);
    await records(admin.token, patient.user._id).expect(403);
    const otherPatient = await createUser({ role: 'patient', walletAddress: wallet() });
    await records(otherPatient.token, patient.user._id).expect(403);
  });

  it('lists only currently consenting patients for a therapist', async () => {
    const { patient, therapist, patientWallet, therapistWallet } = await setup();
    let res = await request(app).get('/api/therapists/patients').set(bearer(therapist.token)).expect(200);
    assert.equal(res.body.items.length, 0);

    chain.grant(patientWallet, therapistWallet);
    res = await request(app).get('/api/therapists/patients').set(bearer(therapist.token)).expect(200);
    assert.deepEqual(res.body.items.map((p) => p.id), [patient.user._id.toString()]);
    assert.equal(res.body.items[0].email, undefined);

    chain.revoke(patientWallet, therapistWallet);
    res = await request(app).get('/api/therapists/patients').set(bearer(therapist.token)).expect(200);
    assert.equal(res.body.items.length, 0);
  });
});

describe('Patient consent management and audit trail', () => {
  before(startDb);
  after(stopDb);
  beforeEach(async () => {
    await clearDb();
    chain = createFakeChain();
    app = createApp({ chain });
  });

  it('lists grants from the chain with therapist details', async () => {
    const { patient, therapist, patientWallet, therapistWallet } = await setup();
    chain.grant(patientWallet, therapistWallet);
    const unknownWallet = wallet();
    chain.grant(patientWallet, unknownWallet);
    chain.revoke(patientWallet, unknownWallet);

    const res = await request(app).get('/api/consents').set(bearer(patient.token)).expect(200);
    const known = res.body.items.find((g) => g.therapistWallet === therapistWallet);
    assert.equal(known.therapist.id, therapist.user._id.toString());
    assert.equal(known.currentlyValid, true);
    const unknown = res.body.items.find((g) => g.therapistWallet === unknownWallet);
    assert.equal(unknown.therapist, null);
    assert.equal(unknown.currentlyValid, false);
    assert.deepEqual(unknown.history.map((h) => h.type), ['granted', 'revoked']);
  });

  it('records consent transactions in the audit trail, once', async () => {
    const { patient, therapist, patientWallet, therapistWallet } = await setup();
    const txHash = chain.grant(patientWallet, therapistWallet);
    const res = await request(app).post('/api/consents/confirm').set(bearer(patient.token)).send({ txHash }).expect(200);
    assert.equal(res.body.recorded[0].type, 'consent_granted');
    await request(app).post('/api/consents/confirm').set(bearer(patient.token)).send({ txHash }).expect(200);
    const events = await AuditEvent.find({ eventType: 'consent_granted', actor: patient.user._id });
    assert.equal(events.length, 1);
    assert.ok(events[0].subject.equals(therapist.user._id));
    assert.equal(events[0].txHash, txHash);
  });

  it('rejects failed and foreign consent transactions', async () => {
    const { patient, patientWallet } = await setup();
    const failed = chain.addTx({ from: patientWallet, success: false });
    await request(app).post('/api/consents/confirm').set(bearer(patient.token)).send({ txHash: failed }).expect(422);
    const other = await createUser({ role: 'patient', walletAddress: wallet() });
    const foreign = chain.grant(other.user.walletAddress, wallet());
    await request(app).post('/api/consents/confirm').set(bearer(patient.token)).send({ txHash: foreign }).expect(400);
  });

  it('shows patients who accessed their records, and transaction history', async () => {
    const { patient, therapist, patientWallet, therapistWallet } = await setup();
    const txHash = chain.grant(patientWallet, therapistWallet);
    await request(app).post('/api/consents/confirm').set(bearer(patient.token)).send({ txHash }).expect(200);
    await records(therapist.token, patient.user._id).expect(200);

    const res = await request(app).get('/api/audit/me').set(bearer(patient.token)).expect(200);
    const access = res.body.items.find((e) => e.eventType === 'record_access');
    assert.equal(access.actor.name, therapist.user.name);
    assert.equal(JSON.stringify(res.body).includes(JOURNAL), false);

    const txs = await request(app).get('/api/audit/me?withTx=true').set(bearer(patient.token)).expect(200);
    assert.ok(txs.body.items.length >= 1);
    assert.ok(txs.body.items.every((e) => e.txHash));

    // Another patient sees none of it.
    const stranger = await createUser({ role: 'patient' });
    const s = await request(app).get('/api/audit/me').set(bearer(stranger.token)).expect(200);
    assert.equal(s.body.items.filter((e) => e.eventType === 'record_access').length, 0);
  });

  it('restricts consent endpoints to patients', async () => {
    const { therapist } = await setup();
    await request(app).get('/api/consents').set(bearer(therapist.token)).expect(403);
  });
});
