import './helpers/setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildKeyring, cipherSuite, createCipherSuite, IntegrityError } from '../src/services/cryptoService.js';
import { canonicalize, computeDigest, digestsEqual, newRecordId } from '../src/services/recordDigest.js';
import { openRecord, sealRecord } from '../src/services/wellnessRecordService.js';

const ctx = { recordId: newRecordId(), patientId: '65f000000000000000000001' };
const payload = { mood: 7, stress: 3, journal: 'Felt calmer after a walk.', tags: ['exercise'] };

function flipFirstByte(b64) {
  const buf = Buffer.from(b64, 'base64');
  buf[0] ^= 0x01;
  return buf.toString('base64');
}

describe('AES-256-GCM encryption', () => {
  it('round-trips JSON and uses the current key version', () => {
    const enc = cipherSuite.encryptJson(payload, ctx);
    assert.equal(enc.keyVersion, 2);
    assert.deepEqual(cipherSuite.decryptJson(enc, ctx), payload);
  });

  it('does not contain plaintext and uses a fresh IV each time', () => {
    const a = cipherSuite.encryptJson(payload, ctx);
    const b = cipherSuite.encryptJson(payload, ctx);
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.ciphertext, b.ciphertext);
    assert.equal(Buffer.from(a.ciphertext, 'base64').toString('utf8').includes('calmer'), false);
    assert.equal(Buffer.from(a.iv, 'base64').length, 12);
    assert.equal(Buffer.from(a.authTag, 'base64').length, 16);
  });

  for (const field of ['ciphertext', 'iv', 'authTag']) {
    it(`detects a tampered ${field}`, () => {
      const enc = cipherSuite.encryptJson(payload, ctx);
      assert.throws(() => cipherSuite.decryptJson({ ...enc, [field]: flipFirstByte(enc[field]) }, ctx), IntegrityError);
    });
  }

  it('rejects truncated tags and IVs', () => {
    const enc = cipherSuite.encryptJson(payload, ctx);
    const shortTag = Buffer.from(enc.authTag, 'base64').subarray(0, 8).toString('base64');
    assert.throws(() => cipherSuite.decryptJson({ ...enc, authTag: shortTag }, ctx), IntegrityError);
    assert.throws(() => cipherSuite.decryptJson({ ...enc, iv: '' }, ctx), IntegrityError);
  });

  it('binds ciphertext to its record and patient (AAD)', () => {
    const enc = cipherSuite.encryptJson(payload, ctx);
    assert.throws(() => cipherSuite.decryptJson(enc, { ...ctx, recordId: newRecordId() }), IntegrityError);
    assert.throws(
      () => cipherSuite.decryptJson(enc, { ...ctx, patientId: '65f000000000000000000002' }),
      IntegrityError,
    );
  });

  it('fails with the wrong key and for unknown key versions', () => {
    const other = createCipherSuite(
      buildKeyring({ currentKeyHex: crypto.randomBytes(32).toString('hex'), currentVersion: 2 }),
    );
    const enc = cipherSuite.encryptJson(payload, ctx);
    assert.throws(() => other.decryptJson(enc, ctx), IntegrityError);
    assert.throws(() => cipherSuite.decryptJson({ ...enc, keyVersion: 99 }, ctx), IntegrityError);
  });

  it('decrypts records written with a retired key (key rotation)', () => {
    const oldSuite = createCipherSuite(
      buildKeyring({ currentKeyHex: process.env.TEST_OLD_KEY, currentVersion: 1 }),
    );
    const enc = oldSuite.encryptJson(payload, ctx);
    assert.equal(enc.keyVersion, 1);
    assert.deepEqual(cipherSuite.decryptJson(enc, ctx), payload);
  });

  it('rejects keys that are not 32 bytes', () => {
    assert.throws(() => buildKeyring({ currentKeyHex: 'abcd', currentVersion: 1 }), /32 bytes/);
  });
});

describe('Canonical record digest', () => {
  const fields = { ...ctx, entryDate: '2026-10-01', ...payload, salt: 'a'.repeat(64) };

  it('is deterministic and documented in fixed key order', () => {
    assert.equal(computeDigest(fields), computeDigest({ ...fields }));
    assert.match(computeDigest(fields), /^0x[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(JSON.parse(canonicalize(fields))), [
      'v', 'recordId', 'patientId', 'entryDate', 'mood', 'stress', 'journal', 'tags', 'salt',
    ]);
    // Key order of the input object does not matter.
    const reordered = Object.fromEntries(Object.entries(fields).reverse());
    assert.equal(computeDigest(reordered), computeDigest(fields));
  });

  it('changes when any field changes', () => {
    const base = computeDigest(fields);
    for (const [k, v] of Object.entries({
      recordId: newRecordId(), patientId: 'x', entryDate: '2026-10-02', mood: 8, stress: 4,
      journal: 'edited', tags: ['sleep'], salt: 'b'.repeat(64),
    })) {
      assert.notEqual(computeDigest({ ...fields, [k]: v }), base, `digest should depend on ${k}`);
    }
  });

  it('compares digests safely', () => {
    const d = computeDigest(fields);
    assert.equal(digestsEqual(d, d.toUpperCase().replace('0X', '0x')), true);
    assert.equal(digestsEqual(d, computeDigest({ ...fields, mood: 1 })), false);
    assert.equal(digestsEqual(d, undefined), false);
  });
});

describe('sealRecord / openRecord', () => {
  const input = { ...ctx, entryDate: '2026-10-01', ...payload };
  const toDoc = (sealed) => ({ ...sealed, recordId: ctx.recordId, patient: ctx.patientId, entryDate: '2026-10-01' });

  it('seals with a random salt so identical entries have different digests', () => {
    const a = sealRecord(input);
    const b = sealRecord(input);
    assert.notEqual(a.digest, b.digest);
    const opened = openRecord(toDoc(a));
    assert.equal(opened.status, 'ok');
    assert.deepEqual(opened.data, payload);
    assert.equal(opened.data.salt, undefined);
  });

  it('reports tampered ciphertext', () => {
    const sealed = sealRecord(input);
    const res = openRecord(toDoc({ ...sealed, encryptedPayload: flipFirstByte(sealed.encryptedPayload) }));
    assert.deepEqual(res, { status: 'tampered', reason: 'decryption_failed' });
  });

  it('reports a digest mismatch', () => {
    const sealed = sealRecord(input);
    const res = openRecord(toDoc({ ...sealed, digest: '0x' + '0'.repeat(64) }));
    assert.equal(res.status, 'tampered');
    assert.equal(res.reason, 'digest_mismatch');
  });

  it('reports a changed plaintext entry date as a digest mismatch', () => {
    const sealed = sealRecord(input);
    const res = openRecord({ ...toDoc(sealed), entryDate: '2026-09-30' });
    assert.equal(res.reason, 'digest_mismatch');
  });
});
