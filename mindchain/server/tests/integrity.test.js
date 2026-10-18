import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import request from 'supertest';
import { bearer, clearDb, createUser, startDb, stopDb } from './helpers/db.js';
import { createFakeChain } from './helpers/fakeChain.js';
import { createApp } from '../src/app.js';
import { AuditEvent } from '../src/models/AuditEvent.js';
import { WellnessRecord } from '../src/models/WellnessRecord.js';
import { sealRecord } from '../src/services/wellnessRecordService.js';

let chain;
let app;

const today = () => new Date().toISOString().slice(0, 10);

async function setupPatient() {
  const wallet = Wallet.createRandom().address.toLowerCase();
  const { user, token } = await createUser({ walletAddress: wallet });
  chain.registerPatient(wallet);
  const { body } = await request(app)
    .post('/api/wellness')
    .set(bearer(token))
    .send({ entryDate: today(), mood: 6, stress: 5, journal: 'private words' })
    .expect(201);
  return { user, token, wallet, record: body.record };
}

const anchor = (token, id, txHash) => request(app).post(`/api/wellness/${id}/anchor`).set(bearer(token)).send(txHash ? { txHash } : {});
const verify = (token, id) => request(app).get(`/api/wellness/${id}/verify`).set(bearer(token));

describe('Record anchoring and verification', () => {
  before(startDb);
  after(stopDb);
  beforeEach(async () => {
    await clearDb();
    chain = createFakeChain();
    app = createApp({ chain });
  });

  it('anchors only after the receipt and on-chain state match, then verifies', async () => {
    const { user, token, wallet, record } = await setupPatient();
    assert.equal(record.onChainAction, 'register');
    const txHash = chain.anchor(record.recordId, wallet, record.digest);

    const res = await anchor(token, record.recordId, txHash).expect(200);
    assert.equal(res.body.record.chainStatus, 'anchored');
    assert.equal(res.body.record.txHash, txHash);
    assert.equal(res.body.record.chainId, 31337);
    assert.equal(res.body.record.onChainAction, null);
    assert.deepEqual(res.body.record.anchorHistory.map((h) => h.action), ['registered']);
    assert.equal(await AuditEvent.countDocuments({ eventType: 'record_anchored', actor: user._id, txHash }), 1);

    // Idempotent confirmation.
    await anchor(token, record.recordId, txHash).expect(200);
    assert.equal((await WellnessRecord.findOne({ recordId: record.recordId })).anchorHistory.length, 1);

    const v = await verify(token, record.recordId).expect(200);
    assert.equal(v.body.verification.status, 'verified');
    assert.deepEqual(v.body.verification.checks, { decryption: 'pass', digest: 'pass', onChain: 'pass', owner: 'pass' });
    assert.equal(v.body.verification.record.txHash, txHash);
    assert.equal(v.body.verification.network.chainId, 31337);
  });

  it('reports not_anchored before any transaction', async () => {
    const { token, record } = await setupPatient();
    const v = await verify(token, record.recordId).expect(200);
    assert.equal(v.body.verification.status, 'not_anchored');
    assert.equal(v.body.verification.checks.onChain, 'missing');
  });

  it('rejects unknown, foreign, mismatched and unrelated transactions', async () => {
    const { token, wallet, record } = await setupPatient();
    const other = await setupPatient();

    // Unknown / not mined yet
    await anchor(token, record.recordId, '0x' + 'a'.repeat(64)).expect(409);
    // Sent by a different wallet
    const foreign = chain.anchor(other.record.recordId, other.wallet, other.record.digest);
    await anchor(token, record.recordId, foreign).expect(400);
    // Not sent to the MindChain contract
    const notContract = chain.addTx({ from: wallet, to: '0x' + 'd'.repeat(40) });
    await anchor(token, record.recordId, notContract).expect(400);
    // From the right wallet but with no matching event for this record
    const unrelated = chain.addTx({ from: wallet });
    await anchor(token, record.recordId, unrelated).expect(400);
    // Anchors a different digest for this record
    const wrongDigest = chain.anchor(record.recordId, wallet, '0x' + '9'.repeat(64));
    await anchor(token, record.recordId, wrongDigest).expect(400);

    const doc = await WellnessRecord.findOne({ recordId: record.recordId });
    assert.equal(doc.chainStatus, 'pending');
  });

  it('marks the record failed when the transaction reverted, and never verifies it', async () => {
    const { user, token, wallet, record } = await setupPatient();
    const failed = chain.addTx({ from: wallet, success: false });
    const res = await anchor(token, record.recordId, failed).expect(422);
    assert.equal(res.body.error.code, 'TX_FAILED');
    assert.equal((await WellnessRecord.findOne({ recordId: record.recordId })).chainStatus, 'failed');
    assert.equal(await AuditEvent.countDocuments({ eventType: 'record_anchored', actor: user._id, outcome: 'failure' }), 1);
    assert.equal((await verify(token, record.recordId)).body.verification.status, 'not_anchored');

    // Retrying with a successful transaction recovers.
    const ok = chain.anchor(record.recordId, wallet, record.digest);
    await anchor(token, record.recordId, ok).expect(200);
  });

  it('requires a linked wallet', async () => {
    const { token } = await createUser();
    const { body } = await request(app)
      .post('/api/wellness')
      .set(bearer(token))
      .send({ entryDate: today(), mood: 5, stress: 5 })
      .expect(201);
    await anchor(token, body.record.recordId, '0x' + 'a'.repeat(64)).expect(400);
  });

  it('recovers an anchor from contract events when the tx hash was lost', async () => {
    const { token, wallet, record } = await setupPatient();
    await anchor(token, record.recordId).expect(409);
    const txHash = chain.anchor(record.recordId, wallet, record.digest);
    const res = await anchor(token, record.recordId).expect(200);
    assert.equal(res.body.record.txHash, txHash);
  });

  it('fails closed when the chain is down', async () => {
    const { token, wallet, record } = await setupPatient();
    const txHash = chain.anchor(record.recordId, wallet, record.digest);
    await anchor(token, record.recordId, txHash).expect(200);

    chain.down = true;
    const v = await verify(token, record.recordId).expect(200);
    assert.equal(v.body.verification.status, 'chain_unavailable');
    assert.equal(v.body.verification.checks.onChain, 'unavailable');
    const a = await anchor(token, record.recordId, txHash).expect(503);
    assert.equal(a.body.error.code, 'CHAIN_UNAVAILABLE');
  });

  it('reports an edited-but-not-re-anchored record as outdated, then verified after update', async () => {
    const { token, wallet, record } = await setupPatient();
    await anchor(token, record.recordId, chain.anchor(record.recordId, wallet, record.digest)).expect(200);

    const edited = await request(app).patch(`/api/wellness/${record.recordId}`).set(bearer(token)).send({ mood: 9 }).expect(200);
    assert.equal(edited.body.record.onChainAction, 'update');
    assert.equal((await verify(token, record.recordId)).body.verification.status, 'outdated');

    const txHash = chain.anchor(record.recordId, wallet, edited.body.record.digest);
    const res = await anchor(token, record.recordId, txHash).expect(200);
    assert.deepEqual(res.body.record.anchorHistory.map((h) => h.action), ['registered', 'updated']);
    const v = await verify(token, record.recordId).expect(200);
    assert.equal(v.body.verification.status, 'verified');
    assert.equal(v.body.verification.onChain.version, 2);
  });

  it('detects a consistently re-encrypted database record via the on-chain hash mismatch', async () => {
    const { user, token, wallet, record } = await setupPatient();
    await anchor(token, record.recordId, chain.anchor(record.recordId, wallet, record.digest)).expect(200);

    // An attacker with DB + key access rewrites the record so it is locally consistent.
    const forged = sealRecord({
      recordId: record.recordId, patientId: user._id, entryDate: record.entryDate,
      mood: 1, stress: 10, journal: 'forged', tags: [],
    });
    await WellnessRecord.updateOne({ recordId: record.recordId }, forged);

    const v = await verify(token, record.recordId).expect(200);
    assert.equal(v.body.verification.status, 'tampered');
    assert.equal(v.body.verification.checks.decryption, 'pass');
    assert.equal(v.body.verification.checks.digest, 'pass');
    assert.equal(v.body.verification.checks.onChain, 'mismatch');
    assert.equal(await AuditEvent.countDocuments({ eventType: 'record_verified', outcome: 'failure', detail: 'tampered' }), 1);
  });

  it('detects tampered ciphertext even when the chain is fine', async () => {
    const { token, wallet, record } = await setupPatient();
    await anchor(token, record.recordId, chain.anchor(record.recordId, wallet, record.digest)).expect(200);
    const doc = await WellnessRecord.findOne({ recordId: record.recordId });
    const buf = Buffer.from(doc.encryptedPayload, 'base64');
    buf[0] ^= 1;
    await WellnessRecord.updateOne({ recordId: record.recordId }, { encryptedPayload: buf.toString('base64') });
    const v = await verify(token, record.recordId).expect(200);
    assert.equal(v.body.verification.status, 'tampered');
    assert.equal(v.body.verification.checks.decryption, 'fail');
  });

  it('flags a record owned on-chain by another wallet', async () => {
    const { token, record } = await setupPatient();
    chain.setRecord(record.recordId, { owner: Wallet.createRandom().address, digest: record.digest });
    const v = await verify(token, record.recordId).expect(200);
    assert.equal(v.body.verification.status, 'tampered');
    assert.equal(v.body.verification.checks.owner, 'fail');
  });

  it('confirms on-chain revocation of a deleted record', async () => {
    const { user, token, wallet, record } = await setupPatient();
    await anchor(token, record.recordId, chain.anchor(record.recordId, wallet, record.digest)).expect(200);
    await request(app).delete(`/api/wellness/${record.recordId}`).set(bearer(token)).expect(204);

    const notRevoked = chain.addTx({ from: wallet });
    await request(app).post(`/api/wellness/${record.recordId}/revocation`).set(bearer(token)).send({ txHash: notRevoked }).expect(400);

    const txHash = chain.revokeRecord(record.recordId, wallet);
    const res = await request(app).post(`/api/wellness/${record.recordId}/revocation`).set(bearer(token)).send({ txHash }).expect(200);
    assert.equal(res.body.chainRevoked, true);
    const doc = await WellnessRecord.findOne({ recordId: record.recordId });
    assert.equal(doc.chainRevoked, true);
    assert.equal(doc.encryptedPayload, undefined);
    assert.equal(await AuditEvent.countDocuments({ eventType: 'record_revoked_onchain', actor: user._id }), 1);
  });

  it('does not let another patient anchor or verify someone else\'s record', async () => {
    const alice = await setupPatient();
    const bob = await setupPatient();
    const txHash = chain.anchor(alice.record.recordId, alice.wallet, alice.record.digest);
    await anchor(bob.token, alice.record.recordId, txHash).expect(404);
    await verify(bob.token, alice.record.recordId).expect(404);
  });
});
